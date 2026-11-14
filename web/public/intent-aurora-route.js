import {intentOwner} from './intent-workspace.js';
import {requireIntentActionBackup} from './account-sync.js';
import {AURORA_INTENT_DEPLOYMENT as d} from './intent-aurora-config.js';
import {AURORA_SWAP_CHAIN,checkAuroraSwapSelection,checkAuroraSwapSnapshot,buildAuroraSwapReview,checkAuroraSwapReview,buildAuroraSwapAuthorization,checkAuroraSwapAuthorization,auroraSwapPublicRequest,sameAuroraSwapValue} from './intent-aurora-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
export function createAuroraSwapSource(source){
 function identity(){const value=source.identity();return value?{...value,chainId:AURORA_SWAP_CHAIN}:null;}
 return Object.freeze({identity,capture(){const lease=source.capture();return Object.freeze({...lease,identity:{...lease.identity,chainId:AURORA_SWAP_CHAIN}});}});
}
export function createAuroraIntentService({source,account,store,fetchImpl=fetch,backupAction=requireIntentActionBackup,now=Date.now}={}){
 check(source&&account&&store,'Connect the original private source and receiving account.');
 async function request(path,body,{signal}={}){
  check(navigator.onLine,'Reconnect to check the original private swap.');signal?.throwIfAborted();
  const response=await fetchImpl(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
  check(response.body,'The private swap service response is unavailable.');const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;check(length<=2000000,'The private swap response exceeds its read boundary.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('The private swap response cannot be read.');}
  check(response.ok,result?.error??'The original private swap cannot be verified.');return result;
 }
 function own(selection,lease){
  lease.assertCurrent();const receiver=account.capture();receiver.assertCurrent();
  check(lease.identity.chainId===AURORA_SWAP_CHAIN&&lease.identity.accountId===selection.source.accountId&&receiver.identity.chainId===AURORA_SWAP_CHAIN&&receiver.identity.address===selection.destination.accountId&&receiver.identity.lenzIdentity===lease.identity.lenzIdentity,'Use the original note and backed-up receiving account.');return receiver;
 }
 async function snapshot(receiver,options){const observed=await request('/api/intent-aurora/snapshot',{owner:receiver.identity.address,beneficiary:receiver.identity.address},options);receiver.assertCurrent();return checkAuroraSwapSnapshot(observed,{now:now()});}
 function checkOriginalPlan(value,review){check(value?.available===true&&value.execute===true&&value.vault===review.vault&&value.root===review.spend.root&&value.nullifierHash===review.spend.nullifierHash&&sameAuroraSwapValue(value.plan,review.plan),'The original private factory plan changed or is unavailable.');}
 async function verifyPlan(review,options){const value=await request('/api/intent-aurora-swap/prepare',{plan:review.plan,vault:review.vault,root:review.spend.root,nullifierHash:review.spend.nullifierHash},options);checkOriginalPlan(value,review);return value;}
 async function backup(review,lease,options){
  const receiver=own(review,lease);await lease.requireRecovery(review.source.commitment,options);lease.assertCurrent();await receiver.requireRecovery({latest:true,...options});receiver.assertCurrent();
  await backupAction(lease.identity.lenzIdentity,intentOwner(review.source),review.id,options);lease.assertCurrent();receiver.assertCurrent();return receiver;
 }
 async function retainedAuthorization(review,authorization){
  const records=await store.read(intentOwner(review.source)),attempt=records.attempts.find(row=>row.id===review.id);check(attempt&&sameAuroraSwapValue(attempt.review,review)&&sameAuroraSwapValue(attempt.authorization,authorization)&&['authorized','submission-unresolved'].includes(attempt.status),'Retain the exact approved private request before dispatch.');
 }
 async function capabilities(selection,options={}){
  try{checkAuroraSwapSelection(selection,{now:now()});own(selection,createAuroraSwapSource(source).capture());const config=await request('/api/intent-aurora-swap/config',{},options);return {available:config.available===true,execute:config.execute===true,privacy:'private',reason:config.reason};}
  catch(error){options.signal?.throwIfAborted();return {available:false,execute:false,privacy:'private',reason:error.message};}
 }
 async function prepare(selection,lease,options={}){
  const chosen=checkAuroraSwapSelection(selection,{now:now()}),receiver=own(chosen,lease),observed=await snapshot(receiver,options);lease.assertCurrent();
  const spend=await lease.prepareSpend(chosen.source.commitment,observed,options);own(chosen,lease);
  const salt='0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const review=buildAuroraSwapReview(chosen,spend,{snapshot:observed,salt,now:now()});await verifyPlan(review,options);own(chosen,lease);return review;
 }
 async function authorize(review,lease,options={}){
  let proving=false;
  try{
   checkAuroraSwapReview(review,review,{now:now()});own(review,lease);const original=await lease.originalSpendAuthority(review);if(original)return checkAuroraSwapAuthorization(original,review);
   const receiver=await backup(review,lease,options),fresh=await snapshot(receiver,options);check(!fresh.pool.withdrawals.some(row=>row.nullifierHash===review.spend.nullifierHash)&&fresh.pool.commitments.includes(review.source.commitment),'The original private note was already spent.');
   const spend=await lease.prepareSpend(review.source.commitment,review.snapshot,{...options,allowStale:true});check(sameAuroraSwapValue(spend,review.spend),'The reviewed original note or commitment path changed.');await verifyPlan(review,options);own(review,lease);check(review.deadline>now(),'The private swap deadline passed.');
   proving=true;const result=await lease.prove(review.source.commitment,{root:review.spend.root,recipient:review.vault,relayer:review.plan.relayer,fee:review.plan.relayerFee,refund:'0',pathElements:review.spend.pathElements,pathIndices:review.spend.pathIndices},{...options,review});own(review,lease);
   const authorization=buildAuroraSwapAuthorization(review,result);await lease.retainSpendAuthority(review,authorization);return authorization;
  }catch(error){if(!proving)error.code='AURORA_PROOF_NOT_CREATED';throw error;}
 }
 async function submit(attempt,options={}){
  const review=checkAuroraSwapReview(attempt.review,attempt.review,{now:now()}),authorization=checkAuroraSwapAuthorization(attempt.authorization,review),lease=createAuroraSwapSource(source).capture();
  await retainedAuthorization(review,authorization);await backup(review,lease,options);own(review,lease);check(review.deadline>now(),'The original private permission expired. Check its status.');
  return request('/api/intent-aurora-swap/submit',auroraSwapPublicRequest(attempt),options);
 }
 function validateOutcome(value,attempt){
  const review=checkAuroraSwapReview(attempt.review,attempt.review,{allowExpired:true});checkAuroraSwapAuthorization(attempt.authorization,review);
  check(value?.intentId===attempt.id&&value.artifactId===attempt.authorization.artifactId&&['pending','unknown','executed','refunded'].includes(value.status),'The private swap result belongs to another request.');
  if(['executed','refunded'].includes(value.status)){
   const e=value.evidence;check(value.verified===true&&e?.network==='testnet'&&e.vault===review.vault&&e.nullifierHash===review.spend.nullifierHash&&e.beneficiary===review.plan.beneficiary&&e.inputAsset===d.inputToken&&e.inputAmount===d.denomination&&Array.isArray(e.receiptIds)&&e.receiptIds.length>0&&typeof e.transaction==='string'&&e.transaction.length>20&&e.allowance==='0','The original private withdrawal and result have not been checked.');
   check(value.status==='executed'?e.outputAsset===d.outputToken&&e.outputAmount===d.outputAmount:e.refundRecipient===review.plan.refundRecipient&&e.refundAsset===d.inputToken&&e.refundAmount===d.denomination,'The private swap output or refund changed.');
  }else check(value.verified!==true,'An unresolved private result cannot be verified.');return structuredClone(value);
 }
 async function recover(attempt,operation,options={}){
  check(['recover','withdrawRefund'].includes(operation)&&attempt.outcome?.recovery?.available===true&&attempt.outcome.recovery.operation===operation,'Check the original private recovery status first.');
  const review=checkAuroraSwapReview(attempt.review,attempt.review,{allowExpired:true}),authorization=checkAuroraSwapAuthorization(attempt.authorization,review),lease=createAuroraSwapSource(source).capture();await retainedAuthorization(review,authorization);await backup(review,lease,options);own(review,lease);
  return request('/api/intent-aurora-swap/recover',{request:auroraSwapPublicRequest(attempt),operation},options);
 }
 return Object.freeze({capabilities,prepare,validateReview:(review,chosen)=>checkAuroraSwapReview(review,chosen,{now:now()}),authorityId:review=>'aurora:'+d.pool+':'+review.spend.nullifierHash,authorize,authorizationNotCreated:error=>error?.code==='AURORA_PROOF_NOT_CREATED',validateAuthorization:checkAuroraSwapAuthorization,submit,reconcile:(attempt,options={})=>request('/api/intent-aurora-swap/reconcile',auroraSwapPublicRequest(attempt),options),recover,recoverAuthorization:attempt=>source.capture().originalSpendAuthority(attempt.review).then(value=>{check(value,'The original local proof has not been retained.');return value;}),validateOutcome,outcomeRetained(){dispatchEvent(new Event('lenz-aurora-intent'));}});
}
