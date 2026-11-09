import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,sealMessage} from '../web/public/peer-crypto.js';
import {emptyNearVault,fundingRequest} from '../web/public/near-protocol.js';
import {prepareRheaSwap} from '../web/public/rhea-protocol.js';
import {createDefiRequest,openDefiObservation,DEFI_OBSERVATION,PUBLIC_TESTNET_DISCLOSURE} from '../web/public/defi-request.js';

const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function fixture(){
  const owner=await createIdentity('Owner'),executor=await createIdentity('Executor'),now=1000000;
  const vault=emptyNearVault(config.reserve),funding=await fundingRequest(owner,config.reserve,'10');
  vault.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});
  const swap=await prepareRheaSwap(vault,owner,config,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:now+600000},now);
  const request=await createDefiRequest(owner,executor.profile,config,{kind:'rhea-swap',packet:swap.packet},{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:now+600000},now);
  const report={type:DEFI_OBSERVATION,requestId:request.id,checkedAt:now+1,state:'pending',observation:null,transaction:null};
  return {owner,executor,request,report,now};
}
test('executor updates authenticate the selected sender while retaining claims for independent checking',async()=>{
  const f=await fixture(),report={...f.report,state:'observed',observation:{claimed:'complete',output:'999'}};
  const packet=await sealMessage(f.executor,f.owner.profile,report),before=structuredClone(f.request);
  assert.deepEqual(await openDefiObservation(f.owner,f.executor.profile,packet,f.request,f.now+2),report);
  assert.deepEqual(f.request,before);
  assert.equal((await openDefiObservation(f.owner,f.executor.profile,packet,f.request,f.request.expiresAt+1)).state,'observed');
});
test('updates reject a different executor, recipient, request and forged packet',async()=>{
  const f=await fixture(),other=await createIdentity('Other'),packet=await sealMessage(f.executor,f.owner.profile,f.report);
  const cases=[
    [await sealMessage(other,f.owner.profile,f.report),f.request],
    [await sealMessage(f.owner,f.executor.profile,f.report),f.request],
    [await sealMessage(f.executor,f.owner.profile,{...f.report,requestId:'f'.repeat(64)}),f.request],
    [{...packet,signature:'0'.repeat(128)},f.request],
    [packet,{...f.request,sender:other.profile.id}],
    [packet,{...f.request,executor:other.profile.id}],
  ];
  for(const [p,r]of cases)await assert.rejects(openDefiObservation(f.owner,f.executor.profile,p,r,f.now+2));
});
test('updates reject malformed schema, state, time and oversized contents',async()=>{
  const f=await fixture();
  for(const change of [{type:'other'}, {credit:'100'}, {state:'complete'}, {checkedAt:f.now-1}, {checkedAt:f.now+60001}, {checkedAt:1.5}, {observation:'a'.repeat(100000)}]){
    await assert.rejects(async()=>{
      const packet=await sealMessage(f.executor,f.owner.profile,{...f.report,...change});
      await openDefiObservation(f.owner,f.executor.profile,packet,f.request,f.now);
    });
  }
});
test('update validation snapshots the supplied packet and approved terms before asynchronous work',async()=>{
  const f=await fixture(),packet=await sealMessage(f.executor,f.owner.profile,f.report);
  const pending=openDefiObservation(f.owner,f.executor.profile,packet,f.request,f.now+2);
  packet.from='f'.repeat(64);f.request.id='f'.repeat(64);f.request.createdAt=f.now+100;
  assert.deepEqual(await pending,f.report);
});
