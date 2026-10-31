import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRheaRoute } from './rhea-relay.mjs';
import { adapterCall } from '../contracts/adapter-client.mjs';
const id='a'.repeat(64),c={network:'testnet',adapter:'adapter.testnet',reserve:'reserve.testnet',ready:true};
const req=(url,data={},changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify({adapter:c.adapter,...data}))]),{url,method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
const res=()=>({writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}});
function clients(){const log=[];return {log,adapterConfig:async()=>c,verifyAdapter:async()=>log.push('config'),verifyPacketRoot:async()=>log.push('verify'),view:async()=>null,relayAccount:async()=>({}),serialize:fn=>fn(),call:async()=>log.push('settle'),adapterCall:async(_a,_c,method,args)=>{log.push(method);return {finality:'FINAL',order:{id,instruction:args.instruction}};}};}
test('relay verifies configuration and signed root before settling or submitting',async()=>{
  const cl=clients(),r=res();await createRheaRoute(cl)(req('/api/rhea/submit',{packet:{id,path:[{}],instruction:{receiver_id:'alice.testnet'}}}),r);
  assert.equal(r.status,200);assert.deepEqual(cl.log,['config','verify','settle','submit']);assert.equal(r.body.order.instruction.receiver_id,'alice.testnet');
});
test('invalid signatures or roots cannot trigger settlement',async()=>{
  const cl=clients();cl.verifyPacketRoot=async()=>{throw new Error('Invalid signature');};const r=res();await createRheaRoute(cl)(req('/api/rhea/submit',{packet:{id,path:[{}]}}),r);
  assert.equal(r.status,400);assert.deepEqual(cl.log,['config']);
});
test('existing orders recover without dispatching another transfer',async()=>{
  const cl=clients();cl.view=async()=>({id,stage:'complete'});const r=res();await createRheaRoute(cl)(req('/api/rhea/submit',{packet:{id,path:[{}]}}),r);
  assert.equal(r.body.order.stage,'complete');assert(r.body.recovered);assert.deepEqual(cl.log,['config','verify']);
});
test('foreign origins, rebinding and malformed identifiers never reach chain calls',async()=>{
  const cl=clients(),route=createRheaRoute(cl);
  for(const changes of [{headers:{host:'evil',origin:'http://127.0.0.1:4173'}},{headers:{host:'127.0.0.1:4173',origin:'https://evil'}},{method:'GET'}]){const r=res();await route(req('/api/rhea/advance',{id},changes),r);assert([403,405].includes(r.status));}
  for(const data of [{id:'bad'},{id,adapter:'other.testnet'},{id,data:'x'.repeat(50000)}]){const r=res();await route(req('/api/rhea/advance',data),r);assert.equal(r.status,400);}
  assert.deepEqual(cl.log,[]);
});
test('a final callback preserves caught receipt failures; nonfinal/top-level failures remain errors',async()=>{
  const tx={final_execution_status:'FINAL',status:{SuccessValue:Buffer.from(JSON.stringify({id,stage:'refund_on_dex'})).toString('base64')},transaction:{hash:'1'.repeat(32)},receipts_outcome:[{id:'failed-swap',outcome:{gas_burnt:1,status:{Failure:{error:'slippage'}}}}]};
  const account={accountId:'relay.testnet',signer:{signTransaction:async()=>({txHash:new Uint8Array(32)})},signAndSendTransaction:async options=>{await options.signer.signTransaction({});return tx;}};
  const record=async()=>{};const r=await adapterCall(account,c,'advance',{id},record);assert.equal(r.order.stage,'refund_on_dex');assert.equal(r.failedReceipts.length,1);
  tx.final_execution_status='EXECUTED_OPTIMISTIC';await assert.rejects(adapterCall(account,c,'advance',{id},record),/successful final/);
  tx.final_execution_status='FINAL';tx.status={Failure:{}};await assert.rejects(adapterCall(account,c,'advance',{id},record),/successful final/);
});
test('status reconciliation verifies config and never opens a signing account',async()=>{
  const cl=clients();cl.reconcileAdapterOrder=async(_c,orderId)=>{assert.equal(orderId,id);cl.log.push('receipts');return {finality:'FINAL',order:{id},reconciliation:{state:'needs_review'}};};cl.relayAccount=()=>assert.fail('Read-only status must not sign');
  const r=res();await createRheaRoute(cl)(req('/api/rhea/order',{id}),r);assert.equal(r.status,200);assert.equal(r.body.reconciliation.state,'needs_review');assert.deepEqual(cl.log,['config','receipts']);
});
test('recovery signs one id-only call after validating the current order',async()=>{
  const cl=clients();cl.adapterConfig=async()=>({...c,recoverRedemption:true});
  cl.reconcileAdapterOrder=async(_c,orderId)=>{assert.equal(orderId,id);cl.log.push('current');return {finality:'FINAL',order:{id,stage:'redeeming'}};};
  cl.relayAccount=async()=>{cl.log.push('signer');return {};};
  cl.adapterCall=async(_a,_c,method,args)=>{assert.deepEqual(args,{id});cl.log.push(method);return {finality:'FINAL',order:{id,stage:'funded'}};};
  const r=res();await createRheaRoute(cl)(req('/api/rhea/recover',{id}),r);
  assert.equal(r.status,200);assert.equal(r.body.order.stage,'funded');assert.deepEqual(cl.log,['config','current','signer','recover_redemption']);
});
test('disabled recovery, extra actions and invalid orders never open the signer',async()=>{
  const cl=clients();cl.relayAccount=()=>assert.fail('Must not sign');let enabled=false;
  cl.adapterConfig=async()=>({...c,recoverRedemption:enabled});cl.reconcileAdapterOrder=async()=>{throw Error('Different final order');};
  for(const data of [{id},{id,method:'advance'},{id,receiver:'evil.testnet'},{id,amount:'1'},{id}]){
    const r=res();await createRheaRoute(cl)(req('/api/rhea/recover',data),r);assert.equal(r.status,400);enabled=true;
  }
  cl.reconcileAdapterOrder=async()=>({finality:'FINAL',order:null});const r=res();await createRheaRoute(cl)(req('/api/rhea/recover',{id}),r);assert.equal(r.status,400);
});
test('recovery rechecks stage and returns changed or unsupported stages without signing',async()=>{
  const cl=clients();cl.adapterConfig=async()=>({...c,recoverRedemption:true});cl.relayAccount=()=>assert.fail('Stage no longer needs recovery');
  for(const stage of ['funded','complete','refunded','attention','depositing','paying_refund']){
    cl.reconcileAdapterOrder=async()=>({finality:'FINAL',order:{id,stage}});const r=res();await createRheaRoute(cl)(req('/api/rhea/recover',{id}),r);assert.equal(r.status,200);assert.equal(r.body.order.stage,stage);
  }
});
