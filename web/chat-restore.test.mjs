import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,sealMessage,openMessage,signValue} from './public/peer-crypto.js';
import {createRecoverableIdentity,sealChatArchive} from './public/identity-recovery.js';
import {sealLegacyChatArchive,openLegacyChatArchive} from './public/legacy-recovery.js';
const {fundingRequest,makeNearPayment,acceptNearPayment,emptyNearVault,compressed,saveNearVault,readNearVault}=await import(process.env.LENZ_RESTORE_NEAR_MODULE||'./public/near-protocol.js');
import {makeAgreement,signAgreement} from './public/peer-exchange.js';
import {receivePacket} from './public/receive-packet.js';
const {prepareNearPayment}=await import(process.env.LENZ_RESTORE_PAYMENT_MODULE||'./public/near-payment-service.js');
import {wrapForCarrier,inboxRequest} from './public/carrier-protocol.js';
const {createChatRestorer,readRecoveredHistory}=await import(process.env.LENZ_CHAT_RESTORE_MODULE||'./public/chat-restore.js');
const {checkContactRecovery}=await import(process.env.LENZ_CONTACT_RECOVERY_MODULE||'./public/contact-recovery.js');
const {RECOVERED_CHAT,checkSigningAccess,requirePaymentAccess}=await import(process.env.LENZ_CHAT_ACCESS_MODULE||'./public/chat-access.js');
const contract='recovery.testnet',empty=()=>({identity:null,contacts:[],messages:[]});
async function fixture(){
 const old=await createIdentity('Amina'),peer=await createIdentity('Bola'),next=await createRecoverableIdentity('Amina');
 const packet=await sealMessage(peer,old.profile,{kind:'chat',text:'Only encrypted history should persist.'});
 const archive=await sealLegacyChatArchive(old,next.phrase,{profile:old.profile,contacts:[peer.profile],messages:[{packet}]});
 return {old,peer,next,archive,file:new File([JSON.stringify(archive)],'backup.json')};
}
function store(initial=empty()){
 let state=structuredClone(initial),tail=Promise.resolve();
 return {read:async()=>structuredClone(state),update:operation=>{const job=tail.then(async()=>{const next=structuredClone(state),result=await operation(next);state=next;return result;});tail=job.catch(()=>{});return job;}};
}
test('restoration installs usable successor chat and encrypted history in an empty account',async()=>{
 const f=await fixture(),s=store(),review=await createChatRestorer(s)(f.next.phrase,f.file);
 assert(review.canInstall);assert.equal((await s.read()).identity,null);review.preview.contacts[0].name='Edited preview';review.preview.history[0].payload.text='Edited preview';
 await review.install();const state=await s.read();assert.equal(state.identity.profile.id,f.next.identity.profile.id);assert.notEqual(state.identity.profile.id,f.old.profile.id);assert.equal(state.identity.access,RECOVERED_CHAT);
 assert.equal(state.contacts[0].name,'Bola');assert.deepEqual(state.messages,[]);assert(!JSON.stringify(state).includes('Only encrypted history'));
 assert.equal((await readRecoveredHistory(state)).history[0].payload.text,'Only encrypted history should persist.');
 const packet=await sealMessage(state.identity,f.peer.profile,{kind:'chat',text:'Chat continues.'});assert.equal((await openMessage(f.peer,state.identity.profile,packet)).text,'Chat continues.');
 assert(!state.identity.signingPrivate.extractable&&!state.identity.boxPrivate.extractable&&!state.recoveredChat.key.extractable);
 await assert.rejects(review.install(),/already has/);
});
test('existing identities, residual messages and financial fields are never overwritten',async()=>{
 const f=await fixture();
 for(const initial of [{...empty(),identity:f.old},{...empty(),contacts:[f.peer.profile]},{...empty(),messages:[{}]},{...empty(),nearBox:{ciphertext:'preserve'}},{...empty(),pendingOrders:['saved']},{...empty(),extra:true}]){
  const s=store(initial),before=await s.read(),review=await createChatRestorer(s)(f.next.phrase,f.file);assert.equal(review.canInstall,false);await assert.rejects(review.install(),/already has/);assert.deepEqual(await s.read(),before);
 }
});
test('concurrent restore reviews recheck state inside the write lock',async()=>{
 const f=await fixture(),s=store(),stage=createChatRestorer(s),one=await stage(f.next.phrase,f.file),two=await stage(f.next.phrase,f.file);
 const results=await Promise.allSettled([one.install(),two.install()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await s.read()).identity.profile.id,f.next.identity.profile.id);
});
test('failed saves and cancelled or superseded reviews leave storage intact',async()=>{
 const f=await fixture(),s=store(),stage=createChatRestorer(s),cancelled=await stage(f.next.phrase,f.file);cancelled.cancel();await assert.rejects(cancelled.install(),/again/);assert.equal((await s.read()).identity,null);
 const queued=await stage(f.next.phrase,f.file),pending=queued.install();queued.cancel();await assert.rejects(pending,/cancelled/);assert.equal((await s.read()).identity,null);
 const failed=await createChatRestorer({read:s.read,update:async fn=>{await fn(await s.read());throw Error('Write failed');}})(f.next.phrase,f.file);await assert.rejects(failed.install(),/Write failed/);assert.equal((await s.read()).identity,null);
 const superseded=await stage(f.next.phrase,f.file);await s.update(state=>{state.identity=f.old;});await assert.rejects(superseded.install(),/already has/);assert.equal((await s.read()).identity.profile.id,f.old.profile.id);
});
test('history authentication rejects tampering and foreign account substitution',async()=>{
 const f=await fixture(),s=store();await(await createChatRestorer(s)(f.next.phrase,f.file)).install();
 for(const edit of [s=>s.recoveredChat.ciphertext=(parseInt(s.recoveredChat.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0')+s.recoveredChat.ciphertext.slice(2),s=>s.recoveredChat.sourceId='a'.repeat(64),s=>s.identity.profile=f.peer.profile]){const bad=await s.read();edit(bad);await assert.rejects(readRecoveredHistory(bad));}
});
test('recovered chat signs messaging transport but cannot sign financial or unknown domains',async()=>{
 const f=await fixture(),s=store();await(await createChatRestorer(s)(f.next.phrase,f.file)).install();const state=await s.read(),identity=state.identity;
 for(const domain of ['lenz/near-fund/v1','lenz/near-transfer/v1','proof-u/authorize-exchange/v1','lenz/defi-request/v1','unrecognized-domain']){assert.throws(()=>checkSigningAccess(identity,[domain,'terms']),/funds/);await assert.rejects(signValue(identity,[domain,'terms']),/funds/);}
 assert.throws(()=>requirePaymentAccess(identity),/funds/);assert.throws(()=>checkSigningAccess({...identity,access:'unknown'},['proof-u/private-conversation/v1']),/funds/);
 const p=await sealMessage(identity,f.peer.profile,{kind:'chat',text:'Transport works.'});await wrapForCarrier(identity,p);await inboxRequest(identity,'http://127.0.0.1:4311');
 await assert.rejects(fundingRequest(identity,contract,'1'),/funds/);
 const v=emptyNearVault(contract);v.roots.push({id:'root:'+'a'.repeat(64),owner:compressed(identity.profile.signingPublic),amount:'1000000'});
 await assert.rejects(makeNearPayment(v,identity,f.peer.profile,'1'),/funds/);await assert.rejects(saveNearVault(state,v),/funds/);assert(!state.nearBox);
 const saved={identity:{...identity,access:undefined}};await saveNearVault(saved,emptyNearVault(contract));saved.identity.access=RECOVERED_CHAT;await assert.rejects(readNearVault(saved,contract),/funds/);
 const notes=new Map([['synthetic',{owner:identity.profile.signingPublic,asset:'tUSD',value:'1000000'}]]),a=await makeAgreement({network:'test',pool:'test',kind:'transfer',inputs:['synthetic'],outputs:[{owner:f.peer.profile.signingPublic,asset:'tUSD',value:'1000000'}]});await assert.rejects(signAgreement(identity,a,notes),/funds/);
 assert((await fundingRequest(f.old,contract,'1')).signature);
});
test('valid incoming payments and contact payment redirects are blocked without changing liabilities',async()=>{
 const f=await fixture(),s=store();await(await createChatRestorer(s)(f.next.phrase,f.file)).install();const state=await s.read(),v=emptyNearVault(contract);v.roots.push({id:'root:'+'b'.repeat(64),owner:compressed(f.peer.profile.signingPublic),amount:'1000000'});
 const payment=await makeNearPayment(v,f.peer,state.identity.profile,'1'),packet=await sealMessage(f.peer,state.identity.profile,payment.payload),before=structuredClone(state);
 await assert.rejects(acceptNearPayment(emptyNearVault(contract),state.identity,f.peer.profile,payment.payload),/funds/);
 await assert.rejects(receivePacket(state,packet,false,contract),/funds/);assert.deepEqual(state,before);
 const linked={identity:f.peer,contacts:[f.old.profile,state.identity.profile],messages:[],contactRecoveries:[state.recoveredChat.link]};await saveNearVault(linked,v);const unchanged=structuredClone(linked);await assert.rejects(prepareNearPayment(linked,contract,state.identity.profile.id,'1'),/available for chat/);assert.deepEqual(linked,unchanged);
});
test('contact updates require a trusted root and reject competing successors',async()=>{
 const f=await fixture(),r=await openLegacyChatArchive(f.next.phrase,f.archive),state={identity:f.peer,contacts:[{...f.old.profile,name:'Saved name'}],messages:[]};
 const checked=await checkContactRecovery(state,r.link);assert.equal(checked.previousName,'Saved name');assert.equal(checked.link.to.id,r.identity.profile.id);
 await assert.rejects(checkContactRecovery({...state,contacts:[]},r.link),/trusted/);
 const other=await createRecoverableIdentity('Amina'),fork=await openLegacyChatArchive(other.phrase,await sealLegacyChatArchive(f.old,other.phrase,{profile:f.old.profile,contacts:[],messages:[]}));
 await assert.rejects(checkContactRecovery({...state,contactRecoveries:[r.link]},fork.link),/different update/);
 await assert.rejects(checkContactRecovery({...state,identity:r.identity},r.link),/own account/);
 const corrupt=structuredClone(r.link);corrupt.oldSignature='00'.repeat(64);await assert.rejects(checkContactRecovery(state,corrupt),/authorization/);
});
test('a later backup restores the same chat ID with both original history and new messages',async()=>{
 const f=await fixture(),first=store();await(await createChatRestorer(first)(f.next.phrase,f.file)).install();const state=await first.read();
 const packet=await sealMessage(state.identity,f.peer.profile,{kind:'chat',text:'Written after recovery.'});
 const current=await sealChatArchive(f.next.phrase,{profile:state.identity.profile,contacts:state.contacts,messages:[{packet}]});
 const bundle={type:'lenz/recovered-chat-backup/v1',legacy:state.recoveredChat.archive,current},file=new File([JSON.stringify(bundle)],'backup.json'),second=store(),review=await createChatRestorer(second)(f.next.phrase,file);
 assert.deepEqual(review.preview.history.map(r=>r.payload.text),['Only encrypted history should persist.','Written after recovery.']);await review.install();const restored=await second.read();
 assert.equal(restored.identity.profile.id,state.identity.profile.id);assert.equal(restored.messages.length,1);assert.equal((await readRecoveredHistory(restored)).history.length,1);assert.equal((await openMessage(restored.identity,f.peer.profile,restored.messages[0].packet)).text,'Written after recovery.');
 assert.deepEqual(restored.recoveredChat.link,state.recoveredChat.link);assert.equal(restored.identity.access,RECOVERED_CHAT);await assert.rejects(fundingRequest(restored.identity,contract,'1'),/funds/);
});
