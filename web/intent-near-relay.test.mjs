import test from 'node:test';
import assert from 'node:assert/strict';
import {createNearIntentRelay,createNearIntentFinalSnapshot} from './intent-near-relay.mjs';
import {NEAR_INTENT_DEPLOYMENT as deployment} from './public/intent-near-plan.js';
import {base58} from './public/intents-vendor/codecs.js';
import {createHash} from 'node:crypto';
import {KeyPair,actions,createTransaction,encodeTransaction,SignedTransaction,Signature} from '../contracts/node_modules/near-api-js/lib/index.js';
import {nep413Hash} from '../integrations/intent-testnet/swap.mjs';
import {nearAuthorizationId,implicitNearOwner} from './public/intent-near-plan.js';
import {createNearIntentService} from './public/intent-near-route.js';

test('a quote uses current funded balances and binds the actual testnet assets and recipient',async()=>{
 let retained={version:1,requests:{},grants:{},pending:null},sent=0;
 const rpc={async query(method,args){if(method==='current_salt')return '12345678';if(method==='fee')return 0;if(method==='owner_get')return 'relayer.testnet';if(method==='acl_get_super_admins')return [];if(method==='storage_balance_of')return {total:'1250000000000000000000',available:'0'};if(method==='mt_batch_balance_of')return args.account_id==='11'.repeat(32)?['1000000','0']:['0','2000000'];throw Error('Unexpected query '+method);},async account(id){return {code_hash:base58.encode(Buffer.from(id===deployment.verifier?deployment.verifierSha256:deployment.tokenSha256,'hex')),amount:'1000000000000000000000000'};},async keys(){return [];}};
 let nextRandom=1;
 const relay=createNearIntentRelay({rpc,signer:{solverId:'22'.repeat(32),async signTransaction(){sent++;throw Error('No authorization');}},journal:{async read(){return structuredClone(retained);},async write(value){retained=structuredClone(value);}},now:()=>1000,random:()=>new Uint8Array(15).fill(nextRandom++)});
 const chosen={action:'swap',privacy:'public',source:{chainId:'near:testnet',accountId:'11'.repeat(32),asset:'nep141:'+deployment.source,amount:'1000000'},destination:{chainId:'near:testnet',accountId:'alice.testnet',asset:'nep141:'+deployment.target,minAmount:'1900000'},deadline:61000};
 const review=await relay.prepare(chosen);
 assert.equal(review.quote.output,'2000000');assert.equal(JSON.parse(review.authorization.payloads[1].message).intents[0].receiver_id,'alice.testnet');assert.equal(sent,0);
 await assert.rejects(relay.prepare({...chosen,privacy:'private'}),/public/);
 await assert.rejects(relay.prepare({...chosen,source:{...chosen.source,amount:'1000001'}}),/at most/);
});

function routeFixture(){
 const user=KeyPair.fromRandom('ed25519'),solver=KeyPair.fromRandom('ed25519'),relayer=KeyPair.fromRandom('ed25519');
 const userId=implicitNearOwner(user.getPublicKey().toString()),solverId=implicitNearOwner(solver.getPublicKey().toString());
 let retained={version:1,requests:{},grants:{},pending:null},random=1,resolved=false,signs=0,broadcasts=0;
 const signPayload=(payload,pair)=>({standard:'nep413',payload:structuredClone(payload),public_key:pair.getPublicKey().toString(),signature:'ed25519:'+base58.encode(pair.sign(nep413Hash(payload)).signature)});
 const rpc={async query(method,args){if(method==='current_salt')return '12345678';if(method==='fee')return 0;if(method==='owner_get')return 'relayer.testnet';if(method==='acl_get_super_admins')return [];if(method==='storage_balance_of')return {total:'1250000000000000000000',available:'0'};if(method==='is_nonce_used')return resolved;if(method==='ft_balance_of')return '2000000';if(method==='mt_batch_balance_of')return args.account_id===userId?['1000000','0']:['0','2000000'];throw Error('Unexpected query '+method);},async account(id){return {code_hash:base58.encode(Buffer.from(id===deployment.verifier?deployment.verifierSha256:deployment.tokenSha256,'hex'))};},async keys(){return [];},async send(){broadcasts++;throw Error('Lost response');},async transaction(){return null;}};
 const signer={solverId,relayerId:'relayer.testnet',solverAccountId:'solver.testnet',signSolver:payload=>signPayload(payload,solver),async signTransaction(call){signs++;const transaction=createTransaction('relayer.testnet',relayer.getPublicKey(),call.receiverId,1n,[actions.functionCall(call.methodName,call.args,BigInt(call.gas),BigInt(call.deposit))],new Uint8Array(32).fill(3));const digest=createHash('sha256').update(encodeTransaction(transaction)).digest(),signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:relayer.sign(digest).signature})});return {senderId:'relayer.testnet',txHash:base58.encode(digest),bytes:Buffer.from(signed.encode()).toString('base64')};}};
 const journal={async read(){return structuredClone(retained);},async write(value){retained=structuredClone(value);}};
 const relay=createNearIntentRelay({rpc,signer,journal,now:()=>1000,random:size=>{const bytes=new Uint8Array(size);new DataView(bytes.buffer).setUint32(0,random++);return bytes;}});
 const chosen={action:'swap',privacy:'public',source:{chainId:'near:testnet',accountId:userId,asset:'nep141:'+deployment.source,amount:'1000000'},destination:{chainId:'near:testnet',accountId:'alice.testnet',asset:'nep141:'+deployment.target,minAmount:'1900000'},deadline:61000};
 async function attempt(){const review=await relay.prepare(chosen),signed=review.authorization.payloads.map(payload=>signPayload(payload,user));return {id:review.id,review,authorization:{intentId:review.id,artifactId:nearAuthorizationId(signed),signed}};}
 function final(){resolved=true;const {signed,call}=retained.pending;return {final_execution_status:'FINAL',transaction:{hash:signed.txHash,signer_id:signed.senderId,receiver_id:call.receiverId,actions:[{FunctionCall:{method_name:call.methodName,args:Buffer.from(JSON.stringify(call.args)).toString('base64'),gas:call.gas,deposit:call.deposit}}]},status:{SuccessValue:''},receipts_outcome:[{id:'final-transfer-receipt',outcome:{executor_id:deployment.target,status:{SuccessValue:''},logs:['EVENT_JSON:'+JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{old_owner_id:deployment.verifier,new_owner_id:'alice.testnet',amount:'2000000'}]})]}}]};}
 return {relay,rpc,signer,chosen,attempt,final,state:()=>retained,counts:()=>({signs,broadcasts}),signPayload:userPayload=>signPayload(userPayload,user)};
}

function expirySnapshot(f,{timestamp='61000000001',used=false}={}){
 const nonces=[];f.rpc.finalSnapshot=async()=>({header:{hash:base58.encode(new Uint8Array(32).fill(7)),height:17,timestamp_nanosec:timestamp},account:id=>f.rpc.account(id),keys:id=>f.rpc.keys(id),query:async(method,args,id)=>{if(method==='is_nonce_used'){nonces.push(args);return typeof used==='function'?used(args):used;}return f.rpc.query(method,args,id);}});return nonces;
}
test('an expired recovered authorization retains its fence when a final view cannot distinguish pruned nonces',async()=>{
 const f=routeFixture(),attempt=await f.attempt(),nonces=expirySnapshot(f),outcome=await f.relay.reconcile(structuredClone(attempt));
 assert.equal(outcome.status,'unknown');assert.equal(outcome.verified,false);assert.equal(outcome.permissionExpired,true);assert.equal(outcome.resubmissionSafe,false);assert.equal(nonces.length,3);assert.equal(outcome.evidence.timestampNanosec,'61000000001');assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 assert.throws(()=>createNearIntentService({}).validateOutcome({...outcome,status:'expired'},attempt));for(const change of [e=>e.nonces[0].nonce='changed',e=>e.nonces[0].used=true,e=>e.timestampNanosec='61000000000',e=>e.configHash='changed']){const forged=structuredClone(outcome);change(forged.evidence);assert.throws(()=>createNearIntentService({}).validateOutcome({...forged,status:'expired'},attempt));}
 assert.equal((await f.relay.reconcile(attempt)).status,'unknown');assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 const forged=structuredClone(attempt);forged.authorization.signed[0].signature='ed25519:'+base58.encode(new Uint8Array(64));forged.authorization.artifactId=nearAuthorizationId(forged.authorization.signed);await assert.rejects(f.relay.reconcile(forged),/signature|authorization/);
});
test('an unavailable recovered signature retains its exact saved review without inventing an artifact',async()=>{
 const f=routeFixture(),attempt=await f.attempt();attempt.authorization=null;attempt.status='approval-unresolved';expirySnapshot(f);const result=await f.relay.reconcile(attempt);assert.equal(result.status,'unknown');assert.equal(result.permissionExpired,true);assert.equal(result.artifactId,undefined);assert.equal(result.evidence.authorizationRecovered,false);assert.throws(()=>createNearIntentService({}).validateOutcome({...result,status:'expired'},attempt));assert.equal((await f.relay.reconcile(attempt)).status,'unknown');assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 const missing=routeFixture(),unknown=await missing.attempt();unknown.authorization=null;unknown.status='approval-unresolved';assert.equal((await missing.relay.reconcile(unknown)).status,'unknown');const altered=structuredClone(attempt);altered.review.destination.accountId='mallory.testnet';await assert.rejects(f.relay.reconcile(altered),/changed/);
});
test('local expiry, consumed nonces, an unverified deployment and pending transactions cannot release a request',async()=>{
 for(const options of [{timestamp:'61000000000'},{used:args=>args.account_id!=='impossible'}]){const f=routeFixture(),attempt=await f.attempt();expirySnapshot(f,options);assert.equal((await f.relay.reconcile(attempt)).status,'unknown');}
 const f=routeFixture(),attempt=await f.attempt();expirySnapshot(f);f.rpc.account=async()=>({code_hash:'changed'});assert.equal((await f.relay.reconcile(attempt)).status,'unknown');
 const pending=routeFixture(),signed=await pending.attempt();await pending.relay.submit(signed);pending.rpc.finalSnapshot=async()=>{assert.fail('A pending transaction cannot be released by nonce expiry');};assert.equal((await pending.relay.reconcile(signed)).status,'unknown');
});
test('the final snapshot adapter pins every expiry query to one block and rejects substituted query blocks',async()=>{
 const header={hash:base58.encode(new Uint8Array(32).fill(8)),height:18,timestamp_nanosec:'61000000001'},calls=[];
 const view=await createNearIntentFinalSnapshot(async(method,params)=>{calls.push({method,params});if(method==='block')return {header};return {block_hash:header.hash,block_height:header.height,result:[102,97,108,115,101],keys:[],code_hash:'pinned'};})();
 assert.equal(await view.query('is_nonce_used',{nonce:'exact'},deployment.verifier),false);await view.account(deployment.verifier);await view.keys(deployment.verifier);assert(calls.slice(1).every(call=>call.params.block_id===header.hash&&!Object.hasOwn(call.params,'finality')));
 const wrong=await createNearIntentFinalSnapshot(async method=>method==='block'?{header}:{block_hash:'another',block_height:18,result:[102,97,108,115,101]})();await assert.rejects(wrong.query('is_nonce_used',{},deployment.verifier),/block/);
});
test('a consumed nonce pruned after expiry cannot be presented as unspent funds',async()=>{
 const f=routeFixture(),attempt=await f.attempt();expirySnapshot(f,{used:false});
 // The pinned bitmap implementation returns false for both never-used nonces
 // and committed prefixes removed by cleanup_nonces after expiry.
 assert.equal((await f.relay.reconcile(attempt)).status,'unknown');assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
});
test('lost submission retains one exact signed transaction and reconciliation does not sign or rebroadcast',async()=>{
 const f=routeFixture(),attempt=await f.attempt();const first=await f.relay.submit(attempt);assert.equal(first.status,'unknown');assert(f.state().pending.signed.bytes.length>100);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 assert.equal((await f.relay.submit(attempt)).status,'unknown');assert.equal((await f.relay.reconcile(attempt)).status,'unknown');assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 f.rpc.transaction=async()=>f.final();const result=await f.relay.reconcile(attempt);assert.equal(result.status,'executed');assert.equal(result.verified,true);assert.equal(result.evidence.outputAmount,'2000000');assert.equal(f.state().pending,null);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 assert.deepEqual(await f.relay.submit(attempt),result);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
});
test('changed beneficiaries and forged signatures never reach the relayer',async()=>{
 const f=routeFixture(),attempt=await f.attempt(),changed=structuredClone(attempt);changed.review.destination.accountId='mallory.testnet';await assert.rejects(f.relay.submit(changed),/changed/);
 const forged=structuredClone(attempt),raw=base58.decode(forged.authorization.signed[0].signature.slice(8));raw[0]^=1;forged.authorization.signed[0].signature='ed25519:'+base58.encode(raw);forged.authorization.artifactId=nearAuthorizationId(forged.authorization.signed);await assert.rejects(f.relay.submit(forged),/Invalid user/);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
});
test('a different final transaction and a failed external receipt cannot establish settlement',async()=>{
 const f=routeFixture(),attempt=await f.attempt();await f.relay.submit(attempt);
 f.rpc.transaction=async()=>({...f.final(),transaction:{...f.final().transaction,hash:'another-transaction'}});await assert.rejects(f.relay.reconcile(attempt),/another transaction/);assert(f.state().pending);
 f.rpc.transaction=async()=>{const final=f.final();final.receipts_outcome[0].outcome.status={Failure:{ActionError:{kind:'transfer failed'}}};return final;};const result=await f.relay.reconcile(attempt);assert.equal(result.status,'unknown');assert.equal(result.verified,false);assert.equal(f.state().requests[attempt.id].finalReceipt.success,false);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
});
test('unsigned funding and quote preparations cannot exhaust the durable request journal',async()=>{
 const f=routeFixture();
 for(let index=0;index<110;index++){
  const quote=await f.relay.prepare(f.chosen);
  const grant=await f.relay.prepareFunds({owner:f.chosen.source.accountId});
  assert.equal(quote.quote.output,'2000000');assert.equal(grant.sourceAmount,'1000000');
 }
 assert.deepEqual(f.state(),{version:1,requests:{},grants:{},pending:null});
 assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 const anotherGrant=await f.relay.prepareFunds({owner:'44'.repeat(32)});assert.equal(anotherGrant.owner,'44'.repeat(32));
});
test('a temporary final-view outage retains the original transaction for later verification',async()=>{
 const f=routeFixture(),attempt=await f.attempt();await f.relay.submit(attempt);
 f.rpc.transaction=async()=>f.final();const query=f.rpc.query;
 f.rpc.query=async(method,...args)=>{if(method==='is_nonce_used')throw Error('Temporary final-view outage');return query(method,...args);};
 const first=await f.relay.reconcile(attempt);assert.equal(first.status,'unknown');assert(f.state().pending);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 f.rpc.query=query;const recovered=await f.relay.reconcile(attempt);
 assert.equal(recovered.status,'executed');assert.equal(recovered.verified,true);assert.equal(f.state().pending,null);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
});
test('an authorization without a transaction artifact can continue explicitly after a read-only status check',async()=>{
 const f=routeFixture(),attempt=await f.attempt(),signTransaction=f.signer.signTransaction;
 f.signer.signTransaction=async()=>{throw Error('No final block available');};
 await assert.rejects(f.relay.submit(attempt),/No final block/);
 assert.equal(f.state().pending,null);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 const checked=await f.relay.reconcile(attempt);
 assert.equal(checked.status,'unknown');assert.equal(checked.resubmissionSafe,true);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
 f.signer.signTransaction=signTransaction;
 const submitted=await f.relay.submit(attempt);assert.equal(submitted.status,'unknown');assert(f.state().pending);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 await f.relay.submit(attempt);const pending=await f.relay.reconcile(attempt);
 assert.notEqual(pending.resubmissionSafe,true);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 f.rpc.transaction=async()=>f.final();const result=await f.relay.reconcile(attempt);
 assert.equal(result.status,'executed');assert.equal(result.verified,true);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
});
test('reconciling a final partial funding stage does not sign or broadcast the remaining grant calls',async()=>{
 const f=routeFixture(),review=await f.relay.prepareFunds({owner:f.chosen.source.accountId}),signed=f.signPayload(review.payload);
 const submitted=await f.relay.addFunds({review,signed});assert.equal(submitted.status,'unknown');assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 let queries=0;f.rpc.transaction=async()=>{queries++;return f.final();};
 const checked=await f.relay.reconcileFunds({id:review.id});
 assert.equal(checked.status,'funding-incomplete');assert.equal(queries,1);assert.equal(f.state().pending,null);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
 assert.equal((await f.relay.reconcileFunds({id:review.id})).status,'funding-incomplete');assert.equal(queries,1);assert.deepEqual(f.counts(),{signs:1,broadcasts:1});
});
test('current external LTT holdings are observed separately and an unavailable view remains unknown',async()=>{
 const f=routeFixture(),status=await f.relay.status({owner:f.chosen.source.accountId});assert.equal(status.sourceBalance,'1000000');assert.equal(status.resultBalance,'0');assert.equal(status.externalResultBalance,'2000000');
 const query=f.rpc.query;f.rpc.query=async(method,...args)=>{if(method==='ft_balance_of')throw Error('Unavailable final external view');return query(method,...args);};assert.equal((await f.relay.status({owner:f.chosen.source.accountId})).externalResultBalance,null);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
});
test('runtime readiness rejects a verifier with administrative authority despite unchanged deployed code',async()=>{
 const f=routeFixture(),query=f.rpc.query;f.rpc.query=async(method,...args)=>method==='acl_get_super_admins'?['controller.testnet']:query(method,...args);await assert.rejects(f.relay.configuration(),/authority/);await assert.rejects(f.relay.prepare(f.chosen),/authority/);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
});
test('funding availability requires the configured relayer to own both live test assets',async()=>{
 const f=routeFixture(),configuration=await f.relay.configuration();assert.equal(configuration.fundingAvailable,true);assert.equal(configuration.fundingOwner,'relayer.testnet');
 const query=f.rpc.query;f.rpc.query=async(method,...args)=>method==='owner_get'?'different-owner.testnet':query(method,...args);assert.equal((await f.relay.configuration()).fundingAvailable,false);await assert.rejects(f.relay.prepareFunds({owner:f.chosen.source.accountId}),/not the owner/);assert.deepEqual(f.counts(),{signs:0,broadcasts:0});
});
