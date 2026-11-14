import {readState,updateState} from './chat-store.js';
import {assert,digest,signValue,keysAre} from './peer-crypto.js';
import {ACCOUNT_REQUEST} from './account-keys.js';
import {createAccountBackup,openAccountBackup,accountChatSnapshot} from './account-backup.js';
import {createChatRestorer} from './chat-restore.js';
import {RECOVERED_CHAT} from './chat-access.js';
import {unlockLocalBackup} from './account-keys.js';
import {stageIdentityRecovery,isChatArchiveType} from './identity-recovery.js';
import {confidentialSpendOutbox} from './intents-spend-outbox.js';
import {restoreIntentRecovery,snapshotIntentRecovery} from './intent-account-recovery.js';
import {snapshotAuroraNoteRecovery} from './intent-aurora-source.js';
import {snapshotAuroraAccountRecovery} from './intent-aurora-account.js';
import {snapshotLendingAccountRecovery} from './intent-lending-account.js';
import {snapshotIntentActionRecovery} from './intent-action-store.js';
const empty=s=>keysAre(s,['identity','contacts','messages'])&&s.identity===null&&s.contacts.length===0&&s.messages.length===0;
const receiptOrder=packet=>JSON.stringify([packet.id,packet.iv,packet.ciphertext,packet.signature]);
const makeSync=(m,revision=0,hash='')=>({type:'lenz/account-sync/v1',accountId:m.accountId,authority:m.authority,backupKey:m.backupKey,deviceKey:m.deviceKey,phraseBox:m.phraseBox,revision,digest:hash,version:1,savedVersion:0,pending:null,status:'pending',savedAt:null});
function waitForBackup(pending,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',abort),abort=()=>{cleanup();reject(signal.reason);};
    Promise.resolve(pending).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
// A bound dispatcher must invoke the callback inside its session fence and wait
// for the reply outside it. The default retains ordinary single-profile behavior.
export async function accountRequest(sync,operation,{archive=null,expected=0,previous='',signal,dispatch=invoke=>invoke()}={},fetcher=fetch){
  signal?.throwIfAborted();
  async function post(path,body){
    const active=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]);
    const r=await waitForBackup(dispatch(()=>{active.throwIfAborted();return fetcher('/api/accounts/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:active});}),active);
    active.throwIfAborted();const value=await waitForBackup(r.json(),active);active.throwIfAborted();
    if(!r.ok)throw Object.assign(Error(value.error??'Backup is unavailable.'),{code:value.code,status:r.status});return value;
  }
  const {nonce}=await post('challenge',{accountId:sync.accountId,operation});assert(typeof nonce==='string'&&/^[a-f0-9]{64}$/.test(nonce),'Invalid backup challenge.');
  const terms=[ACCOUNT_REQUEST,location.origin,operation,sync.accountId,nonce,expected,previous,await digest(archive)];signal?.throwIfAborted();
  const signature=await signValue(sync.authority,terms);signal?.throwIfAborted();
  return post(operation,{profile:sync.authority.profile,nonce,expected,previous,archive,signature});
}
export async function setUpAccount(material,expectedIdentity=null){
  await updateState(state=>{assert((state.identity?.profile.id??null)===expectedIdentity,'This browser account changed during setup.');assert(!state.accountSync,'Backup is already set up in this browser.');if(!state.identity){assert(empty(state),'This browser has saved account data.');state.identity=material.identity;}state.accountSync=makeSync(material);},{markBackup:false});
}
export async function retrieveAccount(material){
  assert(empty(await readState()),'This browser already has an account.');
  const result=await accountRequest(material,'read'),value=await openAccountBackup(material,result),sync=makeSync(material,result.revision,result.digest);sync.savedVersion=1;sync.status='saved';sync.savedAt=result.savedAt;
  if(value.intentRecovery?.nearSource)sync.nearSourceBackup={publicKey:value.intentRecovery.nearSource.publicKey,version:1};
  if(value.intentRecovery?.auroraNotes)sync.auroraNotesBackup={publicKey:value.intentRecovery.auroraNotes.publicKey,commitments:value.intentRecovery.auroraNotes.records.map(row=>row.note.commitment),version:1};
  if(value.intentRecovery?.auroraAccount)sync.auroraAccountBackup={address:value.intentRecovery.auroraAccount.address,digest:await digest(value.intentRecovery.auroraAccount),version:1};
  if(value.intentRecovery?.lendingAccount)sync.lendingAccountBackup={ownerAddress:value.intentRecovery.lendingAccount.ownerAddress,account:value.intentRecovery.lendingAccount.account,digest:await digest(value.intentRecovery.lendingAccount),version:1};
  if(value.intentRecovery?.actions)sync.intentActionsBackup={digest:await digest(value.intentRecovery.actions),version:1};
  if(isChatArchiveType(value.chat.type)){
    await updateState(async state=>{assert(empty(state),'This browser already has an account.');state.identity=value.recovered.identity;state.identity.access=RECOVERED_CHAT;state.contacts=value.recovered.contacts;state.messages=value.recovered.messages;state.contactRecoveries=value.contactRecoveries;state.accountSync=sync;if(Object.hasOwn(value,'privateSpend'))await confidentialSpendOutbox.restore(state,value.privateSpend);if(value.intentRecovery)await restoreIntentRecovery(state,value.intentRecovery);},{markBackup:false});
  }else{
    const stage=createChatRestorer({read:readState,update:fn=>updateState(async state=>{const result=await fn(state);state.contactRecoveries=value.contactRecoveries;state.accountSync=sync;if(value.intentRecovery)await restoreIntentRecovery(state,value.intentRecovery);return result;},{markBackup:false})});
    await(await stage(material.phrase,new File([JSON.stringify(value.chat)],'backup.json'))).install();
  }
}
async function reconcileBackup(sync,{request,metadata,check}){
  const latest=await request(sync,'read',{expected:sync.revision,previous:sync.digest});
  try{
  if(latest.revision===sync.revision){assert(latest.digest===sync.digest,'Backup revision does not match.');return;}
  assert(latest.revision>sync.revision,'Backup service returned an older account.');
  const phrase=await unlockLocalBackup(sync);check();
  const material={...sync,phrase,identity:await stageIdentityRecovery(phrase,'Lenz account')};check();
  let remote;try{remote=await openAccountBackup(material,latest);}finally{material.phrase='';}check();
  await metadata(async state=>{
    const current=state.accountSync;assert(current?.accountId===sync.accountId&&current.revision===sync.revision,'Account changed during synchronization.');
    assert(isChatArchiveType(remote.chat.type)&&!state.recoveredChat&&remote.recovered.identity.profile.id===state.identity.profile.id,'These device histories need a verified transfer.');
    const dirty=current.version!==current.savedVersion||!!current.pending;
    const contacts=new Map(remote.recovered.contacts.map(p=>[p.id,p]));for(const p of state.contacts)if(dirty||!contacts.has(p.id))contacts.set(p.id,p);
    const messages=new Map(remote.recovered.messages.map(r=>[r.packet.id,r]));
    for(const record of state.messages){
      const remoteRecord=messages.get(record.packet.id);
      assert(!remoteRecord||JSON.stringify(remoteRecord.packet)===JSON.stringify(record.packet),'Message histories disagree.');
      const merged={...remoteRecord,...record};
      // Two devices may prepare different valid receipts. Keep the same existing
      // packet on both devices so reconciliation does not cause repeated uploads.
      for(const field of ['receiptToShare','receivedReceipt']){
        const remoteReceipt=remoteRecord?.[field],localReceipt=record[field];
        if(remoteReceipt&&(!localReceipt||receiptOrder(remoteReceipt)<=receiptOrder(localReceipt)))merged[field]=remoteReceipt;
      }
      messages.set(record.packet.id,merged);
    }
    const updates=new Map(remote.contactRecoveries.map(link=>[link.from.id,link]));for(const link of state.contactRecoveries??[]){const earlier=updates.get(link.from.id);assert(!earlier||earlier.to.id===link.to.id,'Contact updates disagree.');updates.set(link.from.id,link);}
    assert(contacts.size<=500&&messages.size<=1000,'Combined conversations exceed the backup limit.');
    state.contacts=[...contacts.values()];state.messages=[...messages.values()];state.contactRecoveries=[...updates.values()];
    if(!dirty)state.identity.profile=remote.recovered.identity.profile;
    const contents=({profile,contacts,messages},links)=>JSON.stringify([profile,[...contacts].sort((a,b)=>a.id.localeCompare(b.id)),messages.map(r=>[r.packet,r.receiptToShare??null,r.receivedReceipt??null]).sort((a,b)=>a[0].id.localeCompare(b[0].id)),[...links].sort((a,b)=>a.from.id.localeCompare(b.from.id))]);
    const remotePrivate=remote.privateSpend??{type:'lenz/private-spend-history/v1',identity:state.identity.profile.id,rows:[]},mergedPrivate=await confidentialSpendOutbox.restore(state,remotePrivate);
    if(remote.intentRecovery)await restoreIntentRecovery(state,remote.intentRecovery);const mergedIntents=await snapshotIntentRecovery(state);
    const canonical=value=>JSON.stringify(value,(_,v)=>v&&!Array.isArray(v)&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
    const changed=contents(await accountChatSnapshot(state),state.contactRecoveries)!==contents({profile:remote.recovered.identity.profile,contacts:remote.recovered.contacts,messages:remote.recovered.messages},remote.contactRecoveries)||canonical(mergedPrivate)!==canonical(remotePrivate)||canonical(mergedIntents)!==canonical(remote.intentRecovery??null);
    if(remote.intentRecovery?.nearSource)current.nearSourceBackup={publicKey:remote.intentRecovery.nearSource.publicKey,version:current.version+1};
    if(remote.intentRecovery?.auroraNotes)current.auroraNotesBackup={publicKey:remote.intentRecovery.auroraNotes.publicKey,commitments:remote.intentRecovery.auroraNotes.records.map(row=>row.note.commitment),version:current.version+1};
    if(remote.intentRecovery?.auroraAccount)current.auroraAccountBackup={address:remote.intentRecovery.auroraAccount.address,digest:await digest(remote.intentRecovery.auroraAccount),version:current.version+1};
    if(remote.intentRecovery?.lendingAccount)current.lendingAccountBackup={ownerAddress:remote.intentRecovery.lendingAccount.ownerAddress,account:remote.intentRecovery.lendingAccount.account,digest:await digest(remote.intentRecovery.lendingAccount),version:current.version+1};
    if(remote.intentRecovery?.actions)current.intentActionsBackup={digest:await digest(remote.intentRecovery.actions),version:current.version+1};
    current.revision=latest.revision;current.digest=latest.digest;current.pending=null;current.version++;current.status=changed?'pending':'saved';current.savedAt=latest.savedAt;if(!changed)current.savedVersion=current.version;
  });
  check();if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('proof-u-chat-refresh');channel.postMessage('changed');channel.close();}
  }catch(error){check();await metadata(state=>{if(state.accountSync?.accountId===sync.accountId&&state.accountSync.revision===sync.revision)state.accountSync.status='conflict';});throw error;}
}
// Request adapters receive cancellation and dispatch in their fourth argument;
// storage adapters must keep the signal effective through their commit.
const backupRequest=(sync,operation,options,context)=>accountRequest(sync,operation,{...options,...context});
export function createBackupRunner({read=readState,update=updateState,request=backupRequest,capture=createAccountBackup,signal:parentSignal,dispatch}={}){
  const controller=new AbortController(),signal=parentSignal?AbortSignal.any([parentSignal,controller.signal]):controller.signal;
  // accountRequest reserves its fourth argument for an optional fetch implementation.
  const send=request===accountRequest?backupRequest:request;
  let inflight=null;
  const check=()=>signal.throwIfAborted();
  const metadata=async fn=>{check();const value=await waitForBackup(update(async state=>{check();const result=await fn(state);check();return result;},{markBackup:false,signal}),signal);check();return value;};
  const requestCurrent=async(sync,operation,options)=>{check();const value=await waitForBackup(send(sync,operation,options,{signal,dispatch}),signal);check();return value;};
  async function run(){
    check();const state=await waitForBackup(read(),signal);check();const s=state.accountSync;if(!s||s.status==='conflict')return;
    if(s.savedVersion===s.version&&!s.pending){await reconcileBackup(s,{request:requestCurrent,metadata,check});return;}
    const accountId=s.accountId;
    try{
      let pending=s.pending;
      if(!pending){const archive=await waitForBackup(capture(structuredClone(state)),signal);check();let nearSourcePublicKey,auroraNotesBackup,auroraAccountBackup,lendingAccountBackup,intentActionsBackup;
        if(state.nearIntentSource||state.auroraOwnedAccount||state.lendingOwnedAccount||state.intentActionBox){const material={...s,phrase:await unlockLocalBackup(s)};try{material.identity=await stageIdentityRecovery(material.phrase,'Lenz account');const verified=await openAccountBackup(material,{archive,revision:archive.revision,digest:await digest(archive),savedAt:0});check();if(state.nearIntentSource){assert(verified.intentRecovery?.nearSource?.publicKey===state.nearIntentSource.publicKey,'The encrypted backup did not preserve this NEAR key.');nearSourcePublicKey=state.nearIntentSource.publicKey;}if(state.auroraIntentNotes){const notes=await snapshotAuroraNoteRecovery(state),expected=structuredClone(notes);
          if(verified.recovered.sourceProfile?.id===notes.owner)expected.owner=verified.recovered.identity.profile.id;
          assert(JSON.stringify(verified.intentRecovery?.auroraNotes)===JSON.stringify(expected),'The encrypted backup did not preserve the original private notes and requests.');auroraNotesBackup={publicKey:notes.publicKey,commitments:notes.records.map(row=>row.note.commitment)};}if(state.auroraOwnedAccount){const account=await snapshotAuroraAccountRecovery(state),expected=structuredClone(account);if(verified.recovered.sourceProfile?.id===account.owner)expected.owner=verified.recovered.identity.profile.id;assert(JSON.stringify(verified.intentRecovery?.auroraAccount)===JSON.stringify(expected),'The encrypted backup did not preserve the original Aurora spending key and transfer journal.');auroraAccountBackup={address:account.address,digest:await digest(account)};}if(state.lendingOwnedAccount){const account=await snapshotLendingAccountRecovery(state),expected=structuredClone(account);if(verified.recovered.sourceProfile?.id===account.owner)expected.owner=verified.recovered.identity.profile.id;assert(JSON.stringify(verified.intentRecovery?.lendingAccount)===JSON.stringify(expected),'The encrypted backup did not preserve the original lending owner, account and permission journal.');lendingAccountBackup={ownerAddress:account.ownerAddress,account:account.account,digest:await digest(account)};}const actions=await snapshotIntentActionRecovery(state);assert(JSON.stringify(verified.intentRecovery?.actions??[])===JSON.stringify(actions),'The encrypted backup did not preserve the exact reviewed actions and authorizations.');intentActionsBackup={digest:await digest(actions)};}finally{material.phrase='';}}
        pending={archive,version:s.version,expected:s.revision,previous:s.digest,...(nearSourcePublicKey?{nearSourcePublicKey}:{}),...(auroraNotesBackup?{auroraNotesBackup}:{}),...(auroraAccountBackup?{auroraAccountBackup}:{}),...(lendingAccountBackup?{lendingAccountBackup}:{}),...(intentActionsBackup?{intentActionsBackup}:{})};
        await metadata(current=>{assert(current.accountSync?.accountId===accountId&&current.accountSync.revision===s.revision,'Account changed during backup.');if(current.accountSync.pending)pending=current.accountSync.pending;else current.accountSync.pending=pending;});}
      await metadata(current=>{if(current.accountSync?.accountId===accountId)current.accountSync.status='uploading';});globalThis.dispatchEvent?.(new Event('lenz-backup-status'));
      const result=await requestCurrent(s,'write',pending);
      assert(result.revision===pending.expected+1&&result.digest===await digest(pending.archive)&&Number.isSafeInteger(result.savedAt),'Backup acknowledgement does not match.');
      await metadata(current=>{const c=current.accountSync;assert(c?.accountId===accountId&&c.pending?.version===pending.version&&c.pending?.expected===pending.expected,'Account changed during backup.');c.revision=result.revision;c.digest=result.digest;c.savedVersion=pending.version;if(pending.nearSourcePublicKey)c.nearSourceBackup={publicKey:pending.nearSourcePublicKey,version:pending.version};if(pending.auroraNotesBackup)c.auroraNotesBackup={...pending.auroraNotesBackup,version:pending.version};if(pending.auroraAccountBackup)c.auroraAccountBackup={...pending.auroraAccountBackup,version:pending.version};if(pending.lendingAccountBackup)c.lendingAccountBackup={...pending.lendingAccountBackup,version:pending.version};if(pending.intentActionsBackup)c.intentActionsBackup={...pending.intentActionsBackup,version:pending.version};c.pending=null;c.savedAt=result.savedAt;c.status=c.version===c.savedVersion?'saved':'pending';});
    }catch(error){
      check();if(error.code==='CONFLICT'){try{await reconcileBackup(s,{request:requestCurrent,metadata,check});return;}catch(conflict){check();await metadata(current=>{if(current.accountSync?.accountId===accountId)current.accountSync.status='conflict';});throw conflict;}}
      await metadata(current=>{if(current.accountSync?.accountId===accountId)current.accountSync.status='pending';});throw error;
    }
  }
  return Object.assign(async()=>{check();return inflight??=(async()=>{try{return await run();}finally{inflight=null;}})();},{signal,stop:()=>controller.abort(Error('Account backup stopped.'))});
}
const runBackup=createBackupRunner();
let activeSync=null;
async function lockedBackup(run){run.signal.throwIfAborted();return navigator.locks.request('lenz-account-backup',{signal:run.signal},run);}
export const backupNow=()=>activeSync?activeSync.backupNow():lockedBackup(runBackup);
export async function requireIntentActionBackup(identity,owner,reviewId,{signal,read=readState,backup=backupNow}={}){
  signal?.throwIfAborted();let state=await read();assert(state.identity?.profile.id===identity,'Open the original Lenz account before backing up this action.');
  const version=state.accountSync?.version,actions=await snapshotIntentActionRecovery(state),record=actions.find(row=>row.owner===owner);
  assert(Number.isSafeInteger(version)&&version>0&&record&&(record.journal.review?.id===reviewId||record.journal.attempts.some(row=>row.id===reviewId)),'Keep the original reviewed action and set up encrypted account recovery.');
  signal?.throwIfAborted();await backup();signal?.throwIfAborted();state=await read();assert(state.identity?.profile.id===identity,'The original action backup account changed.');
  const current=await snapshotIntentActionRecovery(state),saved=current.find(row=>row.owner===owner),sync=state.accountSync,coverage=sync?.intentActionsBackup;
  assert(JSON.stringify(saved)===JSON.stringify(record),'The reviewed action or original authorization changed during backup.');
  assert(coverage?.digest===await digest(current)&&Number.isSafeInteger(coverage.version)&&coverage.version>=version&&sync.savedVersion>=coverage.version&&sync.savedVersion>=version&&sync.status!=='conflict','The exact reviewed action and authorization are not backed up yet.');signal?.throwIfAborted();
}
export function stopAccountSync(){runBackup.stop();activeSync?.stop();}
export function startAccountSync(options={}){
  if(activeSync&&!activeSync.signal.aborted)return activeSync;
  runBackup.stop();
  const controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const create=()=>createBackupRunner({...options,signal}),read=options.read??readState;
  let runner=create(),timer,suspended=false;
  const live=()=>!signal.aborted&&!suspended;
  const schedule=(delay=600)=>{
    if(!live())return;clearTimeout(timer);
    timer=setTimeout(async()=>{
      const started=runner;if(!live()||!navigator.onLine)return;let again=false;
      try{
        await lockedBackup(started);if(!live()||started!==runner)return;
        const s=(await waitForBackup(read(),started.signal)).accountSync;
        again=s?.status==='pending'&&s.version>s.savedVersion;
      }catch{}finally{if(live()&&started===runner){dispatchEvent(new Event('lenz-backup-status'));schedule(again?600:30000);}}
    },delay);
  };
  const changed=()=>schedule(),online=()=>schedule(0);
  const hide=()=>{suspended=true;clearTimeout(timer);runner.stop();};
  const show=()=>{if(signal.aborted)return;if(suspended){runner=create();suspended=false;}schedule(0);};
  const listeners=[['lenz-account-changed',changed],['online',online],['pagehide',hide],['pageshow',show]];
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('lenz-account-sync'):null;
  const cleanup=()=>{clearTimeout(timer);runner.stop();for(const [event,listener]of listeners)removeEventListener(event,listener);channel?.removeEventListener('message',changed);channel?.close();signal.removeEventListener('abort',cleanup);};
  for(const [event,listener]of listeners)addEventListener(event,listener);channel?.addEventListener('message',changed);
  signal.addEventListener('abort',cleanup,{once:true});if(signal.aborted)cleanup();
  activeSync=Object.freeze({signal,stop:()=>controller.abort(Error('Account backup stopped.')),backupNow:async()=>{signal.throwIfAborted();assert(!suspended,'Account backup is suspended.');return lockedBackup(runner);}});
  schedule(0);return activeSync;
}
