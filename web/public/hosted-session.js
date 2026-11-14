import {readState} from './chat-store.js';
import {bytes,hex} from './peer-crypto.js';
import {requirePaymentAccess,isRecoveredChat} from './chat-access.js';
const domain='lenz/hosted-operator-session/v1',privileged=['/api/intent-near/','/api/intent-aurora/','/api/intent-aurora-funds/','/api/intent-aurora-swap/','/api/intents/lending/','/api/intent-zcash/','/api/zcash/','/api/rhea/','/api/defi/','/api/private-spend/','/api/private-executor/','/api/hyperliquid-testnet/','/api/ai/','/api/hosted/jobs/'];
const protectedPath=path=>privileged.some(prefix=>path.startsWith(prefix))||['/api/testnet/fund','/api/testnet/settle','/api/testnet/check'].includes(path);

async function requireSourceAccess(state,path){
 if(state.identity?.access===undefined)return;
 if(!isRecoveredChat(state.identity))requirePaymentAccess(state.identity);
 if(path.startsWith('/api/ai/'))return;
 if(path.startsWith('/api/intents/lending/')){(await import('./intent-lending-account.js')).requireLendingAccountAccess(state);return;}
 if(path.startsWith('/api/intent-near/')||path.startsWith('/api/intent-aurora')){
  (await import('./intent-near-route.js')).requireNearIntentAccess(state);
  if(path.startsWith('/api/intent-aurora-swap/'))(await import('./intent-aurora-account.js')).requireAuroraAccountAccess(state);
  return;
 }
 requirePaymentAccess(state.identity);
}

export function createHostedSession({fetcher=globalThis.fetch.bind(globalThis),read=readState,origin=globalThis.location?.origin,hosted=globalThis.location?.protocol==='https:',now=Date.now}={}){
 let active=null,current=null;
 async function post(path,body,signal){const response=await fetcher('/api/hosted/session'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal});return {ok:response.ok,value:await response.json()};}
 async function ensure(signal){
  if(!hosted||globalThis.navigator?.onLine===false)return null;
  const state=await read(),identity=state.identity;signal?.throwIfAborted();
  if(!identity){await fetcher('/api/hosted/session',{method:'DELETE',signal});current=null;return null;}
  if(identity.access!==undefined&&!isRecoveredChat(identity))requirePaymentAccess(identity);
  if(current?.identity===identity.profile.id&&current.expiresAt>now()+5000)return current;
  if(active){await active;return ensure(signal);}
  const id=identity.profile.id;
  active=(async()=>{
   const status=await fetcher('/api/hosted/session',{method:'GET',cache:'no-store',signal}),existing=await status.json();
   if(existing.authorized&&existing.identity!==id)await fetcher('/api/hosted/session',{method:'DELETE',signal});
   if(existing.authorized&&existing.identity===id&&existing.expiresAt>now()+5000){current=existing;return existing;}
   const challenge=await post('/challenge',{id},signal);if(!challenge.ok){current=null;return null;}
   const {nonce,until}=challenge.value;if(typeof nonce!=='string'||!/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(nonce)||!Number.isSafeInteger(until)||until<=now()||until>now()+60000)throw Error('The Lenz session challenge changed.');
   // This signature proves sign-in only. Existing per-source payment guards remain separate.
   const signature=hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.signingPrivate,bytes([domain,origin,id,nonce,until])));
   if((await read()).identity?.profile.id!==id)throw Error('The Lenz account changed during authorization.');
   const {type,name,signingPublic,boxPublic}=identity.profile,reply=await post('',{profile:{type,id,name,signingPublic,boxPublic},nonce,until,signature},signal);
   if(!reply.ok||reply.value.authorized!==true||reply.value.identity!==id||!Number.isSafeInteger(reply.value.expiresAt)||reply.value.expiresAt<=now()||reply.value.expiresAt>now()+7_200_000){current=null;return null;}current=reply.value;return current;
  })();
  try{return await active;}finally{active=null;}
 }
 return {ensure,fetch:async(input,options={})=>{
  const path=typeof input==='string'?input:'';
  if(!hosted||!protectedPath(path))return fetcher(input,options);
  await requireSourceAccess(await read(),path);
  const session=await ensure(options.signal),headers=new Headers(options.headers);
  if(session){const state=await read();if(state.identity?.profile.id!==session.identity)throw Error('The Lenz account changed before this request.');await requireSourceAccess(state,path);headers.set('x-lenz-hosted-identity',session.identity);}
  return fetcher(input,{...options,headers});
 }};
}
let installed;
export function installHostedSession(){
 if(installed||globalThis.location?.protocol!=='https:')return installed;
 installed=createHostedSession();globalThis.fetch=installed.fetch;return installed;
}
