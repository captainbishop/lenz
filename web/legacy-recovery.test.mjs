import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,hkdfSync} from 'node:crypto';
import {Mnemonic} from './public/evm-vendor/identity-recovery.js';
import {createRecoverableIdentity} from './public/identity-recovery.js';
import {createIdentity,sealMessage,openMessage,signValue,verifyValue,digest} from './public/peer-crypto.js';
import {makeAgreement,signAgreement} from './public/peer-exchange.js';
const {sealLegacyChatArchive,openLegacyChatArchive,validateRecoveryLink}=await import(process.env.LENZ_LEGACY_MODULE||'./public/legacy-recovery.js');
const ARCHIVE='lenz/legacy-chat-archive/v1',linkTerms=l=>[l.type,l.scope,l.nonce,l.createdAt,l.from,l.to];
async function fixture(){
 const old=await createIdentity('Amina'),peer=await createIdentity('Bola'),next=await createRecoverableIdentity('Amina');
 const outgoing=await sealMessage(old,peer.profile,{kind:'chat',text:'Meet by the bookshop.'}),incoming=await sealMessage(peer,old.profile,{kind:'chat',text:'See you there.'});
 return {old,peer,next,snapshot:{profile:old.profile,contacts:[peer.profile],messages:[{packet:outgoing},{packet:incoming}]}};
}
function unwrap(phrase,archive){
 const entropy=Buffer.from(Mnemonic.fromPhrase(phrase).entropy.slice(2),'hex'),key=Buffer.from(hkdfSync('sha256',entropy,Buffer.from(archive.salt,'hex'),ARCHIVE,32));
 const raw=Buffer.from(archive.ciphertext,'hex'),d=createDecipheriv('aes-256-gcm',key,Buffer.from(archive.iv,'hex'));d.setAAD(Buffer.from(JSON.stringify([archive.type,archive.kdf,archive.salt,archive.iv])));d.setAuthTag(raw.subarray(-16));
 return {content:JSON.parse(Buffer.concat([d.update(raw.subarray(0,-16)),d.final()])),key};
}
async function altered(f,archive,edit,{resign=true,phrase=f.next.phrase}={}){
 const {content}=unwrap(f.next.phrase,archive);await edit(content);
 if(resign)content.signature=await signValue(f.old,await digest([ARCHIVE,content.createdAt,content.profile,content.successor,content.contacts,content.messages,content.secrets,content.link]));
 const a=structuredClone(archive),entropy=Buffer.from(Mnemonic.fromPhrase(phrase).entropy.slice(2),'hex'),key=Buffer.from(hkdfSync('sha256',entropy,Buffer.from(a.salt,'hex'),ARCHIVE,32));
 const c=createCipheriv('aes-256-gcm',key,Buffer.from(a.iv,'hex'));c.setAAD(Buffer.from(JSON.stringify([a.type,a.kdf,a.salt,a.iv])));a.ciphertext=Buffer.concat([c.update(JSON.stringify(content)),c.final(),c.getAuthTag()]).toString('hex');return a;
}
test('a legacy archive preserves independently signed chat after old keys are unavailable',async()=>{
 const f=await fixture(),before=JSON.stringify(f.snapshot),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot),restored=await openLegacyChatArchive(f.next.phrase,archive);
 assert.notEqual(restored.identity.profile.id,f.old.profile.id);assert.equal(restored.identity.profile.id,f.next.identity.profile.id);assert.equal(restored.sourceProfile.id,f.old.profile.id);
 assert.deepEqual(restored.history.map(r=>r.payload.text),['Meet by the bookshop.','See you there.']);assert.deepEqual(restored.history.map(r=>r.packet),f.snapshot.messages.map(r=>r.packet));
 assert.equal(JSON.stringify(f.snapshot),before);assert.deepEqual(restored.recovery,{scope:'legacy-chat',financialState:'not-restored'});assert(!('signingPrivate' in restored.sourceProfile));assert(!('secrets' in restored));
 await assert.rejects(crypto.subtle.exportKey('jwk',f.old.signingPrivate));await assert.rejects(crypto.subtle.exportKey('jwk',f.old.boxPrivate));assert(!restored.identity.signingPrivate.extractable&&!restored.identity.boxPrivate.extractable);
 assert(!JSON.stringify(archive).includes('bookshop'));assert(!JSON.stringify(archive).includes(f.old.profile.id));assert(!JSON.stringify(archive).includes(f.next.phrase));
 const {content}=unwrap(f.next.phrase,archive);assert.equal(content.profile.id,f.old.profile.id);assert(content.secrets[0].key.length===64);
});
test('the old account and successor both authorize a link rooted in an already trusted contact',async()=>{
 const f=await fixture(),r=await openLegacyChatArchive(f.next.phrase,await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot));
 assert.equal((await validateRecoveryLink(r.link,f.old.profile.id)).to.id,r.identity.profile.id);
 await assert.rejects(validateRecoveryLink(r.link,f.peer.profile.id),/trusted account/);await assert.rejects(validateRecoveryLink(r.link));
 for(const field of ['oldSignature','newSignature']){const bad=structuredClone(r.link);bad[field]='00'.repeat(64);await assert.rejects(validateRecoveryLink(bad,f.old.profile.id),/authorization/);}
 for(const change of [l=>l.scope='payment-authority',l=>l.to=f.peer.profile,l=>l.extra=true]){const bad=structuredClone(r.link);change(bad);await assert.rejects(validateRecoveryLink(bad,f.old.profile.id));}
 const message=await sealMessage(r.identity,f.peer.profile,{kind:'chat',text:'Recovered chat.'});assert.equal((await openMessage(f.peer,r.identity.profile,message)).text,'Recovered chat.');
});
test('recovered successor cannot sign an obligation owned by the legacy signing key',async()=>{
 const f=await fixture(),r=await openLegacyChatArchive(f.next.phrase,await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot));
 const terms={kind:'example-authorization',amount:'1000000'},signature=await signValue(r.identity,terms);assert.equal(await verifyValue(f.old.profile.signingPublic,terms,signature),false);
 const notes=new Map([['root:example',{owner:f.old.profile.signingPublic,asset:'tUSD',value:'1000000'}]]),agreement=await makeAgreement({network:'test',pool:'test',kind:'transfer',inputs:['root:example'],outputs:[{owner:f.peer.profile.signingPublic,asset:'tUSD',value:'1000000'}]});
 await assert.rejects(signAgreement(r.identity,agreement,notes),/does not own/);assert.equal((await signAgreement(f.old,agreement,notes)).signatures.length,1);
});
test('archive keys cannot decrypt a later message in the same old conversation',async()=>{
 const f=await fixture(),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot),{content}=unwrap(f.next.phrase,archive);
 const future=await sealMessage(f.peer,f.old.profile,{kind:'chat',text:'Written after the backup.'});
 const header=Buffer.from(JSON.stringify([future.type,future.id,future.from,future.to,future.iv])),ciphertext=Buffer.from(future.ciphertext,'hex');
 const decrypt=key=>{const d=createDecipheriv('aes-256-gcm',key,Buffer.from(future.iv,'hex'));d.setAAD(header);d.setAuthTag(ciphertext.subarray(-16));return Buffer.concat([d.update(ciphertext.subarray(0,-16)),d.final()]);};
 for(const secret of content.secrets){
  const raw=Buffer.from(secret.key,'hex');
  assert.throws(()=>decrypt(raw));
  assert.throws(()=>decrypt(Buffer.from(hkdfSync('sha256',raw,Buffer.from(future.id,'hex'),header,32))));
 }
});
test('wrong phrases, modified envelope fields and foreign identities are rejected',async()=>{
 const f=await fixture(),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot),other=await createRecoverableIdentity('Other');
 await assert.rejects(openLegacyChatArchive(other.phrase,archive),/incorrect/);
 for(const field of ['salt','iv','ciphertext']){const bad=structuredClone(archive);bad[field]=(bad[field].startsWith('00')?'01':'00')+bad[field].slice(2);await assert.rejects(openLegacyChatArchive(f.next.phrase,bad));}
 for(const change of [a=>a.type='lenz/chat-archive/v1',a=>a.kdf='none',a=>a.extra=true,a=>a.ciphertext='abc',a=>a.ciphertext='00'.repeat(8_000_017)]){const bad=structuredClone(archive);change(bad);await assert.rejects(openLegacyChatArchive(f.next.phrase,bad));}
 const rebound=await altered(f,archive,()=>{},{phrase:other.phrase});await assert.rejects(openLegacyChatArchive(other.phrase,rebound),/another account/);
 await assert.rejects(sealLegacyChatArchive(f.peer,f.next.phrase,f.snapshot),/another account/);
});
test('a phrase holder cannot alter the old account-signed archive body',async()=>{
 const f=await fixture(),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot);
 const bad=await altered(f,archive,c=>c.contacts[0].name='Impersonated',{resign:false});await assert.rejects(openLegacyChatArchive(f.next.phrase,bad),/Archive authorization/);
 const linkChanged=await altered(f,archive,c=>c.createdAt++);await assert.rejects(openLegacyChatArchive(f.next.phrase,linkChanged),/link differ/);
});
test('archived message signatures and authenticated decryption survive an authorized but false snapshot',async()=>{
 const f=await fixture(),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot);
 const badSignature=await altered(f,archive,c=>c.messages[1].packet.signature='00'.repeat(64));await assert.rejects(openLegacyChatArchive(f.next.phrase,badSignature),/message signature/);
 const badSecret=await altered(f,archive,c=>c.secrets[0].key='00'.repeat(32));await assert.rejects(openLegacyChatArchive(f.next.phrase,badSecret));
 const duplicate=await altered(f,archive,c=>c.messages.push(c.messages[0]));await assert.rejects(openLegacyChatArchive(f.next.phrase,duplicate),/duplicate/);
 const missing=await altered(f,archive,c=>c.contacts=[]);await assert.rejects(openLegacyChatArchive(f.next.phrase,missing));
 const injected=await altered(f,archive,c=>c.secrets.push(c.secrets[0]));await assert.rejects(openLegacyChatArchive(f.next.phrase,injected),/message keys/);
});
test('financial payloads and monetary fields cannot be disguised as recovered chat',async()=>{
 const f=await fixture(),archive=await sealLegacyChatArchive(f.old,f.next.phrase,f.snapshot);
 for(const field of ['nearBox','tradeBox','balance','reservations','pendingOrders'])await assert.rejects(sealLegacyChatArchive(f.old,f.next.phrase,{...f.snapshot,[field]:{amount:'1000000'}}),/Only profile/);
 for(const payload of [{kind:'near-payment',amount:'1000000'},{kind:'chat',text:'Hello',balance:'1000000'}]){
  const packet=await sealMessage(f.peer,f.old.profile,payload);await assert.rejects(sealLegacyChatArchive(f.old,f.next.phrase,{...f.snapshot,messages:[{packet}]}),/Financial records/);
  const pub=await crypto.subtle.importKey('raw',Buffer.from(f.peer.profile.boxPublic,'hex'),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:pub},f.old.boxPrivate,256);
  const key=Buffer.from(hkdfSync('sha256',Buffer.from(shared),Buffer.from(packet.id,'hex'),JSON.stringify([packet.type,packet.id,packet.from,packet.to,packet.iv]),32)).toString('hex');
  const bad=await altered(f,archive,c=>{c.messages=[{packet}];c.secrets=[{message:packet.id,key}];});await assert.rejects(openLegacyChatArchive(f.next.phrase,bad),/Financial records/);
 }
});
test('private key pairing, duplicate contacts, field bounds and caller mutation are checked',async()=>{
 const f=await fixture();await assert.rejects(sealLegacyChatArchive({...f.old,boxPrivate:f.peer.boxPrivate},f.next.phrase,{...f.snapshot,messages:[]}),/Encryption key/);
 await assert.rejects(sealLegacyChatArchive({...f.old,signingPrivate:f.peer.signingPrivate},f.next.phrase,f.snapshot),/authorization|signature/);
 await assert.rejects(sealLegacyChatArchive(f.old,f.next.phrase,{...f.snapshot,contacts:[f.peer.profile,f.peer.profile]}),/Duplicate/);
 await assert.rejects(sealLegacyChatArchive(f.old,f.next.phrase,{...f.snapshot,messages:Array(1001).fill(f.snapshot.messages[0])}),/limit/);
 const captured=structuredClone(f.snapshot),saving=sealLegacyChatArchive(f.old,f.next.phrase,captured);captured.contacts[0].name='Changed during save';captured.messages=[];
 const archive=await saving,opening=openLegacyChatArchive(f.next.phrase,archive);archive.ciphertext='00';const restored=await opening;assert.equal(restored.contacts[0].name,'Bola');assert.equal(restored.history.length,2);
});
