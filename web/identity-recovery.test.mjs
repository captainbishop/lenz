import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,createCipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {createIdentity,sealMessage,openMessage,signValue,verifyValue} from './public/peer-crypto.js';
import {prepareDeliveryReceipt,acceptDeliveryReceipt,deliveryAcknowledged} from './public/delivery-receipts.js';
const {createRecoverableIdentity,stageIdentityRecovery,sealChatArchive,openChatArchive}=await import(process.env.LENZ_RECOVERY_MODULE||'./public/identity-recovery.js');
// Public BIP-39 zero-entropy test vector, never a funded account.
const vector=Array(23).fill('abandon').join(' ')+' art';
function vectorArchive(type,snapshot){
  const salt=randomBytes(32),iv=randomBytes(12),archive={type,kdf:'HKDF-SHA256/entropy256',salt:salt.toString('hex'),iv:iv.toString('hex')};
  const key=Buffer.from(hkdfSync('sha256',Buffer.alloc(32),salt,type,32));
  try{
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify([archive.type,archive.kdf,archive.salt,archive.iv])));
    return {...archive,ciphertext:Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final(),cipher.getAuthTag()]).toString('hex')};
  }finally{key.fill(0);}
}
async function fixture(){
  const a=await createRecoverableIdentity('Amina'),b=await createIdentity('Bola');
  const outgoing=await sealMessage(a.identity,b.profile,{kind:'chat',text:'Meet by the bookshop.'});
  const incoming=await sealMessage(b,a.identity.profile,{kind:'chat',text:'See you there.'});
  return {a,b,snapshot:{profile:a.identity.profile,contacts:[b.profile],messages:[{packet:outgoing},{packet:incoming}]}};
}
test('P256 recovery matches independent HKDF/OpenSSL keys, separates roles and preserves nonextractability',async()=>{
  const identity=await stageIdentityRecovery(vector,'Amina');
  const pubs=['signing','encryption'].map(role=>{const raw=Buffer.from(hkdfSync('sha256',Buffer.alloc(32),'lenz/identity-recovery/v1',role+'/0',32));const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(raw);raw.fill(0);return ecdh.getPublicKey('hex','uncompressed');});
  assert.equal(identity.profile.signingPublic,pubs[0]);assert.equal(identity.profile.boxPublic,pubs[1]);assert.notEqual(pubs[0],pubs[1]);
  assert.equal(identity.signingPrivate.extractable,false);assert.equal(identity.boxPrivate.extractable,false);
  await assert.rejects(crypto.subtle.exportKey('jwk',identity.signingPrivate));
  await assert.rejects(crypto.subtle.exportKey('jwk',identity.boxPrivate));
  const renamed=await stageIdentityRecovery(vector.toUpperCase().replaceAll(' ','  '),'Renamed');assert.equal(renamed.profile.id,identity.profile.id);
});
test('new phrases have 24 words, distinct identities and no raw recovery material on the active identity',async()=>{
  const a=await createRecoverableIdentity('Amina'),b=await createRecoverableIdentity('Bola');
  assert.equal(a.phrase.split(' ').length,24);assert(a.phrase!==b.phrase);assert.notEqual(a.identity.profile.id,b.identity.profile.id);
  assert.deepEqual(Object.keys(a.identity).sort(),['boxPrivate','profile','signingPrivate']);
  const restored=await stageIdentityRecovery(a.phrase,'Amina');assert.equal(restored.profile.id,a.identity.profile.id);
  for(const phrase of ['',Array(24).fill('abandon').join(' '),'a'.repeat(513),vector+' art'])await assert.rejects(stageIdentityRecovery(phrase,'Amina'));
});
test('two restored identities decrypt old messages and sign verifiable new chat messages',async()=>{
  const f=await fixture(),archive=await sealChatArchive(f.a.phrase,f.snapshot);
  const one=await openChatArchive(f.a.phrase,archive),two=await openChatArchive(f.a.phrase,archive);
  assert.equal(one.identity.profile.id,f.a.identity.profile.id);assert.equal(two.identity.profile.id,one.identity.profile.id);
  for(const restored of [one,two]){
    assert.equal((await openMessage(restored.identity,f.b.profile,f.snapshot.messages[0].packet)).text,'Meet by the bookshop.');
    assert.equal((await openMessage(restored.identity,f.b.profile,f.snapshot.messages[1].packet)).text,'See you there.');
    assert(await verifyValue(f.a.identity.profile.signingPublic,{kind:'chat',text:'Restored'},await signValue(restored.identity,{kind:'chat',text:'Restored'})));
    assert.deepEqual(restored.recovery,{scope:'chat-only',financialState:'not-restored'});
    assert.deepEqual(Object.keys(restored).sort(),['contacts','identity','messages','recovery']);
  }
  const second=await sealChatArchive(f.a.phrase,f.snapshot);assert.notEqual(archive.salt,second.salt);assert.notEqual(archive.iv,second.iv);assert.notEqual(archive.ciphertext,second.ciphertext);
  const encoded=JSON.stringify(archive);for(const privateText of [f.a.phrase,f.a.identity.profile.id,'Amina','bookshop'])assert(!encoded.includes(privateText));
});

test('same-ID archives retain verified acknowledgements and exact receipt retries',async()=>{
  const f=await fixture(),state={identity:f.a.identity,contacts:[f.b.profile],messages:f.snapshot.messages};
  const peer={identity:f.b,contacts:[f.a.identity.profile],messages:[{packet:f.snapshot.messages[0].packet}]};
  await acceptDeliveryReceipt(state,await prepareDeliveryReceipt(peer,peer.messages[0].packet.id));
  const retry=await prepareDeliveryReceipt(state,state.messages[1].packet.id);
  const archive=await sealChatArchive(f.a.phrase,{...f.snapshot,messages:state.messages}),restored=await openChatArchive(f.a.phrase,archive);
  assert.equal(archive.type,'lenz/chat-archive/v2');
  assert.equal(await deliveryAcknowledged(restored,restored.messages[0]),true);
  assert.deepEqual(await prepareDeliveryReceipt(restored,restored.messages[1].packet.id),retry);
  assert.deepEqual(restored.messages,state.messages);
});

test('v1 archives remain readable without accepting v2 receipt fields or retagged ciphertext',async()=>{
  const identity=await stageIdentityRecovery(vector,'Amina'),peer=await createIdentity('Bola'),packet=await sealMessage(peer,identity.profile,{kind:'chat',text:'An older backup.'});
  const snapshot={profile:identity.profile,contacts:[peer.profile],messages:[{packet}]},legacy=vectorArchive('lenz/chat-archive/v1',snapshot);
  const restored=await openChatArchive(vector,legacy);assert.equal((await openMessage(restored.identity,peer.profile,restored.messages[0].packet)).text,'An older backup.');
  await assert.rejects(openChatArchive(vector,{...legacy,type:'lenz/chat-archive/v2'}));
  const state={identity,contacts:snapshot.contacts,messages:snapshot.messages};await prepareDeliveryReceipt(state,packet.id);
  await assert.rejects(openChatArchive(vector,vectorArchive('lenz/chat-archive/v1',snapshot)),/fields/);
});

test('authenticated v2 archives reject forged, misbound and misdirected receipts',async()=>{
  const identity=await stageIdentityRecovery(vector,'Amina'),peer=await createIdentity('Bola');
  const outgoing=await sealMessage(identity,peer.profile,{kind:'chat',text:'Acknowledged message.'}),incoming=await sealMessage(peer,identity.profile,{kind:'chat',text:'Received message.'});
  const state={identity,contacts:[peer.profile],messages:[{packet:outgoing},{packet:incoming}]},other={identity:peer,contacts:[identity.profile],messages:[{packet:outgoing}]};
  const receipt=await prepareDeliveryReceipt(other,outgoing.id);await acceptDeliveryReceipt(state,receipt);await prepareDeliveryReceipt(state,incoming.id);
  const snapshot={profile:identity.profile,contacts:state.contacts,messages:state.messages};
  const payload=await openMessage(identity,peer.profile,receipt);
  const malformed=await sealMessage(peer,identity.profile,{...payload,balance:'1000000'}),wrongFile=await sealMessage(peer,identity.profile,{...payload,messageHash:'0'.repeat(64)});
  for(const alter of [
    s=>s.messages[0].receivedReceipt.signature='00'.repeat(64),
    s=>s.messages[0].receivedReceipt=wrongFile,
    s=>s.messages[0].receivedReceipt=malformed,
    s=>s.messages[0].receivedReceipt=s.messages[1].receiptToShare,
    s=>{s.messages[0].receiptToShare=s.messages[0].receivedReceipt;delete s.messages[0].receivedReceipt;},
    s=>s.messages[1].receiptToShare=null,
    s=>s.messages[0].balance='1000000',
  ]){
    const bad=structuredClone(snapshot);alter(bad);
    await assert.rejects(sealChatArchive(vector,bad));
    await assert.rejects(openChatArchive(vector,vectorArchive('lenz/chat-archive/v2',bad)));
  }
});
test('archive tampering, wrong phrases, malformed encodings and oversized inputs are rejected without changing inputs',async()=>{
  const f=await fixture(),archive=await sealChatArchive(f.a.phrase,f.snapshot),before=JSON.stringify(f.snapshot);
  await assert.rejects(openChatArchive(vector,archive),/incorrect/);
  for(const key of ['salt','iv','ciphertext']){const bad=structuredClone(archive);bad[key]=(bad[key].startsWith('00')?'01':'00')+bad[key].slice(2);await assert.rejects(openChatArchive(f.a.phrase,bad));}
  for(const change of [v=>v.type='lenz/chat-archive/v3',v=>v.kdf='none',v=>v.extra=true,v=>v.ciphertext='abc',v=>v.ciphertext='00'.repeat(8_000_017)]){const bad=structuredClone(archive);change(bad);await assert.rejects(openChatArchive(f.a.phrase,bad));}
  assert.equal(JSON.stringify(f.snapshot),before);
});
test('legacy key substitution and financial snapshots cannot be imported as chat recovery',async()=>{
  const f=await fixture(),legacy=await createIdentity('Amina');
  await assert.rejects(sealChatArchive(f.a.phrase,{profile:legacy.profile,contacts:[],messages:[]}),/another identity/);
  for(const field of ['nearBox','tradeBox','balance','reservations','pendingOrders'])await assert.rejects(sealChatArchive(f.a.phrase,{...f.snapshot,[field]:{amount:'1000000'}}),/Only identity/);
  const payment=await sealMessage(f.a.identity,f.b.profile,{kind:'trade-payment',amount:'1000000'});
  await assert.rejects(sealChatArchive(f.a.phrase,{...f.snapshot,messages:[{packet:payment}]}),/Financial records/);
  const injected=await sealMessage(f.a.identity,f.b.profile,{kind:'chat',text:'Hello',balance:'1000000'});
  await assert.rejects(sealChatArchive(f.a.phrase,{...f.snapshot,messages:[{packet:injected}]}),/Financial records/);
});
test('archive contacts, signatures, duplicates, field limits and caller mutation are checked',async()=>{
  const f=await fixture();
  for(const alter of [s=>s.contacts.push(s.contacts[0]),s=>s.messages.push(s.messages[0]),s=>s.contacts=[],s=>s.messages[0].packet.signature='00'.repeat(64),s=>s.messages[0].balance='1',s=>s.contacts=Array(501).fill(f.b.profile),s=>s.messages=Array(1001).fill(f.snapshot.messages[0])]){const bad=structuredClone(f.snapshot);alter(bad);await assert.rejects(sealChatArchive(f.a.phrase,bad));}
  const mutable=structuredClone(f.snapshot),pending=sealChatArchive(f.a.phrase,mutable);mutable.profile.name='Changed';mutable.messages=[];
  const opened=await openChatArchive(f.a.phrase,await pending);assert.equal(opened.identity.profile.name,'Amina');assert.equal(opened.messages.length,2);
});
test('restore validates authenticated archive contents again before returning keys or history',async()=>{
  const identity=await stageIdentityRecovery(vector,'Amina');
  const root=await crypto.subtle.importKey('raw',new Uint8Array(32),'HKDF',false,['deriveKey']);
  const salt=new Uint8Array(32).fill(1),iv=new Uint8Array(12).fill(2),header={type:'lenz/chat-archive/v1',kdf:'HKDF-SHA256/entropy256',salt:Buffer.from(salt).toString('hex'),iv:Buffer.from(iv).toString('hex')};
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:new TextEncoder().encode(header.type)},root,{name:'AES-GCM',length:256},false,['encrypt']);
  for(const bad of [{profile:identity.profile,contacts:[],messages:[],balance:'1000000'},{profile:(await createIdentity('Other')).profile,contacts:[],messages:[]}]){
    const ciphertext=Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify(Object.values(header))),tagLength:128},key,new TextEncoder().encode(JSON.stringify(bad)))).toString('hex');
    await assert.rejects(openChatArchive(vector,{...header,ciphertext}));
  }
});
