import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,validateProfile} from './peer-crypto.js';
import {checkConfidentialSpend} from './intents-spend.js';
import {requirePaymentAccess,isRecoveredContact} from './chat-access.js';
import {receiveAssets} from './receive-assets.js';

const DOMAIN='lenz/private-review/v1';
const aad=s=>bytes([DOMAIN,s.identity.profile.id]);
async function read(s){
 if(!s.privateReviewBox&&!s.privateReviewKey)return null;
 assert(s.identity&&s.privateReviewKey&&keysAre(s.privateReviewBox,['iv','ciphertext'])&&s.privateReviewBox.ciphertext.length<=140000,'Private review storage is incomplete.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.privateReviewBox.iv),additionalData:aad(s)},s.privateReviewKey,unhex(s.privateReviewBox.ciphertext));
 const draft=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const fields=['offer','executor','checkedAt','identity'];if(Object.hasOwn(draft,'assets'))fields.push('assets');
 assert(keysAre(draft,fields)&&draft.identity===s.identity.profile.id&&Number.isSafeInteger(draft.checkedAt),'Saved private review changed.');
 if(draft.assets){assert(draft.assets.length<=64,'Saved asset list is too large.');draft.assets=receiveAssets(draft.assets);}
 checkConfidentialSpend(draft.offer,{now:draft.checkedAt});await validateProfile(draft.executor);
 return draft;
}
export async function readPrivateReview(){return read(await readState());}
export async function savePrivateReview(offer,executor,identity,{signal,token}={}){
 const value={offer:structuredClone(offer),executor:structuredClone(executor),checkedAt:Date.now(),identity};
 const selected=receiveAssets([token])[0],review=checkConfidentialSpend(value.offer);await validateProfile(value.executor);
 assert(selected.assetId===review.originAsset&&selected.assetId===review.destinationAsset,'Asset details belong to another private payment.');
 await updateState(async s=>{
  assert(s.identity?.profile.id===identity,'Lenz account changed. Review again.');requirePaymentAccess(s.identity);
  assert(executor.id!==identity&&!isRecoveredContact(s,executor.id)&&s.contacts.some(p=>p.id===executor.id&&p.signingPublic===executor.signingPublic&&p.boxPublic===executor.boxPublic),'Choose a verified executor contact.');
  const previous=await read(s),assets=previous?.assets??[],existing=assets.find(t=>t.assetId===selected.assetId);
  assert(!existing||existing.decimals===selected.decimals&&existing.blockchain===selected.blockchain,'Asset units or network changed. Review its source first.');
  value.assets=[...assets.filter(t=>t.assetId!==selected.assetId),selected];assert(value.assets.length<=64,'Saved asset list is full.');
  const raw=bytes(value);assert(raw.length<=70000,'Private review is too large.');
  s.privateReviewKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.privateReviewKey,raw);
  s.privateReviewBox={iv:hex(iv),ciphertext:hex(ciphertext)};
 },{signal});
 return value;
}
