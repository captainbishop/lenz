import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostedGateway} from './hosted-gateway.mjs';
import {createHostedProxy} from './hosted-proxy.mjs';
import {createHostedSession} from './public/hosted-session.js';
import {createSignedRheaRoute} from './rhea-signed-relay.mjs';
import {createIdentity} from './public/peer-crypto.js';
import {emptyNearVault,fundingRequest} from './public/near-protocol.js';
import {prepareRheaSwap} from './public/rhea-protocol.js';
import {createDefiRequest,PUBLIC_TESTNET_DISCLOSURE} from './public/defi-request.js';
import {createDefiRoute} from './defi-relay.mjs';
import {readDefiStatus,readDefiRefund} from './defi-status.mjs';
import {prepareRefundReturn} from './public/near-deposit.js';

const origin='https://lenz-test.vercel.app',gatewaySecret='g'.repeat(48),sessionSecret='s'.repeat(48);
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
const fetchHTTP=(url,options={})=>new Promise((resolve,reject)=>{const request=http.request(url,{method:options.method??'GET',headers:options.headers instanceof Headers?Object.fromEntries(options.headers):options.headers,signal:options.signal},response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers})));request.on('error',reject);request.end(options.body);});
async function listen(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:'http://127.0.0.1:'+server.address().port};}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

test('hosted refund reads bind the signed original deposit without custody, signing or action disclosure',async()=>{
 const sender=await createIdentity('Disposable refund sender'),executor=await createIdentity('Disposable executor'),vault=emptyNearVault(config.reserve),grant=await fundingRequest(sender,config.reserve,'4'),now=Date.now();
 vault.roots.push({id:grant.id,owner:grant.owner,amount:grant.amount});
 const packet=(await prepareRheaSwap(vault,sender,config,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:now+1000},now)).packet;
 const request=await createDefiRequest(sender,executor.profile,config,{kind:'rhea-swap',packet},{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:now+1000},now);
 const order={id:packet.id,instruction:packet.instruction,stage:'refunded',output:'0'},deposit=await prepareRefundReturn(vault,sender,{packet,status:order});
 const observation={state:'observed',finality:'FINAL',block:{height:20,hash:'4'.repeat(32)},order,deposit:{root:{id:deposit.id,owner:deposit.owner,amount:deposit.amount},spent:null},call:{method:'must-not-leave-reader'}};let reads=0;
 const route=createDefiRoute({readDefiRefund:input=>readDefiRefund(input,{configuration:async()=>config,createClients:async(_config,controls)=>{
  assert.throws(controls.getSigner,/cannot sign/);return {observe:async operation=>{reads++;assert.deepEqual(operation,{kind:'rhea-refund-return',packet,deposit});return observation;}};
 }})});
 const backend=await listen(route),gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url,fetcher:(url,options)=>fetchHTTP(backend.url+url.pathname,{...options,headers:{...options.headers,host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'}})}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetchHTTP(gateway.url+url.pathname,options)}));
 const paths=[],wallet=createHostedSession({origin,hosted:true,read:async()=>({identity:sender}),fetcher:(path,options={})=>{paths.push(path);return fetchHTTP(site.url+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}});}});
 const input={sender:sender.profile,executor:executor.profile,request,deposit},post=input=>wallet.fetch('/api/defi/rhea/refund-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  const result=await post(input);assert.equal(result.status,200);assert.deepEqual(await result.json(),{requestId:request.id,depositId:deposit.id,state:'observed',observation:{finality:'FINAL',block:observation.block,order,deposit:observation.deposit}});
  const forged=structuredClone(input);forged.request.signature='0'.repeat(128);assert.equal((await post(forged)).status,400);
  for(const field of ['payer','owner','source']){const changed=structuredClone(input);changed.deposit[field]=field==='payer'?'other.testnet':field==='owner'?'02'+'a'.repeat(64):'a'.repeat(64);assert.equal((await post(changed)).status,400);}
  assert.equal((await post({...input,id:packet.id})).status,400);assert.equal(reads,1);
  assert.equal((await post({...input,padding:'x'.repeat(65536)})).status,413);assert(paths.every(path=>path==='/api/defi/rhea/refund-status'));
  assert.equal((await fetchHTTP(site.url+'/api/defi/rhea/refund-status?id='+packet.id,{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json'},body:JSON.stringify(input)})).status,404);assert.equal(reads,1);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);}
});

test('sender verifies the original signed outcome through hosting without operator custody or a new signature',async()=>{
 const sender=await createIdentity('Disposable sender'),executor=await createIdentity('Disposable executor'),vault=emptyNearVault(config.reserve),funding=await fundingRequest(sender,config.reserve,'4'),now=Date.now();
 vault.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});
 const packet=(await prepareRheaSwap(vault,sender,config,{text:'4',minOutput:'250000000000000000000000',receiver:'receiver.testnet',deadlineMs:now+1000},now)).packet;
 const request=await createDefiRequest(sender,executor.profile,config,{kind:'rhea-swap',packet},{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:now+1000},now);
 const order={id:packet.id,instruction:packet.instruction,stage:'complete',output:'500000000000000000000000'},observation={state:'observed',finality:'FINAL',block:{height:20,hash:'4'.repeat(32)},order};let reads=0;
 const route=createDefiRoute({readDefiStatus:input=>readDefiStatus(input,{configuration:async()=>config,createClients:async(_config,controls)=>{assert.throws(controls.getSigner,/cannot sign/);return {observe:async operation=>{reads++;assert.deepEqual(operation,{kind:'rhea-swap',packet});return observation;}};}})});
 // The gateway restores the local app's exact origin before invoking this read boundary.
 const backend=await listen(route),gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url,fetcher:(url,options)=>fetchHTTP(backend.url+url.pathname,{...options,headers:{...options.headers,host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173'}})}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetchHTTP(gateway.url+url.pathname,options)}));
 const paths=[],wallet=createHostedSession({origin,hosted:true,read:async()=>({identity:sender}),fetcher:(path,options={})=>{paths.push(path);return fetchHTTP(site.url+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}});}});
 const post=input=>wallet.fetch('/api/defi/rhea/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),input={sender:sender.profile,executor:executor.profile,request};
 try{
  const result=await post(input);assert.equal(result.status,200);assert.deepEqual(await result.json(),{requestId:request.id,state:'observed',observation:{finality:'FINAL',block:observation.block,order}});
  const forged=structuredClone(input);forged.request.signature='0'.repeat(128);assert.equal((await post(forged)).status,400);assert.equal((await post({...input,id:packet.id})).status,400);assert.equal(reads,1);
  assert.equal((await post({...input,padding:'x'.repeat(65536)})).status,413);assert(paths.every(path=>path==='/api/defi/rhea/status'));
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);}
});

test('permission expiring while the sponsor is read never dispatches or consumes an allowance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lenz-late-signed-swap-')),identity=await createIdentity('Disposable sender'),vault=emptyNearVault(config.reserve),grant=await fundingRequest(identity,config.reserve,'4');let clock=Date.now(),dispatches=0,signed;
 vault.roots.push({id:grant.id,owner:grant.owner,amount:grant.amount});
 const packet=(await prepareRheaSwap(vault,identity,config,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:clock+60000},clock)).packet;
 const backend=await listen((req,res)=>signed(req,res));
 signed=createSignedRheaRoute({origin:backend.url,sponsorDir:directory,now:()=>clock,clients:{adapterConfig:async()=>config,verifyAdapter:async()=>{},verifyPacketRoot:async()=>{},serialize:operation=>operation(),reconcileAdapterOrder:async()=>({finality:'FINAL',order:null}),view:async()=>null,relayAccount:async()=>{clock+=60001;return {accountId:'operator.testnet'};},call:async()=>{dispatches++;},adapterCall:async()=>{dispatches++;}}});
 try{
  const result=await fetchHTTP(backend.url+'/api/rhea/signed-submit',{method:'POST',headers:{host:new URL(backend.url).host,origin:backend.url,'content-type':'application/json'},body:JSON.stringify({adapter:config.adapter,packet})});
  assert.equal(result.status,409);assert.match((await result.json()).error,/expired before dispatch/);assert.equal(dispatches,0);await assert.rejects(readFile(join(directory,'allowance.json')),error=>error.code==='ENOENT');
 }finally{await close(backend.server);await rm(directory,{recursive:true,force:true});}
});

test('hosted signed swaps preserve exact owner authority, bounded sponsorship and uncertain recovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lenz-hosted-signed-swap-')),identity=await createIdentity('Disposable offline sender'),roots=new Map(),calls=[];
 async function packet(amount){const grant=await fundingRequest(identity,config.reserve,amount==='101'?'100':amount),vault=emptyNearVault(config.reserve),root={id:grant.id,amount:amount==='101'?'101000000':grant.amount,owner:grant.owner};vault.roots.push(root);roots.set(root.id,root);return (await prepareRheaSwap(vault,identity,config,{text:amount,minOutput:'250000000000000000000000',receiver:'receiver.testnet',deadlineMs:Date.now()+3600000})).packet;}
 const original=await packet('4'),tooLarge=await packet('101');let order=null,uncertain=false,signed;
 const backend=await listen((req,res)=>signed(req,res));
 const clients={adapterConfig:async()=>config,verifyAdapter:async()=>{},verifyPacketRoot:async(_c,p)=>assert.deepEqual(p.root,roots.get(p.root.id)),serialize:operation=>operation(),
  view:async(_contract,method,{id})=>method==='get_note'?roots.get(id):method==='spent_by'?null:assert.fail('Unexpected contract view'),
  reconcileAdapterOrder:async()=>({finality:'FINAL',order}),relayAccount:async()=>({accountId:'operator.testnet'}),call:async()=>assert.fail('An exact funded root needs no ancestry dispatch'),
  adapterCall:async(_account,_c,method,args)=>{calls.push({method,args});if(uncertain)throw Error('Lost dispatch response');order={id:original.id,instruction:original.instruction,stage:'ready',output:'0'};return {finality:'FINAL',order};}};
 signed=createSignedRheaRoute({clients,origin:backend.url,sponsorDir:directory});
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetchHTTP(gateway.url+url.pathname,options)}));
 const paths=[],wallet=createHostedSession({origin,hosted:true,read:async()=>({identity}),fetcher:(path,options={})=>{paths.push(path);return fetchHTTP(site.url+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}});}});
 const post=(operation,p=original,extra={})=>wallet.fetch('/api/rhea/signed-'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapter:config.adapter,packet:p,...extra})});
 try{
  const altered=structuredClone(original);altered.instruction.receiver_id='different.testnet';assert.equal((await post('submit',altered)).status,400);
  assert.equal((await post('submit',tooLarge)).status,400);assert.equal((await post('order',original,{id:original.id})).status,400);assert.equal(calls.length,0);
  const status=await post('order');assert.equal(status.status,200);assert.equal((await status.json()).order,null);await assert.rejects(readFile(join(directory,'allowance.json')),error=>error.code==='ENOENT');
  const first=await post('submit');assert.equal(first.status,200);assert.deepEqual(calls,[{method:'submit',args:{instruction:original.instruction}}]);
  assert.equal((await post('submit')).status,200);assert.equal(calls.length,1);
  uncertain=true;assert.equal((await post('advance')).status,400);assert.equal(calls.length,2);
  assert.equal((await post('advance')).status,409);assert.equal(calls.length,2);
  order={id:original.id,instruction:original.instruction,stage:'complete',output:'500000000000000000000000'};
  const final=await post('order');assert.equal(final.status,200);assert.equal((await final.json()).order.stage,'complete');assert.equal((await post('advance')).status,200);assert.equal(calls.length,2);
  const ledger=JSON.parse(await readFile(join(directory,'allowance.json'),'utf8'));assert.equal(Object.keys(ledger.requests).length,2);assert(paths.every(path=>path.startsWith('/api/rhea/signed-')),'Execution must not request an operator sign-in');
  assert.equal((await fetchHTTP(site.url+'/api/rhea/submit',{method:'POST',headers:{host:new URL(origin).host,origin,'Content-Type':'application/json'},body:JSON.stringify({adapter:config.adapter,packet:original})})).status,401);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);await rm(directory,{recursive:true,force:true});}
});
