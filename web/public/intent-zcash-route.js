import {readState} from './chat-store.js';
import {requirePaymentAccess} from './chat-access.js';
import {ZCASH_INTENT_ROUTE,ZCASH_INTENT_CHAIN,checkZcashSelection,checkZcashReview,checkZcashAuthorization,checkZcashOutcome,zcashSame} from './intent-zcash-plan.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
function transport(fetchImpl){return async(action,body={},options={})=>{
 check(globalThis.navigator?.onLine!==false,'Reconnect to check the original native payment.');
 const timeout=AbortSignal.timeout(action==='authorize'||action==='reconcile'||action==='prepare'?1800000:120000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 const response=await fetchImpl('/api/intent-zcash/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}),result=await response.json();check(response.ok,result.error??'The local native signer is unavailable.');return result;
};}
export function createZcashIntentSource(lenzIdentity,{fetchImpl=fetch}={}){
 check(typeof lenzIdentity==='string'&&lenzIdentity.length>0,'Create a Lenz account before opening native testnet funds.');
 const request=transport(fetchImpl);let connected=null,revision=0;
 async function access(){const state=await readState();check(state.identity?.profile.id===lenzIdentity,'Open the original Lenz account.');requirePaymentAccess(state.identity);}
 function disconnect(){revision++;connected=null;globalThis.dispatchEvent?.(new Event('lenz-zcash-intent-session'));}
 async function connect(wallet='a'){
  check(wallet==='a'||wallet==='b','Choose a configured local source.');
  const started=++revision;await access();const configuration=await request('config');check(configuration.available===true&&configuration.route===ZCASH_INTENT_ROUTE&&configuration.network==='testnet'&&configuration.custody==='local-native'&&configuration.browserOnly===false,'The explicitly configured local native signer is unavailable.');
  const selected=configuration.sources?.find(source=>source.wallet===wallet);check(selected&&new RegExp('^native-zcash:'+wallet+':[0-9a-f]{64}$').test(selected.accountId),'Choose a configured local source.');await access();check(started===revision,'The source connection changed.');
  connected={chainId:ZCASH_INTENT_CHAIN,accountId:selected.accountId,wallet:wallet,recipient:selected.recipient,lenzIdentity,custody:'local-native'};globalThis.dispatchEvent?.(new Event('lenz-zcash-intent-session'));return structuredClone(connected);
 }
 function capture(){check(connected,'Open the configured native wallet.');const identity=structuredClone(connected),started=revision;const assertCurrent=()=>check(started===revision&&zcashSame(identity,connected),'The Lenz identity or native source changed.');return Object.freeze({identity,assertCurrent,async requireAccess(){assertCurrent();await access();assertCurrent();}});}
 const changed=()=>disconnect();globalThis.addEventListener?.('lenz-account-identity',changed);globalThis.addEventListener?.('pagehide',changed);
 return Object.freeze({connect,capture,disconnect,identity:()=>connected?structuredClone(connected):null,dispose(){disconnect();globalThis.removeEventListener?.('lenz-account-identity',changed);globalThis.removeEventListener?.('pagehide',changed);}});
}
export function createZcashIntentService(source,{fetchImpl=fetch}={}){
 const request=transport(fetchImpl);
 async function status(options){
  const lease=source.capture();await lease.requireAccess();const received=await request('status',{owner:lease.identity.accountId},options);lease.assertCurrent();
  check(received.wallet===lease.identity.wallet&&received.accountId===lease.identity.accountId&&received.recipient===lease.identity.recipient&&typeof received.balance==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(received.balance)&&BigInt(received.balance)<=2100000000000000n&&Array.isArray(received.history)&&received.history.length<=64&&typeof received.pending==='boolean','Funds do not match the original native source.');return received;
 }
 async function capabilities(value,options){let chosen;try{chosen=checkZcashSelection(value);}catch(error){return {available:false,execute:false,privacy:'private',reason:error.message};}
  const lease=source.capture();lease.assertCurrent();check(lease.identity.accountId===chosen.source.accountId,'Open the original configured source.');const received=await status(options);lease.assertCurrent();
  const blocking=received.history.some(row=>!['reviewed','confirmed','failed','expired'].includes(row.state)&&!(row.id===chosen.requestId&&row.state==='signed'));
  const enough=BigInt(received.balance)>BigInt(chosen.source.amount)+10000n;return {available:!blocking&&enough,execute:!blocking&&enough,privacy:'private',reason:blocking?'Check the original unresolved native payment.':!enough?'The native wallet needs spendable test ZEC for this payment, fee and change.':''};
 }
 async function authorize(value,lease,options){const review=checkZcashReview(value,value);check(lease.identity.accountId===review.source.accountId&&lease.identity.custody==='local-native','Choose the original local native source.');await lease.requireAccess();return checkZcashAuthorization(await request('authorize',{review},options),review);}
 return Object.freeze({supportsOriginalResume:true,configuration:()=>request('config'),status,capabilities,
  prepare:async(chosen,lease,options)=>{await lease.requireAccess();return request('prepare',checkZcashSelection(chosen),options);},validateReview:checkZcashReview,authorize,validateAuthorization:checkZcashAuthorization,authorityId:review=>review.authorityId,
  recoverAuthorization:async(attempt,options)=>{const lease=source.capture();check(lease.identity.accountId===attempt.review.source.accountId,'Open the original local native source.');await lease.requireAccess();return checkZcashAuthorization(await request('recover-authorization',attempt,options),attempt.review);},
  submit:(attempt,options)=>request('submit',attempt,options),reconcile:(attempt,options)=>request('reconcile',attempt,options),validateOutcome:checkZcashOutcome,
 });
}
