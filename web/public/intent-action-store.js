import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,digest} from './peer-crypto.js';
import {requirePaymentAccess} from './chat-access.js';
import {checkIntentJournal,intentOwner} from './intent-workspace.js';
import {NEAR_INTENT_DEPLOYMENT as deployment,implicitNearOwner,checkNearReview,checkNearAuthorization} from './intent-near-plan.js';
import {requireNearIntentAccess,snapshotNearIntentRecovery,verifyNearIntentSigned} from './intent-near-route.js';
import {requireAuroraAccountAccess,snapshotAuroraAccountRecovery} from './intent-aurora-account.js';
import {AURORA_INTENT_DEPLOYMENT as auroraDeployment} from './intent-aurora-config.js';
import {AURORA_SWAP_CHAIN,checkAuroraSwapSelection,checkAuroraSwapReview,checkAuroraSwapAuthorization,sameAuroraSwapValue} from './intent-aurora-plan.js';
import {checkLendingSupplyReview,checkLendingSupplyAuthorization,lendingSupplySelection,sameLendingSupplyValue} from './intent-lending-supply.js';
import {requireLendingAccountAccess} from './intent-lending-account.js';
import {ZCASH_INTENT_CHAIN,ZCASH_INTENT_ROUTE,checkZcashSelection,checkZcashReview,checkZcashAuthorization,checkZcashOutcome,zcashPaymentTerms} from './intent-zcash-plan.js';

const DOMAIN='lenz/intent-actions/v1',MAX_BYTES=2000000,MAX_OWNERS=32;
const empty=()=>({draft:null,review:null,attempts:[]});
const aad=identity=>bytes([DOMAIN,identity]);
const nativeRequest=selection=>selection.source.chainId===ZCASH_INTENT_CHAIN||selection.route===ZCASH_INTENT_ROUTE||selection.source.accountId.startsWith('native-zcash:');
function validate(records){
 assert(Array.isArray(records)&&records.length<=MAX_OWNERS&&bytes(records).length<=MAX_BYTES,'Saved action history is too large.');
 const owners=new Set(),authorities=new Set();
 for(const record of records){
  assert(keysAre(record,['owner','journal'])&&typeof record.owner==='string'&&record.owner.length<=600&&!owners.has(record.owner),'Saved action owners conflict.');owners.add(record.owner);
  const journal=checkIntentJournal(record.journal);
  for(const selection of [journal.draft,journal.review,...journal.attempts.map(attempt=>attempt.review)].filter(Boolean))assert(intentOwner(selection.source)===record.owner,'Saved action belongs to another source account.');
  for(const attempt of journal.attempts){
   if(attempt.status==='declined')continue;
   assert(!authorities.has(attempt.authorityId),'Check the existing source authority before trying again.');authorities.add(attempt.authorityId);
  }
 }
 return structuredClone(records);
}
async function decode(state,identity){
 assert(state.identity?.profile.id===identity,'Lenz account changed. Open the original account.');
 if(!state.intentActionKey&&!state.intentActionBox)return [];
 const box=state.intentActionBox;
 assert(state.intentActionKey&&keysAre(box,['iv','ciphertext'])&&typeof box.ciphertext==='string'&&box.ciphertext.length<=MAX_BYTES*2+32,'Saved action storage is incomplete.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(identity)},state.intentActionKey,unhex(box.ciphertext));
 return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
}
export async function snapshotIntentActionRecovery(state){return decode(state,state.identity?.profile.id);}
export async function validateIntentActionRecovery(records,identity,nearSource=null,{auroraNotes=null,auroraAccount=null,lendingAccount=null}={}){
 const checked=validate(records);for(const record of checked){
  for(const selection of [record.journal.draft,record.journal.review,...record.journal.attempts.map(row=>row.review)].filter(Boolean)){
   if(nativeRequest(selection)){
    if(selection.id){checkZcashReview(selection,selection);assert(await digest(zcashPaymentTerms(selection))===selection.native.binding,'The original native payment fingerprint changed.');}else checkZcashSelection(selection);continue;
   }
   if(selection.action==='supply'&&selection.source.chainId==='eip155:11155111'){
    const notes=lendingAccount?.supplyNotes,note=notes?.records.find(row=>row.note.commitment===selection.source.commitment);assert(note&&selection.source.accountId===identity.profile.id&&selection.destination.accountId===lendingAccount.account,'The private Supply request has no matching recovered note or lending account.');
    if(selection.id){checkLendingSupplyReview(selection,{config:notes.deployment,allowExpired:true});assert(selection.owner===lendingAccount.owner&&selection.ownerAddress===lendingAccount.ownerAddress&&selection.spend.nullifierHash===note.note.nullifierHash&&sameLendingSupplyValue(selection.identity.route,lendingAccount.route),'The recovered private Supply request changed its original owner or note.');}
    else assert(sameLendingSupplyValue(selection,lendingSupplySelection(selection.source,{recipient:selection.destination.accountId,minimum:selection.destination.minAmount,deadline:selection.deadline,allowExpired:true,config:notes.deployment})),'The recovered private Supply selection changed.');continue;
   }
   if(selection.source.chainId!==AURORA_SWAP_CHAIN)continue;
   if(selection.id)checkAuroraSwapReview(selection,selection,{allowExpired:true});else checkAuroraSwapSelection(selection,{allowExpired:true});
   const note=auroraNotes?.records?.find(row=>row.note.commitment===selection.source.commitment);
   assert(nearSource&&selection.source.accountId===implicitNearOwner(nearSource.publicKey)&&note&&auroraNotes.publicKey===nearSource.publicKey&&auroraAccount&&selection.destination.accountId===auroraAccount.address,'The private request has no matching recovered note or destination account.');
   if(selection.id)assert(selection.spend.nullifierHash===note.note.nullifierHash,'The private request belongs to another original note.');
  }
  for(const attempt of record.journal.attempts){
   if(nativeRequest(attempt.review)){
    const review=checkZcashReview(attempt.review,attempt.review);assert(attempt.authorityId===review.authorityId,'The original native payment authority changed.');
    if(attempt.authorization)checkZcashAuthorization(attempt.authorization,review);
    if(attempt.outcome){const outcome=checkZcashOutcome(attempt.outcome,attempt);for(const terminal of ['executed','expired'])assert((attempt.status===terminal)===(outcome.status===terminal),'The saved native settlement status changed.');}
    else assert(!['executed','expired'].includes(attempt.status),'The saved native payment has no verified result.');
    assert(attempt.status!=='refunded','Native shielded payments do not use the intent refund route.');continue;
   }
   if(attempt.review.action==='supply'&&attempt.review.source.chainId==='eip155:11155111'){
    const notes=lendingAccount.supplyNotes,note=notes.records.find(row=>row.note.commitment===attempt.review.source.commitment);
    assert(attempt.authorityId==='lending-supply:'+notes.deployment.privacyPool+':'+note.note.nullifierHash,'The original private Supply authority changed.');
    if(attempt.authorization){checkLendingSupplyAuthorization(attempt.authorization,attempt.review,{config:notes.deployment});assert(sameLendingSupplyValue(note.spendAuthority?.review,attempt.review)&&sameLendingSupplyValue(note.spendAuthority?.authorization,attempt.authorization),'The saved Supply proof has no matching original note authority.');}continue;
   }
   if(attempt.review.source.chainId===AURORA_SWAP_CHAIN){
    const note=auroraNotes.records.find(row=>row.note.commitment===attempt.review.source.commitment);
    assert(attempt.authorityId==='aurora:'+auroraDeployment.pool+':'+note.note.nullifierHash,'The original private source authority changed.');
    if(attempt.authorization){checkAuroraSwapAuthorization(attempt.authorization,attempt.review);assert(sameAuroraSwapValue(note.spendAuthority?.review,attempt.review)&&sameAuroraSwapValue(note.spendAuthority?.authorization,attempt.authorization),'The saved private proof has no matching original note authority.');}
    continue;
   }
   if(attempt.review.source.chainId!==deployment.chainId)continue;checkNearReview(attempt.review,attempt.review,{allowExpired:true});assert(nearSource&&attempt.review.source.accountId===implicitNearOwner(nearSource.publicKey),'The saved NEAR request has no matching recovered source.');if(attempt.authorization){checkNearAuthorization(attempt.authorization,attempt.review);for(const signed of attempt.authorization.signed)await verifyNearIntentSigned(signed);}
  }
 }
 assert(typeof identity?.profile.id==='string','Choose the original recovery account.');return checked;
}
export async function restoreIntentActionRecovery(state,records){
 const incoming=validate(records),current=await decode(state,state.identity.profile.id),owners=new Map(current.map(record=>[record.owner,record]));
 for(const record of incoming){const existing=owners.get(record.owner);if(!existing){owners.set(record.owner,record);continue;}const attempts=new Map(existing.journal.attempts.map(row=>[row.id,row]));for(const row of record.journal.attempts){const saved=attempts.get(row.id);assert(!saved||JSON.stringify(saved)===JSON.stringify(row),'Saved financial requests conflict. Check the original journal.');attempts.set(row.id,saved??row);}existing.journal.attempts=[...attempts.values()];existing.journal.draft??=record.journal.draft;existing.journal.review??=record.journal.review;}
 const checked=validate([...owners.values()]),key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),raw=bytes(checked);
 try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(state.identity.profile.id)},key,raw);state.intentActionKey=key;state.intentActionBox={iv:hex(iv),ciphertext:hex(ciphertext)};}finally{raw.fill(0);}return checked;
}
export function createIntentActionStore(identity){
 assert(typeof identity==='string'&&identity.length>0&&identity.length<=256,'Create a Lenz account before saving an action.');
 return Object.freeze({
  async read(owner){return structuredClone((await decode(await readState(),identity)).find(record=>record.owner===owner)?.journal??empty());},
  async update(owner,operation,{signal,guard}={}){
   return updateState(async state=>{
    signal?.throwIfAborted();guard?.();
    const recoveredOwner=state.identity?.access!==undefined&&state.nearIntentSource?implicitNearOwner(state.nearIntentSource.publicKey):null;
    const recoveredAurora=recoveredOwner!==null&&owner===JSON.stringify([AURORA_SWAP_CHAIN,recoveredOwner]);
    if(recoveredOwner!==null&&owner===JSON.stringify([deployment.chainId,recoveredOwner]))requireNearIntentAccess(state);
    else if(recoveredAurora){requireNearIntentAccess(state);requireAuroraAccountAccess(state);}
    else if(owner===JSON.stringify(['eip155:11155111',identity]))requireLendingAccountAccess(state);else requirePaymentAccess(state.identity);
    const records=await decode(state,identity),record=records.find(row=>row.owner===owner)??{owner,journal:empty()};
    if(!records.includes(record))records.push(record);
    const returned=await operation(record.journal);record.journal=checkIntentJournal(returned??record.journal);
    if(recoveredAurora){
     const {snapshotAuroraNoteRecovery}=await import('./intent-aurora-source.js');
     const [nearSource,auroraNotes,auroraAccount]=await Promise.all([snapshotNearIntentRecovery(state),snapshotAuroraNoteRecovery(state),snapshotAuroraAccountRecovery(state)]);
     await validateIntentActionRecovery([record],state.identity,nearSource,{auroraNotes,auroraAccount});
    }
    const checked=validate(records),raw=bytes(checked);signal?.throwIfAborted();guard?.();
    state.intentActionKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(identity)},state.intentActionKey,raw);
    signal?.throwIfAborted();guard?.();state.intentActionBox={iv:hex(iv),ciphertext:hex(ciphertext)};
    return structuredClone(record.journal);
   },{signal});
  }
 });
}
