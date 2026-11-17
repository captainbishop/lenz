import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestnetRelay} from './testnet-relay.mjs';
import {createIdentity,digest} from './public/peer-crypto.js';
import {fundingRequest,FUND,emptyNearVault,makeNearPayment,acceptNearPayment,applySpend,compressed} from './public/near-protocol.js';

const contract='reserve.lenz.testnet';
async function fixture(options={}){
 const directory=await mkdtemp(join(tmpdir(),'lenz-reserve-relay-')),roots=new Map();let calls=0;
 const settings={origin:'http://127.0.0.1:4173',sponsorDir:directory,configuration:async()=>({network:'testnet',contract,ready:true}),relayAccount:async()=>({accountId:'relay.testnet'}),view:async(_contract,method,{id})=>method==='get_root'?roots.get(id)??null:null,call:async(_account,_contract,method,args)=>{calls++;assert.equal(method,'fund_test');const root={id:'root:'+await digest([FUND,'testnet',contract,args.owner,args.amount,args.nonce]),owner:args.owner,amount:args.amount};roots.set(root.id,root);return {finality:'FINAL',txHash:'final-testnet-transaction',value:root};},...options};let route=createTestnetRelay(settings);
 const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const post=async(path,body)=>{const response=await new Promise((resolve,reject)=>{const request=http.request('http://127.0.0.1:'+server.address().port+'/api/testnet/'+path,{method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'}},response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode})));request.on('error',reject);request.end(JSON.stringify(body));});return {status:response.status,value:await response.json()};};
 return {post,roots,directory,restart:()=>{route=createTestnetRelay(settings);},calls:()=>calls,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}};
}

test('a fresh profile funds its signed reserve request and retries recover final state',async()=>{
 const identity=await createIdentity('Fresh visitor'),request=await fundingRequest(identity,contract),app=await fixture();
 try{const result=await app.post('fund',{...request,contract});assert.equal(result.status,200);assert.deepEqual(result.value.root,{id:request.id,owner:request.owner,amount:'100000000'});assert.equal(result.value.finality,'FINAL');const retry=await app.post('fund',{...request,contract});assert.equal(retry.status,200);assert.equal(retry.value.recovered,true);assert.equal(app.calls(),1);}finally{await app.close();}
});

test('forged signatures and altered owners, amounts and identifiers never spend sponsor allowance',async()=>{
 const identity=await createIdentity('Original visitor'),other=await createIdentity('Other visitor'),request=await fundingRequest(identity,contract),app=await fixture({dailyLimit:1});
 try{
  const wrongOwner=await fundingRequest(other,contract);
  for(const change of [{signature:'0'.repeat(128)},{id:'root:'+'0'.repeat(64)},{amount:'100000001'},{owner:wrongOwner.owner},{contract:'other.testnet'},{wallet:'a'}])assert.equal((await app.post('fund',{...request,contract,...change})).status,400);
  assert.equal(app.calls(),0);assert.equal((await app.post('fund',{...request,contract})).status,200);assert.equal(app.calls(),1);
 }finally{await app.close();}
});

test('sponsor cap survives restart while an exact confirmed retry consumes no new allowance',async()=>{
 let now=1794690000000;const first=await fundingRequest(await createIdentity('First visitor'),contract),second=await fundingRequest(await createIdentity('Second visitor'),contract),app=await fixture({dailyLimit:1,now:()=>now});
 try{
  assert.equal((await app.post('fund',{...first,contract})).status,200);app.restart();
  assert.equal((await app.post('fund',{...first,contract})).status,200);assert.equal((await app.post('fund',{...second,contract})).status,429);assert.equal(app.calls(),1);
  now+=86400000;assert.equal((await app.post('fund',{...second,contract})).status,200);assert.equal(app.calls(),2);
 }finally{await app.close();}
});

test('an uncertain dispatch stays reserved through restart and corruption fails closed',async()=>{
 const first=await fundingRequest(await createIdentity('Interrupted visitor'),contract),second=await fundingRequest(await createIdentity('Next visitor'),contract);let submitted=0;
 const app=await fixture({call:async()=>{submitted++;throw Error('Connection stopped after broadcast.');}});
 try{
  assert.equal((await app.post('fund',{...first,contract})).status,409);app.restart();assert.equal((await app.post('fund',{...first,contract})).status,409);assert.equal(submitted,1);
  await writeFile(join(app.directory,'allowance.json'),'broken');assert.equal((await app.post('fund',{...second,contract})).status,503);assert.equal(submitted,1);
 }finally{await app.close();}
});

test('a spending key cannot obtain a second sponsorship by changing its funding nonce',async()=>{
 const identity=await createIdentity('One spending key'),first=await fundingRequest(identity,contract),second=await fundingRequest(identity,contract),app=await fixture();
 try{assert.equal((await app.post('fund',{...first,contract})).status,200);assert.equal((await app.post('fund',{...second,contract})).status,409);assert.equal(app.calls(),1);}finally{await app.close();}
});

test('malformed requests do not consume the verified-request minute allowance',async()=>{
 const request=await fundingRequest(await createIdentity('Visitor after bad requests'),contract),app=await fixture();
 try{for(let i=0;i<60;i++)assert.equal((await app.post('fund',{})).status,400);assert.equal((await app.post('fund',{...request,contract})).status,200);assert.equal(app.calls(),1);}finally{await app.close();}
});

test('losing an initialized sponsor ledger does not reset its allowance',async()=>{
 const first=await fundingRequest(await createIdentity('First visitor'),contract),second=await fundingRequest(await createIdentity('Next visitor'),contract),app=await fixture();
 try{assert.equal((await app.post('fund',{...first,contract})).status,200);await unlink(join(app.directory,'allowance.json'));app.restart();assert.equal((await app.post('fund',{...second,contract})).status,503);assert.equal(app.calls(),1);}finally{await app.close();}
});

test('an offline onward payment settles both signed hops once and rejects hostile paths before sponsorship',async()=>{
 const alice=await createIdentity('Alice'),bob=await createIdentity('Bob'),carol=await createIdentity('Carol'),request=await fundingRequest(alice,contract),root={id:request.id,owner:request.owner,amount:'100000000'};
 const vault=emptyNearVault(contract);vault.roots.push(root);const first=await makeNearPayment(vault,alice,bob.profile,'40'),received=await acceptNearPayment(emptyNearVault(contract),bob,alice.profile,first.payload),onward=await makeNearPayment(received.vault,bob,carol.profile,'15');
 const notes=new Map([[root.id,root]]),consumed=new Map(),receipts=new Map();let sponsored=0;
 const app=await fixture({view:async(_contract,method,{id})=>method==='get_note'?notes.get(id)??null:method==='spent_by'?consumed.get(id)??null:method==='get_receipt'?receipts.get(id)??null:null,call:async(_account,_contract,method,{path})=>{assert.equal(method,'settle');sponsored++;const confirmed=[];for(const spend of path){const result=await applySpend(contract,notes,consumed,spend),receipt={id:result.id,input:spend.input,outputs:result.outputs,block_height:100};receipts.set(receipt.id,receipt);confirmed.push(receipt);}return {finality:'FINAL',value:confirmed};}});
 try{
  const path=onward.payload.path;
  for(const invalid of [[path[1],path[0]],[{...path[0],signature:'0'.repeat(128)},path[1]],[path[0],{...path[1],amount:'40000001'}],[path[0],{...path[1],recipient:compressed(alice.profile.signingPublic)}]])assert.equal((await app.post('settle',{contract,path:invalid})).status,400);
  assert.equal(sponsored,0);const result=await app.post('settle',{contract,path});assert.equal(result.status,200);assert.equal(result.value.receipts[0].outputs[1].amount,'60000000');assert.equal(result.value.receipts[1].outputs[0].owner,compressed(carol.profile.signingPublic));assert.equal(result.value.receipts[1].outputs[0].amount,'15000000');assert.equal(result.value.receipts[1].outputs[1].amount,'25000000');
  const retry=await app.post('settle',{contract,path});assert.equal(retry.status,200);assert.equal(retry.value.recovered,true);assert.equal(sponsored,1);
  const competing=await makeNearPayment(vault,alice,carol.profile,'20');assert.equal((await app.post('settle',{contract,path:competing.payload.path})).status,400);assert.equal(sponsored,1);
  const checked=await app.post('check',{contract,ids:[root.id,result.value.receipts[1].outputs[0].id]});assert.equal(checked.status,200);assert.equal(checked.value.results[1].note.amount,'15000000');assert.equal(checked.value.results[0].spent,result.value.receipts[0].id);
 }finally{await app.close();}
});
