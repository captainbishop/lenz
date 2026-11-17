import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIdentity} from './public/peer-crypto.js';
import {emptyNearVault,fundingRequest} from './public/near-protocol.js';
import {prepareRheaSwap} from './public/rhea-protocol.js';
import {createSignedRheaRoute} from './rhea-signed-relay.mjs';

const c={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
const req=(operation,packet,extra={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify({adapter:c.adapter,packet,...extra}))]),{url:'/api/rhea/signed-'+operation,method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'}});
const res=()=>({writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}});
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'lenz-signed-swap-')),identity=await createIdentity('Disposable owner'),grant=await fundingRequest(identity,c.reserve,'4'),vault=emptyNearVault(c.reserve);
 const root={id:grant.id,amount:grant.amount,owner:grant.owner};vault.roots.push(root);const {packet}=await prepareRheaSwap(vault,identity,c,{text:'4',minOutput:'250000000000000000000000',receiver:'receiver.testnet',deadlineMs:Date.now()+3600000});
 let order=null,spent=null,time=Date.now();const calls=[];
 const clients={adapterConfig:async()=>c,verifyAdapter:async()=>{},verifyPacketRoot:async(_c,p)=>assert.deepEqual(p.root,root),relayAccount:async()=>({accountId:'operator.testnet'}),serialize:fn=>fn(),
  view:async(_contract,method)=>method==='get_order'?order:method==='get_note'?root:method==='spent_by'?spent:null,
  reconcileAdapterOrder:async()=>({finality:'FINAL',order}),call:async()=>assert.fail('Exact root needs no transfer'),
  adapterCall:async(_account,_config,method,args)=>{calls.push({method,args});order={id:packet.id,instruction:packet.instruction,stage:method==='submit'?'ready':'complete',output:method==='submit'?'0':'500000000000000000000000'};return {finality:'FINAL',order};}};
 const route=createSignedRheaRoute({clients,sponsorDir:directory,now:()=>time});
 try{await run({packet,route,calls,directory,clients,setNow:value=>{time=value;},setOrder:value=>{order=value;},setSpent:value=>{spent=value;}});}finally{await rm(directory,{recursive:true,force:true});}
}
test('only an original signed funded packet can obtain a bounded swap dispatch',()=>fixture(async({packet,route,calls,directory})=>{
 const altered=structuredClone(packet);altered.instruction.receiver_id='other.testnet';const bad=res();await route(req('submit',altered),bad);assert.equal(bad.status,400);assert.equal(calls.length,0);
 const first=res();await route(req('submit',packet),first);assert.equal(first.status,200);assert.equal(first.body.order.stage,'ready');assert.equal(calls.length,1);
 const duplicate=res();await route(req('submit',packet),duplicate);assert.equal(duplicate.status,200);assert.equal(calls.length,1);
 const reordered=structuredClone(packet);reordered.instruction=Object.fromEntries(Object.entries(reordered.instruction).reverse());const imported=res();await route(req('order',reordered),imported);assert.equal(imported.status,200);assert.equal(calls.length,1);
 const ledger=JSON.parse(await readFile(join(directory,'allowance.json'),'utf8'));assert.equal(Object.keys(ledger.requests).length,1);
}));
test('verified final redemption evidence permits original recovery while unresolved evidence cannot sign',()=>fixture(async({packet,route,calls,clients,setOrder})=>{
 clients.adapterConfig=async()=>({...c,recoverRedemption:true});const order={id:packet.id,instruction:packet.instruction,stage:'redeeming',output:'0'};setOrder(order);
 for(const state of ['unverified','unavailable','no_reference']){clients.reconcileAdapterOrder=async()=>({finality:'FINAL',order,reconciliation:{state}});const r=res();await route(req('recover',packet),r);assert.equal(r.status,409);assert.equal(calls.length,0);}
 clients.reconcileAdapterOrder=async()=>({finality:'FINAL',order,reconciliation:{state:'needs_review',finality:'FINAL',txHash:'1'.repeat(44)}});const r=res();await route(req('recover',packet),r);assert.equal(r.status,200);assert.equal(calls.length,1);assert.equal(calls[0].method,'recover_redemption');
}));
test('advance requires the same signed terms and returns terminal orders without spending',()=>fixture(async({packet,route,calls})=>{
 await route(req('submit',packet),res());const altered=structuredClone(packet);altered.instruction.amount='1';const bad=res();await route(req('advance',altered),bad);assert.equal(bad.status,400);assert.equal(calls.length,1);
 const advance=res();await route(req('advance',packet),advance);assert.equal(advance.status,200);assert.equal(advance.body.order.stage,'complete');assert.equal(calls.length,2);
 const repeat=res();await route(req('advance',packet),repeat);assert.equal(repeat.status,200);assert.equal(calls.length,2);
}));
test('signed status does not accept order discovery or disclose another order',()=>fixture(async({packet,route,calls,setOrder})=>{
 for(const extra of [{id:packet.id},{owner:packet.instruction.owner}]){const r=res();await route(req('order',packet,extra),r);assert.equal(r.status,400);}
 const foreign={id:packet.id,instruction:{...packet.instruction,receiver_id:'other.testnet'},stage:'complete',output:'1'};setOrder(foreign);const r=res();await route(req('order',packet),r);assert.equal(r.status,400);assert.equal(calls.length,0);
}));
test('known conflict and uncertain dispatch cannot open another sponsor attempt',()=>fixture(async({packet,route,calls,setSpent,setOrder})=>{
 setSpent('f'.repeat(64));const conflict=res();await route(req('submit',packet),conflict);assert.equal(conflict.status,409);assert.equal(calls.length,0);
 setSpent(null);await route(req('submit',packet),res());setOrder(null);const uncertain=res();await route(req('submit',packet),uncertain);assert.equal(uncertain.status,409);assert.equal(calls.length,1);
}));
test('start expiry blocks a new swap while original funded recovery can still advance',()=>fixture(async({packet,route,calls,setNow,setOrder})=>{
 setNow(Number(packet.instruction.deadline_ms)+1);const expired=res();await route(req('submit',packet),expired);assert.equal(expired.status,409);assert.equal(calls.length,0);
 setOrder({id:packet.id,instruction:packet.instruction,stage:'funded',output:'0'});const recovery=res();await route(req('advance',packet),recovery);assert.equal(recovery.status,200);assert.equal(calls.length,1);assert.equal(calls[0].method,'advance');
}));
