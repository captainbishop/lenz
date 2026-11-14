import {readState,updateState} from './chat-store.js';
import {base64} from './intents-vendor/codecs.js';
import {createTornadoProver} from './tornado-prover.js';
import {verifyNearIntentSigned} from './intent-near-route.js';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './intent-aurora-config.js';
import {auroraFundingOwner,checkAuroraFundingReview,checkAuroraFundingSigned} from './intent-aurora-funding-plan.js';
import {checkAuroraSwapSnapshot,checkAuroraSwapReview,checkAuroraSwapAuthorization,buildAuroraSwapAuthorization,sameAuroraSwapValue} from './intent-aurora-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const utf8=value=>new TextEncoder().encode(value),domain='lenz/aurora-notes/v1';
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const aad=(owner,publicKey)=>utf8(JSON.stringify([domain,owner,publicKey]));
const states=['note','review','signed','dispatch-unresolved','funding-pending','funded','failed'];
function records(value,owner){
 check(Array.isArray(value)&&value.length<=50&&JSON.stringify(value).length<=1_000_000,'The private note history is invalid.');
 const commitments=new Set(),ids=new Set();
 for(const row of value){
  check(row&&row.note?.version===1&&states.includes(row.state)&&Number.isSafeInteger(row.createdAt)&&row.createdAt>0&&!commitments.has(row.note.commitment),'The original private notes conflict.');commitments.add(row.note.commitment);
  if(row.review){checkAuroraFundingReview(row.review,{allowExpired:true});check(row.review.owner===owner&&row.review.commitment===row.note.commitment&&!ids.has(row.review.id),'The private grant belongs to another note.');ids.add(row.review.id);}
  if(row.signed){check(row.review,'The signed private grant has no review.');checkAuroraFundingSigned(row.signed,row.review);}
  if(['signed','dispatch-unresolved','funding-pending','funded'].includes(row.state))check(row.signed,'The original private grant approval is missing.');
  if(row.state==='funded')check(row.outcome?.funded,'The original private note has no deposit evidence.');
  if(row.outcome)checkOutcome(row.outcome,row.review);
  check(row.history===undefined||Array.isArray(row.history)&&row.history.length<=50,'The original private grant history is invalid.');
  for(const old of row.history??[]){checkAuroraFundingReview(old.review,{allowExpired:true});check(old.review.owner===owner&&old.review.commitment===row.note.commitment&&!ids.has(old.review.id),'The original private grant history conflicts.');ids.add(old.review.id);if(old.signed)checkAuroraFundingSigned(old.signed,old.review);if(old.outcome)checkOutcome(old.outcome,old.review);}
  check(row.spendAuthority===undefined||row.spendAuthority&&typeof row.spendAuthority==='object','The original private spend authority is invalid.');
  if(row.spendAuthority){const {review,authorization}=row.spendAuthority;checkAuroraSwapReview(review,review,{allowExpired:true});checkAuroraSwapAuthorization(authorization,review);check(review.source.accountId===row.review?.owner&&review.source.commitment===row.note.commitment&&review.spend.nullifierHash===row.note.nullifierHash,'The private spend authority belongs to another note.');}
 }
 return structuredClone(value);
}
function checkOutcome(outcome,review){
 check(review&&outcome?.id===review.id&&outcome.commitment===review.commitment&&outcome.network==='testnet'&&outcome.chainId===deployment.chainId&&outcome.pool===deployment.pool&&outcome.asset===deployment.inputToken&&outcome.amount===deployment.denomination&&['pending','confirmed','failed'].includes(outcome.state),'The private funding result belongs to another request.');
 if(outcome.funded){const deposit=outcome.deposit;check(outcome.verified===true&&deposit?.pool===deployment.pool&&deposit.commitment===review.commitment&&typeof deposit.transaction==='string'&&Number.isSafeInteger(deposit.index)&&deposit.index>=0&&deposit.index<4096&&Array.isArray(deposit.receiptIds)&&deposit.receiptIds.length>0,'The original pool deposit has not been verified.');}
 return structuredClone(outcome);
}
async function decode(state,identity){
 check(state.identity?.profile.id===identity,'Open the original private funding account.');const box=state.auroraIntentNotes;if(!box)return null;
 check(box.version===1&&box.owner===identity&&box.key?.algorithm?.name==='AES-GCM'&&box.key.extractable===false,'The private note storage is incomplete.');
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:base64.decode(box.iv),additionalData:aad(identity,box.publicKey)},box.key,base64.decode(box.ciphertext)));
 try{return {owner:box.owner,publicKey:box.publicKey,records:records(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),auroraFundingOwner(box.publicKey))};}finally{raw.fill(0);}
}
async function encode(state,identity,publicKey,rows,key=state.auroraIntentNotes?.key){
 const checked=records(rows,auroraFundingOwner(publicKey)),raw=utf8(JSON.stringify(checked)),iv=crypto.getRandomValues(new Uint8Array(12));key??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(identity,publicKey)},key,raw);state.auroraIntentNotes={version:1,owner:identity,publicKey,key,iv:base64.encode(iv),ciphertext:base64.encode(new Uint8Array(ciphertext))};}finally{raw.fill(0);}
 return checked;
}
export async function snapshotAuroraNoteRecovery(state){
 const snapshot=await decode(state,state.identity?.profile.id);return snapshot?{type:domain,...snapshot}:null;
}
export async function validateAuroraNoteRecovery(input,identity,nearSource,{prover}={}){
 input=structuredClone(input);check(input?.type===domain&&input.owner===identity?.profile.id&&input.publicKey===nearSource?.publicKey&&JSON.stringify(input).length<=1_000_000,'Private note recovery belongs to another source.');
 const checked=records(input.records,auroraFundingOwner(input.publicKey)),local=prover??createTornadoProver();
 try{for(const row of checked){check(await local.validateNote(row.note),'The recovered original note failed its cryptographic check.');if(row.signed)await verifyNearIntentSigned(row.signed);for(const old of row.history??[])if(old.signed)await verifyNearIntentSigned(old.signed);}}finally{if(!prover)local.dispose();}
 return {type:domain,owner:input.owner,publicKey:input.publicKey,records:checked};
}
export async function restoreAuroraNoteRecovery(state,input,nearSource){
 const snapshot=await validateAuroraNoteRecovery(input,state.identity,nearSource),current=await decode(state,state.identity.profile.id),merged=new Map((current?.records??[]).map(row=>[row.note.commitment,row]));
 check(!current||current.publicKey===snapshot.publicKey,'The private funding identity changed.');
 for(const row of snapshot.records){const saved=merged.get(row.note.commitment);check(!saved||equal(saved.note,row.note)&&(!saved.review||!row.review||equal(saved.review,row.review))&&(!saved.signed||!row.signed||equal(saved.signed,row.signed)),'The original private note or grant conflicts.');
  if(!saved)merged.set(row.note.commitment,row);else{
   check(!saved.spendAuthority||!row.spendAuthority||sameAuroraSwapValue(saved.spendAuthority,row.spendAuthority),'The original private spend authority conflicts.');
   const authority=saved.spendAuthority??row.spendAuthority;
   if(states.indexOf(row.state)>states.indexOf(saved.state))merged.set(row.note.commitment,{...row,...(authority?{spendAuthority:authority}:{})});else if(authority)saved.spendAuthority=structuredClone(authority);
  }
 }
 await encode(state,snapshot.owner,snapshot.publicKey,[...merged.values()],await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));return snapshot;
}
export function createAuroraIntentSource(identity,{nearSource,prover=createTornadoProver(),backupState=async()=>{const {backupNow}=await import('./account-sync.js');await backupNow();}}={}){
 check(typeof identity==='string'&&nearSource,'Create the recoverable private funding source first.');let generation=0,connected=null;
 const guard=ticket=>check(ticket===generation&&connected&&nearSource.identity()?.publicKey===connected.publicKey,'The private funding account changed.');
 async function connect(){
  const ticket=++generation,near=nearSource.identity()??await nearSource.connect();
  await updateState(async state=>{check(state.identity?.profile.id===identity&&state.nearIntentSource?.publicKey===near.publicKey,'Choose the original private funding identity.');const saved=await decode(state,identity);check(!saved||saved.publicKey===near.publicKey,'The private note owner changed.');if(!saved)await encode(state,identity,near.publicKey,[]);});
  check(ticket===generation,'The private source connection changed.');connected={chainId:deployment.chainId,accountId:near.accountId,publicKey:near.publicKey,lenzIdentity:identity};return structuredClone(connected);
 }
 async function update(operation,ticket=generation){
  guard(ticket);const key=connected.publicKey;return updateState(async state=>{guard(ticket);check(state.identity?.profile.id===identity&&state.nearIntentSource?.publicKey===key,'The private funding identity changed.');const saved=await decode(state,identity);check(saved?.publicKey===key,'The private note key changed.');await operation(saved.records);guard(ticket);return encode(state,identity,key,saved.records);});
 }
 async function requireRecovery(commitment,{signal}={}){
  const ticket=generation;guard(ticket);signal?.throwIfAborted();let state=await readState(),saved=await decode(state,identity),row=saved?.records.find(row=>row.note.commitment===commitment);check(row,'Keep the original private note.');const version=state.accountSync?.version;
  check(Number.isSafeInteger(version)&&version>0,'Save an account backup before funding this private note.');await nearSource.capture().requireRecovery();await backupState();guard(ticket);signal?.throwIfAborted();state=await readState();saved=await decode(state,identity);
  check(saved?.publicKey===connected.publicKey&&state.accountSync?.savedVersion>=version&&state.accountSync.auroraNotesBackup?.version>=version&&state.accountSync.auroraNotesBackup.publicKey===connected.publicKey&&state.accountSync.auroraNotesBackup.commitments.includes(commitment),'Your private note and current request are not backed up yet. Keep this note and try the same request again.');
  await nearSource.capture().requireRecovery();guard(ticket);
 }
 async function createNote(){
  const ticket=generation;guard(ticket);const current=await decode(await readState(),identity);if(current.records.length)return current.records.at(-1).note.commitment;
  const note=await prover.generateNote();guard(ticket);check(await prover.validateNote(note),'The generated private note failed its integrity check.');
  const saved=await update(rows=>{check(rows.length<50,'The private note limit was reached.');check(!rows.some(row=>row.state!=='funded'&&row.state!=='failed'),'Finish or check the original private funding request first.');rows.push({note,state:'note',createdAt:Date.now(),review:null,signed:null,outcome:null});},ticket);return saved.at(-1).note.commitment;
 }
 async function saveReview(review){
  checkAuroraFundingReview(review);check(review.owner===connected?.accountId,'The private grant owner changed.');await update(rows=>{const row=rows.find(row=>row.note.commitment===review.commitment);check(row,'Keep the original private note.');
   if(row.review&&!equal(row.review,review)){const unsigned=!row.signed&&(row.state==='note'||row.review.deadline<=Date.now()),cleaned=row.outcome?.cancelled===true&&row.outcome.cleanupComplete===true&&!row.outcome.funded;check(unsigned||cleaned,'Check the original signed private grant before another review.');row.history??=[];row.history.push({review:row.review,signed:row.signed,outcome:row.outcome});row.signed=null;row.outcome=null;}
   check(!row.signed,'Check the original private grant.');row.review=structuredClone(review);row.state='review';});return structuredClone(review);
 }
 async function signFunding(id,{signal}={}){
  const ticket=generation;guard(ticket);const saved=await decode(await readState(),identity),row=saved?.records.find(row=>row.review?.id===id);check(row?.review,'Review the original private grant.');if(row.signed)return structuredClone(row.signed);
  await requireRecovery(row.note.commitment,{signal});guard(ticket);const signed=await nearSource.capture().signNep413(row.review.payload,{signal});checkAuroraFundingSigned(signed,row.review);await verifyNearIntentSigned(signed);
  await update(rows=>{const retained=rows.find(row=>row.review?.id===id);check(retained&&equal(retained.review,row.review)&&!retained.signed,'The original private grant changed.');retained.signed=structuredClone(signed);retained.state='signed';},ticket);return signed;
 }
 async function beginDispatch(id,{signal}={}){
  const ticket=generation;guard(ticket);const saved=await update(rows=>{const row=rows.find(row=>row.review?.id===id);check(row?.signed&&!row.outcome?.cleanupComplete,'Check the original private grant.');row.state=row.outcome?.funded?'funded':'dispatch-unresolved';},ticket),row=saved.find(row=>row.review?.id===id);
  await requireRecovery(row.note.commitment,{signal});guard(ticket);return {review:structuredClone(row.review),signed:structuredClone(row.signed)};
 }
 async function saveOutcome(id,result){return update(rows=>{const row=rows.find(row=>row.review?.id===id);check(row?.signed,'The original private grant is missing.');const outcome=checkOutcome(result,row.review);check(!row.outcome?.funded||outcome.funded,'The original confirmed private funding cannot be erased.');row.outcome=outcome;row.state=outcome.funded?'funded':outcome.state==='failed'?'failed':'funding-pending';});}
 async function snapshot(){
  guard(generation);const saved=await decode(await readState(),identity);return saved.records.map(row=>({commitment:row.note.commitment,state:row.state,createdAt:row.createdAt,review:row.review,signed:row.signed,outcome:row.outcome,history:row.history??[]}));
 }
 async function holdings(observed){
  const ticket=generation;guard(ticket);check(observed?.network==='testnet'&&observed.chainId===deployment.chainHex&&observed.pool?.address===deployment.pool&&observed.pool.denomination===deployment.denomination&&observed.pool.levels===20&&Object.entries(deployment.codeSha256).every(([name,digest])=>observed.codes?.[name]===digest),'The original private pool snapshot changed.');
  check(Number.isSafeInteger(observed.observedAt)&&Math.abs(Date.now()-observed.observedAt)<=120000&&/^0x[0-9a-f]{64}$/.test(observed.block?.hash)&&Array.isArray(observed.pool.commitments)&&observed.pool.commitments.length===observed.pool.nextIndex&&observed.pool.commitments.length<=4096&&Array.isArray(observed.pool.deposits)&&observed.pool.deposits.length===observed.pool.nextIndex&&Array.isArray(observed.pool.withdrawals),'The complete final private pool history is unavailable.');
  const currentState=await readState(),saved=await decode(currentState,identity),owned=[];
  const {snapshotIntentActionRecovery}=await import('./intent-action-store.js'),actions=await snapshotIntentActionRecovery(currentState);guard(ticket);
  for(const row of saved.records){
   const index=observed.pool.commitments.indexOf(row.note.commitment);if(index<0)continue;const deposit=observed.pool.deposits[index];check(deposit?.index===index&&deposit.commitment===row.note.commitment,'The original private note deposit changed.');
   check(await prover.validateNote(row.note),'The private note failed its integrity check.');const path=await prover.buildMerklePath(observed.pool.commitments,index);guard(ticket);check(path.root===observed.pool.root,'The original private pool history is incomplete.');
   check(observed.pool.withdrawals.every(withdrawal=>/^0x[0-9a-f]{64}$/.test(withdrawal.nullifierHash)),'The final private withdrawal history is invalid.');
   if(observed.pool.withdrawals.some(withdrawal=>withdrawal.nullifierHash===row.note.nullifierHash))continue;
   const pending=!!row.spendAuthority||actions.some(record=>record.journal.attempts.some(attempt=>attempt.review.source.commitment===row.note.commitment&&!['declined','executed','refunded'].includes(attempt.status)));
   owned.push({chainId:deployment.chainId,asset:deployment.inputToken,accountId:connected.accountId,symbol:'LTS',decimals:6,amount:deployment.denomination,available:pending?null:deployment.denomination,pending,custody:'Original Tornado pool note',privacy:'pool-withdrawal',commitment:row.note.commitment,observedAt:observed.observedAt,block:structuredClone(observed.block)});
  }
  guard(ticket);return owned;
 }
 async function prepareSpend(commitment,observed,{signal,allowStale=false}={}){
  const ticket=generation;guard(ticket);signal?.throwIfAborted();checkAuroraSwapSnapshot(observed,{allowStale});
  const saved=await decode(await readState(),identity),row=saved.records.find(row=>row.note.commitment===commitment);check(row?.outcome?.funded,'Verify the original private note funding first.');
  const index=observed.pool.commitments.indexOf(commitment);check(index>=0&&!observed.pool.withdrawals.some(withdrawal=>withdrawal.nullifierHash===row.note.nullifierHash),'The original private note is absent or spent.');
  check(await prover.validateNote(row.note,{signal}),'The original private note failed its integrity check.');guard(ticket);
  const path=await prover.buildMerklePath(observed.pool.commitments,index,{signal});guard(ticket);check(path.root===observed.pool.root,'The original private note history does not match the final root.');
  return {commitment,root:path.root,nullifierHash:row.note.nullifierHash,pathElements:path.pathElements,pathIndices:path.pathIndices};
 }
 async function retainSpendAuthority(review,authorization){
  checkAuroraSwapReview(review,review,{allowExpired:true});checkAuroraSwapAuthorization(authorization,review);
  await update(rows=>{const row=rows.find(row=>row.note.commitment===review.source.commitment);check(row?.outcome?.funded&&review.source.accountId===connected.accountId&&review.spend.nullifierHash===row.note.nullifierHash,'The original private spend owner changed.');const authority={review,authorization};check(!row.spendAuthority||sameAuroraSwapValue(row.spendAuthority,authority),'Keep and check the original private spend authority.');row.spendAuthority=structuredClone(authority);});return structuredClone(authorization);
 }
 async function originalSpendAuthority(review){
  const ticket=generation;guard(ticket);const saved=await decode(await readState(),identity),row=saved.records.find(row=>row.note.commitment===review.source.commitment);guard(ticket);if(!row?.spendAuthority)return null;
  check(sameAuroraSwapValue(row.spendAuthority.review,review),'Keep and check the original private spend authority.');return structuredClone(row.spendAuthority.authorization);
 }
 function capture(){
  const ticket=generation;guard(ticket);const key=structuredClone(connected);return Object.freeze({identity:key,assertCurrent:()=>guard(ticket),requireRecovery:(...args)=>{guard(ticket);return requireRecovery(...args);},prepareSpend:(...args)=>{guard(ticket);return prepareSpend(...args);},originalSpendAuthority:(...args)=>{guard(ticket);return originalSpendAuthority(...args);},retainSpendAuthority:(...args)=>{guard(ticket);return retainSpendAuthority(...args);},async prove(commitment,input,options){
   guard(ticket);const saved=await decode(await readState(),identity),row=saved.records.find(row=>row.note.commitment===commitment);check(row?.outcome?.funded,'Verify original pool funding before proving.');
   const review=options?.review;if(review){checkAuroraSwapReview(review,review);check(review.source.commitment===commitment&&review.source.accountId===key.accountId,'Prove the original reviewed note.');}
   const proof=await prover.prove({...input,note:row.note},options);
   if(review){const authorization=buildAuroraSwapAuthorization(review,proof);await updateState(async state=>{
    check(state.identity?.profile.id===identity&&state.nearIntentSource?.publicKey===key.publicKey,'The original proof owner changed. Keep its unresolved request.');
    const original=await decode(state,identity),retained=original.records.find(record=>record.note.commitment===commitment);check(retained&&equal(retained.note,row.note),'The original proved note changed.');
    const authority={review,authorization};check(!retained.spendAuthority||sameAuroraSwapValue(retained.spendAuthority,authority),'The original private proof authority conflicts.');retained.spendAuthority=structuredClone(authority);await encode(state,identity,key.publicKey,original.records);
   });}
   guard(ticket);return proof;
  }});
 }
 async function cancelReview(id){return update(rows=>{const row=rows.find(row=>row.review?.id===id);check(row&&!row.signed,'A signed grant needs its original status check.');row.state='note';});}
 function disconnect(){generation++;connected=null;prover.cancel();}
 addEventListener('lenz-account-identity',disconnect);addEventListener('pagehide',disconnect);
 return Object.freeze({connect,disconnect,identity:()=>connected?structuredClone(connected):null,createNote,saveReview,cancelReview,signFunding,beginDispatch,saveOutcome,snapshot,holdings,capture,dispose(){disconnect();removeEventListener('lenz-account-identity',disconnect);removeEventListener('pagehide',disconnect);prover.dispose();}});
}
