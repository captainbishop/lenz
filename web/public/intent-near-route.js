import {readState,updateState} from './chat-store.js';
import {checkAuroraFundingPayload} from './intent-aurora-funding-plan.js';
import {requirePaymentAccess,RECOVERED_CHAT} from './chat-access.js';
import {base58,base64} from './intents-vendor/codecs.js';
import {NEAR_INTENT_DEPLOYMENT as deployment,implicitNearOwner,checkNearReview,checkNearAuthorization,nearAuthorizationId,buildNearFundingReview,sameNearValue} from './intent-near-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const utf8=value=>new TextEncoder().encode(value);
function concat(...parts){const output=new Uint8Array(parts.reduce((length,part)=>length+part.length,0));let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output;}
function borshString(value){check(typeof value==='string'&&utf8(value).length<=8192,'Invalid NEP-413 text.');const content=utf8(value),size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,content.length,true);return concat(size,content);}
export async function nearNep413Hash(payload){
 check(payload&&Object.keys(payload).sort().join(',')==='message,nonce,recipient','The NEP-413 payload changed.');
 const nonce=base64.decode(payload.nonce);check(nonce.length===32&&base64.encode(nonce)===payload.nonce,'Invalid NEP-413 nonce.');
 const tag=new Uint8Array(4);new DataView(tag.buffer).setUint32(0,2147484061,true);
 return new Uint8Array(await crypto.subtle.digest('SHA-256',concat(tag,borshString(payload.message),nonce,borshString(payload.recipient),new Uint8Array([0]))));
}
async function verifySigned(signed){
 const publicKey=await crypto.subtle.importKey('raw',base58.decode(signed.public_key.slice(8)),{name:'Ed25519'},false,['verify']);
 check(await crypto.subtle.verify('Ed25519',publicKey,base58.decode(signed.signature.slice(8)),await nearNep413Hash(signed.payload)),'The browser signature could not be verified.');
}
export const verifyNearIntentSigned=verifySigned;
const nearKeyAad=(identity,publicKey)=>utf8(JSON.stringify(['lenz/near-intent-key/v1',identity,publicKey]));
async function privatePublicKey(raw){
 const key=await crypto.subtle.importKey('pkcs8',raw,{name:'Ed25519'},true,['sign']),jwk=await crypto.subtle.exportKey('jwk',key);
 return 'ed25519:'+base58.encode(Uint8Array.from(atob(jwk.x.replaceAll('-','+').replaceAll('_','/')),byte=>byte.charCodeAt(0)));
}
export function requireNearIntentAccess(state){
 if(state.identity?.access===undefined){requirePaymentAccess(state.identity);return;}
 const source=state.nearIntentSource;
 check(state.identity?.access===RECOVERED_CHAT&&source?.owner===state.identity.profile.id&&source.recoveryVerified?.chainId===deployment.chainId&&source.recoveryVerified.publicKey===source.publicKey,'Recover the original NEAR source before approving this route.');implicitNearOwner(source.publicKey);
}
export function getNearIntentRecoveryReadiness(state){
 const source=state.nearIntentSource,sync=state.accountSync,coverage=sync?.nearSourceBackup;
 const ready=!!source&&source.owner===state.identity?.profile.id&&!!sync&&coverage?.publicKey===source.publicKey&&Number.isSafeInteger(coverage.version)&&coverage.version>0&&sync.savedVersion>=coverage.version&&sync.status!=='conflict';
 return {ready,reason:ready?'':'Set up account recovery and wait for the encrypted source backup before adding funds or signing.'};
}
export async function validateNearIntentRecovery(value,identity){
 value=structuredClone(value);
 check(value&&Object.keys(value).sort().join(',')==='chainId,fundingHistory,owner,pkcs8,publicKey,type'&&value.type==='lenz/near-source-recovery/v1'&&value.chainId===deployment.chainId&&value.owner===identity?.profile.id,'The NEAR recovery belongs to another account or route.');implicitNearOwner(value.publicKey);
 check(typeof value.pkcs8==='string'&&value.pkcs8.length<=512&&Array.isArray(value.fundingHistory)&&value.fundingHistory.length<=50&&utf8(JSON.stringify(value)).length<=2000000,'The NEAR recovery is invalid or too large.');
 const raw=base64.decode(value.pkcs8);try{check(raw.length>=32&&raw.length<=256&&base64.encode(raw)===value.pkcs8&&await privatePublicKey(raw)===value.publicKey,'The restored NEAR key does not own the original account.');}finally{raw.fill(0);}
 const ids=new Set();for(const row of value.fundingHistory){const review=row?.review;check(row&&Object.keys(row).sort().join(',')==='outcome,review,signed'&&review?.owner===implicitNearOwner(value.publicKey)&&!ids.has(review.id),'Funding recovery conflicts.');ids.add(review.id);const exact=buildNearFundingReview(review.owner,{nonce:review.payload.nonce,deadline:review.deadline,solverId:review.solverId,destination:review.destination},{allowExpired:true});check(sameNearValue(review,exact)&&row.signed?.public_key===value.publicKey&&sameNearValue(row.signed.payload,review.payload),'The saved funding authorization changed.');await verifySigned(row.signed);check(row.outcome===null||row.outcome&&typeof row.outcome==='object'&&!Array.isArray(row.outcome),'The funding outcome is invalid.');}
 return structuredClone(value);
}
export async function snapshotNearIntentRecovery(state){
 const source=state.nearIntentSource;if(!source){check(!state.nearIntentFundingBox,'Funding history has no source key.');return null;}
 check(source.version===1&&source.owner===state.identity?.profile.id&&source.wrappingKey,'The original NEAR source is incomplete.');
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:base64.decode(source.iv),additionalData:nearKeyAad(source.owner,source.publicKey)},source.wrappingKey,base64.decode(source.ciphertext)));
 try{return validateNearIntentRecovery({type:'lenz/near-source-recovery/v1',chainId:deployment.chainId,owner:source.owner,publicKey:source.publicKey,pkcs8:base64.encode(raw),fundingHistory:await readFundingHistory(state,source.owner)},state.identity);}finally{raw.fill(0);}
}
export async function restoreNearIntentRecovery(state,input){
 const snapshot=await validateNearIntentRecovery(input,state.identity);
 if(state.nearIntentSource){check(state.nearIntentSource.publicKey===snapshot.publicKey,'A different NEAR source already exists.');const local=await snapshotNearIntentRecovery(state);check(local.pkcs8===snapshot.pkcs8,'The existing NEAR key conflicts with recovery.');const rows=new Map(local.fundingHistory.map(row=>[row.review.id,row]));for(const incoming of snapshot.fundingHistory){const old=rows.get(incoming.review.id);check(!old||sameNearValue(old.review,incoming.review)&&sameNearValue(old.signed,incoming.signed),'Funding authorization histories conflict.');rows.set(incoming.review.id,old??incoming);}snapshot.fundingHistory=[...rows.values()];await validateNearIntentRecovery(snapshot,state.identity);}
 const raw=base64.decode(snapshot.pkcs8),wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:nearKeyAad(snapshot.owner,snapshot.publicKey)},wrappingKey,raw),fundingIv=crypto.getRandomValues(new Uint8Array(12)),funding=await crypto.subtle.encrypt({name:'AES-GCM',iv:fundingIv,additionalData:utf8(JSON.stringify(['lenz/near-test-grants/v1',snapshot.owner]))},wrappingKey,utf8(JSON.stringify(snapshot.fundingHistory)));
  state.nearIntentSource={version:1,owner:snapshot.owner,publicKey:snapshot.publicKey,wrappingKey,iv:base64.encode(iv),ciphertext:base64.encode(new Uint8Array(ciphertext)),recoveryVerified:{chainId:deployment.chainId,publicKey:snapshot.publicKey}};state.nearIntentFundingBox={iv:base64.encode(fundingIv),ciphertext:base64.encode(new Uint8Array(funding))};
 }finally{raw.fill(0);}return snapshot;
}
async function readFundingHistory(state,identity){
 check(state.identity?.profile.id===identity&&state.nearIntentSource?.owner===identity,'Open the original Lenz account.');
 if(!state.nearIntentFundingBox)return [];
 const box=state.nearIntentFundingBox,raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64.decode(box.iv),additionalData:utf8(JSON.stringify(['lenz/near-test-grants/v1',identity]))},state.nearIntentSource.wrappingKey,base64.decode(box.ciphertext));
 const records=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));check(Array.isArray(records)&&records.length<=50,'The retained funding history is invalid.');return records;
}
async function updateFundingHistory(identity,operation){return updateState(async state=>{
 const records=await readFundingHistory(state,identity);await operation(records);check(records.length<=50,'The retained funding limit was reached.');
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8(JSON.stringify(['lenz/near-test-grants/v1',identity]))},state.nearIntentSource.wrappingKey,utf8(JSON.stringify(records)));
 state.nearIntentFundingBox={iv:base64.encode(iv),ciphertext:base64.encode(new Uint8Array(ciphertext))};return structuredClone(records);
});}
export function createNearIntentSource(lenzIdentity,{backupState=async()=>{const {backupNow}=await import('./account-sync.js');await backupNow();}}={}){
 check(typeof lenzIdentity==='string'&&lenzIdentity.length>0,'Create a Lenz account before opening NEAR testnet funds.');
 let connected=null,revision=0,signingKey=null;
 const aad=publicKey=>utf8(JSON.stringify(['lenz/near-intent-key/v1',lenzIdentity,publicKey]));
 function disconnect(){revision++;connected=null;signingKey=null;globalThis.dispatchEvent?.(new Event('lenz-near-intent-session'));}
 async function connect(){
  const started=++revision;
  const result=await updateState(async state=>{
   check(state.identity?.profile.id===lenzIdentity,'Open the original Lenz account.');requireNearIntentAccess(state);
   let record=state.nearIntentSource;
   if(!record){
    const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']),publicRaw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),publicKey='ed25519:'+base58.encode(publicRaw),privateRaw=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
    try{const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(publicKey)},wrappingKey,privateRaw);record={version:1,owner:lenzIdentity,publicKey,wrappingKey,iv:base64.encode(iv),ciphertext:base64.encode(new Uint8Array(ciphertext))};state.nearIntentSource=record;}finally{privateRaw.fill(0);}
   }
   check(record.version===1&&record.owner===lenzIdentity&&record.wrappingKey&&typeof record.ciphertext==='string','The encrypted NEAR source is incomplete.');
   const privateRaw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:base64.decode(record.iv),additionalData:aad(record.publicKey)},record.wrappingKey,base64.decode(record.ciphertext)));
   try{check(await privatePublicKey(privateRaw)===record.publicKey,'The NEAR key no longer owns the selected account.');return {publicKey:record.publicKey,key:await crypto.subtle.importKey('pkcs8',privateRaw,{name:'Ed25519'},false,['sign'])};}finally{privateRaw.fill(0);}
  });
  check(started===revision,'The source connection changed.');signingKey=result.key;connected={chainId:deployment.chainId,accountId:implicitNearOwner(result.publicKey),publicKey:result.publicKey,lenzIdentity};
  globalThis.dispatchEvent?.(new Event('lenz-near-intent-session'));return structuredClone(connected);
 }
 function capture(){
  check(connected&&signingKey,'Connect your encrypted NEAR testnet source.');const identity=structuredClone(connected),started=revision,key=signingKey;
  const assertCurrent=()=>check(started===revision&&sameNearValue(connected,identity),'The Lenz identity or NEAR source changed.');
  async function requireRecovery({latest=false,signal}={}){
   assertCurrent();signal?.throwIfAborted();let state=await readState();check(state.identity?.profile.id===lenzIdentity&&state.nearIntentSource?.publicKey===identity.publicKey,'Open the original NEAR source.');requireNearIntentAccess(state);const readiness=getNearIntentRecoveryReadiness(state);check(readiness.ready,readiness.reason);
   if(latest){
    const version=state.accountSync.version;check(Number.isSafeInteger(version)&&version>0,'The account backup version is invalid.');await backupState();assertCurrent();signal?.throwIfAborted();state=await readState();
    check(state.identity?.profile.id===lenzIdentity&&state.nearIntentSource?.publicKey===identity.publicKey,'Open the original NEAR source.');requireNearIntentAccess(state);
    check(getNearIntentRecoveryReadiness(state).ready&&state.accountSync.savedVersion>=version&&state.accountSync.nearSourceBackup.version>=version,'Your current request is not backed up yet. Keep it saved and try the same request again.');
   }
   assertCurrent();
  }
  return Object.freeze({identity,assertCurrent,requireRecovery,async signNep413(payload,{signal}={}){
   assertCurrent();signal?.throwIfAborted();const current=await readState();check(current.identity?.profile.id===lenzIdentity,'Open the original Lenz account.');requireNearIntentAccess(current);assertCurrent();
   if(current.identity.access===RECOVERED_CHAT&&payload.recipient==='lenz-aurora-testnet-faucet')checkAuroraFundingPayload(payload,identity.accountId);
   else if(current.identity.access===RECOVERED_CHAT){const message=JSON.parse(payload.message);check(payload.recipient===deployment.verifier,'Recovered source signing is limited to the verified NEAR route.');
    if(message.domain==='lenz/near-test-funds/v1'){const review=buildNearFundingReview(identity.accountId,{nonce:payload.nonce,deadline:message.deadline,solverId:message.solverId,destination:message.destination});check(sameNearValue(review.payload,payload),'Recovered funding must use the exact supported grant.');}
    else {check(message.signer_id===identity.accountId&&Array.isArray(message.intents)&&message.intents.length===1&&Date.parse(message.deadline)>Date.now()&&Date.parse(message.deadline)<=Date.now()+600000,'Review an active recovered NEAR payment.');const action=message.intents[0];if(action.intent==='token_diff'){const diff=action.diff,input=diff?.['nep141:'+deployment.source],output=diff?.['nep141:'+deployment.target];check(Object.keys(diff??{}).length===2&&typeof input==='string'&&/^-[1-9][0-9]{0,6}$/.test(input)&&BigInt(input)>=-1000000n&&output===(BigInt(input)*-2n).toString(),'Recovered signing is limited to the exact LTS to LTT route.');}else check(action.intent==='ft_withdraw'&&action.token===deployment.target&&typeof action.amount==='string'&&/^[1-9][0-9]{0,6}$/.test(action.amount)&&BigInt(action.amount)<=2000000n&&typeof action.receiver_id==='string'&&(/^[0-9a-f]{64}$/.test(action.receiver_id)||/^[a-z0-9._-]+\.testnet$/.test(action.receiver_id)),'Recovered signing is limited to the exact LTT withdrawal.');}
   }
   const frozen=structuredClone(payload),digest=await nearNep413Hash(frozen);assertCurrent();signal?.throwIfAborted();
   const signature=new Uint8Array(await crypto.subtle.sign('Ed25519',key,digest));
   return {standard:'nep413',payload:frozen,public_key:identity.publicKey,signature:'ed25519:'+base58.encode(signature)};
  }});
 }
 const changed=()=>disconnect();globalThis.addEventListener?.('lenz-account-identity',changed);globalThis.addEventListener?.('pagehide',changed);
 return Object.freeze({connect,disconnect,capture,identity:()=>connected?structuredClone(connected):null,dispose(){disconnect();globalThis.removeEventListener?.('lenz-account-identity',changed);globalThis.removeEventListener?.('pagehide',changed);}});
}
export function createNearIntentService(source,{fetchImpl=fetch}={}){
 const unsignedFailures=new WeakSet();
 async function request(action,body={},options={}){
  check(globalThis.navigator?.onLine!==false,'Reconnect to NEAR testnet. Your original signed request stays saved.');
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  const response=await fetchImpl('/api/intent-near/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  const result=await response.json();check(response.ok,result.error??'The NEAR testnet route is unavailable.');return result;
 }
 async function capabilities(chosen,options){
  if(chosen.privacy!=='public'||chosen.action!=='swap'||chosen.source.chainId!==deployment.chainId||chosen.destination.chainId!==deployment.chainId)return {available:false,execute:false,privacy:'public',reason:'Choose a public LTS to LTT swap on NEAR testnet.'};
  const status=await request('status',{owner:chosen.source.accountId},options),enough=BigInt(status.sourceBalance)>=BigInt(chosen.source.amount)&&BigInt(status.solverResultBalance)>=BigInt(chosen.source.amount)*2n;
  return {available:enough&&!status.pending,execute:enough&&!status.pending,privacy:'public',reason:status.pending?'Check the original pending transaction.':!enough?'Add test funds or wait for funded solver liquidity.':''};
 }
 function validateReview(review,chosen){return checkNearReview(review,chosen);}
 async function authorize(review,lease,options={}){
  let signingStarted=false;
  try{
  const exact=checkNearReview(review,review);lease.assertCurrent();check(lease.identity.accountId===review.source.accountId&&lease.identity.chainId===deployment.chainId,'Choose the original source account.');
  await lease.requireRecovery({latest:true,signal:options.signal});const configuration=await request('config',{},options);lease.assertCurrent();check(configuration.deploymentVerified===true&&configuration.chainId===deployment.chainId&&configuration.verifier===deployment.verifier,'The recovered NEAR source needs the verified active route.');
  const signed=[];for(const payload of exact.authorization.payloads){signingStarted=true;const item=await lease.signNep413(payload,options);await verifySigned(item);signed.push(item);}
  return checkNearAuthorization({intentId:review.id,artifactId:nearAuthorizationId(signed),signed},review);
  }catch(reason){if(!signingStarted){const error=new Error(reason instanceof Error?reason.message:'Authorization did not start.');unsignedFailures.add(error);throw error;}throw reason;}
 }
 function validateOutcome(outcome,attempt){
  if(outcome?.status==='expired')return checkNearExpiredOutcome(outcome,attempt);
  check(outcome?.intentId===attempt.id&&outcome.artifactId===attempt.authorization?.artifactId&&['unknown','pending','executed'].includes(outcome.status),'The NEAR result belongs to another request.');
  if(outcome.status==='executed'){const e=outcome.evidence,r=attempt.review;check(outcome.verified===true&&e?.network==='testnet'&&e.verifier===deployment.verifier&&e.sourceRevision===deployment.sourceRevision&&e.inputAsset===r.source.asset&&e.inputAmount===r.source.amount&&e.outputAsset===r.destination.asset&&e.outputAmount===r.quote.output&&BigInt(e.outputAmount)>=BigInt(r.destination.minAmount)&&e.recipient===r.destination.accountId&&typeof e.transaction==='string'&&Array.isArray(e.receiptIds)&&e.receiptIds.length>0,'The NEAR evidence changed the reviewed result.');}
  return structuredClone(outcome);
 }
 async function prepareTestFunds(destination){const lease=source.capture();await lease.requireRecovery();const review=await request('prepare-funds',{owner:lease.identity.accountId,destination:destination??lease.identity.accountId});lease.assertCurrent();check(sameNearValue(review,buildNearFundingReview(lease.identity.accountId,{nonce:review.payload.nonce,deadline:review.deadline,solverId:review.solverId,destination:review.destination})),'The test funding review changed.');return review;}
 async function addTestFunds(review,{signal}={}){
  const lease=source.capture();check(sameNearValue(review,buildNearFundingReview(lease.identity.accountId,{nonce:review.payload.nonce,deadline:review.deadline,solverId:review.solverId,destination:review.destination})),'Review the original test funding grant.');
  await lease.requireRecovery();const configuration=await request('config',{}, {signal});lease.assertCurrent();check(configuration.deploymentVerified===true&&configuration.chainId===deployment.chainId&&configuration.verifier===deployment.verifier,'Test funding requires the verified NEAR route.');
  const signed=await lease.signNep413(review.payload,{signal});await verifySigned(signed);
  // Persist the signed capped grant before asking the service to mint or deposit.
  await updateFundingHistory(lease.identity.lenzIdentity,records=>{const existing=records.find(row=>row.review.id===review.id);check(!existing||sameNearValue(existing.signed,signed),'The retained funding signature changed.');if(!existing)records.push({review:structuredClone(review),signed,outcome:null});});
  await lease.requireRecovery({latest:true,signal});
  const result=await request('add-funds',{review,signed},{signal});await updateFundingHistory(lease.identity.lenzIdentity,records=>{const row=records.find(item=>item.review.id===review.id);row.outcome=structuredClone(result);});return result;
 }
 async function fundingHistory(){const identity=source.capture().identity.lenzIdentity;return readFundingHistory(await readState(),identity);}
 async function reconcileTestFunds(id){const identity=source.capture().identity.lenzIdentity,result=await request('reconcile-funds',{id});await updateFundingHistory(identity,records=>{const row=records.find(item=>item.review.id===id);check(row,'The original funding request is missing.');row.outcome=structuredClone(result);});return result;}
 async function continueTestFunds(id){const lease=source.capture(),row=(await fundingHistory()).find(item=>item.review.id===id);check(row?.signed&&row.review.owner===lease.identity.accountId,'Open the original signed funding request.');await lease.requireRecovery({latest:true});lease.assertCurrent();const result=await request('add-funds',{review:row.review,signed:row.signed});await updateFundingHistory(lease.identity.lenzIdentity,records=>{records.find(item=>item.review.id===id).outcome=structuredClone(result);});return result;}
 async function submit(attempt,options={}){const lease=source.capture();check(attempt.review?.source.accountId===lease.identity.accountId,'Submit from the original source account.');await lease.requireRecovery({latest:true,signal:options.signal});lease.assertCurrent();return request('submit',attempt,options);}
 return Object.freeze({supportsOriginalResume:true,requiresExclusiveSource:true,supportsUnsignedExpiry:true,authorizationNotCreated:reason=>unsignedFailures.has(reason),configuration:()=>request('config'),status:()=>request('status',{owner:source.capture().identity.accountId}),capabilities,prepare:(chosen,lease,options)=>{lease.assertCurrent();return request('prepare',chosen,options);},validateReview,authorize,validateAuthorization:checkNearAuthorization,authorityId:review=>review.authorityId,submit,reconcile:(attempt,options)=>request('reconcile',attempt,options),validateOutcome,prepareTestFunds,addTestFunds,fundingHistory,reconcileTestFunds,continueTestFunds});
}
