import {Mnemonic} from './evm-vendor/identity-recovery.js';
import {stageIdentityRecovery} from './identity-recovery.js';
import {CHAT_DOMAIN,assert,bytes,digest,hex,unhex,keysAre,randomId,validateProfile,signValue,verifyValue,openMessage} from './peer-crypto.js';

const ARCHIVE='lenz/legacy-chat-archive/v1',LINK='lenz/chat-recovery-link/v1',MAX_BYTES=8_000_000;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const packetHeader=p=>[p.type,p.id,p.from,p.to,p.iv];
const linkTerms=l=>[l.type,l.scope,l.nonce,l.createdAt,l.from,l.to];
const archiveTerms=a=>[ARCHIVE,a.createdAt,a.profile,a.successor,a.contacts,a.messages,a.secrets,a.link];
const envelopeTerms=a=>bytes([a.type,a.kdf,a.salt,a.iv]);

async function encryptionKey(phrase,salt){
  assert(typeof phrase==='string'&&phrase.length<=512,'Invalid Lenz recovery phrase.');
  const normalized=phrase.trim().toLowerCase().split(/\s+/).join(' ');
  assert(normalized.split(' ').length===24,'Enter the 24-word Lenz recovery phrase.');
  let entropy;
  try{entropy=unhex(Mnemonic.fromPhrase(normalized).entropy.slice(2));}
  catch{throw Error('Invalid Lenz recovery phrase.');}
  try{
    const root=await crypto.subtle.importKey('raw',entropy,'HKDF',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(ARCHIVE)},root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }finally{entropy.fill(0);}
}

// The relying contact supplies the already trusted old ID. This link grants no
// payment authority and does not revoke the old key or choose between forks.
export async function validateRecoveryLink(input,expectedOldId){
  assert(keysAre(input,['type','scope','nonce','createdAt','from','to','oldSignature','newSignature']),'Invalid recovery link.');
  const link=structuredClone(input);
  assert(link.type===LINK&&link.scope==='chat-continuity'&&/^[0-9a-f]{32}$/.test(link.nonce)&&Number.isSafeInteger(link.createdAt)&&link.createdAt>=0,'Invalid recovery link terms.');
  const from=await validateProfile(link.from),to=await validateProfile(link.to);
  assert(typeof expectedOldId==='string'&&from.id===expectedOldId&&from.id!==to.id,'Recovery link does not match the trusted account.');
  assert(await verifyValue(from.signingPublic,linkTerms(link),link.oldSignature),'Old account authorization was rejected.');
  assert(await verifyValue(to.signingPublic,linkTerms(link),link.newSignature),'Recovery account authorization was rejected.');
  return link;
}

async function snapshot(input){
  assert(keysAre(input,['profile','contacts','messages']),'Only profile, contacts and chat messages can be archived.');
  assert(Array.isArray(input.contacts)&&input.contacts.length<=500&&Array.isArray(input.messages)&&input.messages.length<=1000,'Archive exceeds the contact or message limit.');
  assert(bytes(input).length<=MAX_BYTES,'Chat archive is too large.');
  // Both callers supply a private snapshot captured before any await.
  const value=input,profile=await validateProfile(value.profile),peers=new Map();
  for(const item of value.contacts){const p=await validateProfile(item);assert(p.id!==profile.id&&!peers.has(p.id),'Duplicate or own contact in archive.');peers.set(p.id,p);}
  const ids=new Set();
  for(const record of value.messages){assert(keysAre(record,['packet'])&&record.packet&&typeof record.packet.id==='string'&&!ids.has(record.packet.id),'Invalid or duplicate archived message.');ids.add(record.packet.id);}
  return {value,profile,peers};
}
function chatPayload(payload){
  assert(keysAre(payload,['kind','text'])&&payload.kind==='chat'&&typeof payload.text==='string'&&payload.text.trim().length>0&&bytes(payload.text).length<=16002,'Financial records cannot be restored as chat.');
  return payload;
}
async function oldSharedSecret(identity,peer){
  const publicKey=await crypto.subtle.importKey('raw',unhex(peer.boxPublic),{name:'ECDH',namedCurve:'P-256'},false,[]);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},identity.boxPrivate,256));
}
async function historicalKey(identity,peer,packet){
  const shared=await oldSharedSecret(identity,peer);
  try{
    const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:unhex(packet.id),info:bytes(packetHeader(packet))},material,256));
  }finally{shared.fill(0);}
}
async function historicalMessage(profile,peer,secret,input){
  assert(keysAre(input,['type','id','from','to','iv','ciphertext','signature'])&&input.type===CHAT_DOMAIN,'Invalid archived message format.');
  const p=input;
  assert(typeof p.id==='string'&&/^[0-9a-f]{32}$/.test(p.id)&&typeof p.iv==='string'&&/^[0-9a-f]{24}$/.test(p.iv),'Invalid archived message header.');
  const incoming=p.from===peer.id&&p.to===profile.id,outgoing=p.from===profile.id&&p.to===peer.id;
  assert(incoming||outgoing,'Archived message belongs to another conversation.');
  assert(typeof p.ciphertext==='string'&&p.ciphertext.length>=32&&p.ciphertext.length<=200032,'Invalid archived message size.');
  assert(await verifyValue(incoming?peer.signingPublic:profile.signingPublic,[...packetHeader(p),p.ciphertext],p.signature),'Archived message signature was rejected.');
  const raw=unhex(secret);let plaintext;
  try{
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(p.iv),additionalData:bytes(packetHeader(p)),tagLength:128},key,unhex(p.ciphertext)));
    return chatPayload(JSON.parse(dec.decode(plaintext)));
  }finally{raw.fill(0);plaintext?.fill(0);}
}

export async function sealLegacyChatArchive(activeIdentity,phrase,input){
  // Freeze inputs before awaiting keys or signatures; never replace the active account.
  assert(input&&bytes(input).length<=MAX_BYTES,'Chat archive is too large.');
  const captured=structuredClone(input),identity=structuredClone(activeIdentity);
  const {value,profile,peers}=await snapshot(captured);
  assert(profile.id===identity.profile.id&&profile.signingPublic===identity.profile.signingPublic&&profile.boxPublic===identity.profile.boxPublic,'Archive belongs to another account.');
  const successor=await stageIdentityRecovery(phrase,profile.name);
  assert(successor.profile.id!==profile.id,'Use the existing phrase archive for this account.');
  const ownShared=await oldSharedSecret(identity,successor.profile),peerShared=await oldSharedSecret(successor,profile);
  try{assert(hex(ownShared)===hex(peerShared),'Encryption key does not match this account.');}finally{ownShared.fill(0);peerShared.fill(0);}
  for(const field of ['avatar','photo'])if(Object.hasOwn(profile,field))successor.profile[field]=profile[field];
  const secrets=[];
  for(const {packet} of value.messages){
    const peer=peers.get(packet.from===profile.id?packet.to:packet.from);assert(peer,'Archived message has no matching contact.');
    chatPayload(await openMessage(identity,peer,packet));
    const raw=await historicalKey(identity,peer,packet);
    try{secrets.push({message:packet.id,key:hex(raw)});}finally{raw.fill(0);}
  }
  const createdAt=Date.now(),link={type:LINK,scope:'chat-continuity',nonce:randomId(),createdAt,from:profile,to:successor.profile,oldSignature:'',newSignature:''};
  link.oldSignature=await signValue(identity,linkTerms(link));link.newSignature=await signValue(successor,linkTerms(link));
  await validateRecoveryLink(link,profile.id);
  const content={createdAt,profile,successor:successor.profile,contacts:value.contacts,messages:value.messages,secrets,link,signature:''};
  content.signature=await signValue(identity,await digest(archiveTerms(content)));
  const plaintext=bytes(content);assert(plaintext.length<=MAX_BYTES,'Chat archive is too large.');
  const salt=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),archive={type:ARCHIVE,kdf:'HKDF-SHA256/entropy256',salt:hex(salt),iv:hex(iv),ciphertext:''};
  try{archive.ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:envelopeTerms(archive),tagLength:128},await encryptionKey(phrase,salt),plaintext));return archive;}
  finally{plaintext.fill(0);}
}

export async function openLegacyChatArchive(phrase,input){
  assert(keysAre(input,['type','kdf','salt','iv','ciphertext'])&&input.type===ARCHIVE&&input.kdf==='HKDF-SHA256/entropy256','Unsupported legacy chat archive.');
  assert(typeof input.salt==='string'&&/^[0-9a-f]{64}$/.test(input.salt)&&typeof input.iv==='string'&&/^[0-9a-f]{24}$/.test(input.iv),'Invalid archive header.');
  assert(typeof input.ciphertext==='string'&&input.ciphertext.length>=32&&input.ciphertext.length<=(MAX_BYTES+16)*2&&/^(?:[0-9a-f]{2})+$/.test(input.ciphertext),'Invalid archive size or encoding.');
  const archive=structuredClone(input);let plaintext;
  try{
    try{plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(archive.iv),additionalData:envelopeTerms(archive),tagLength:128},await encryptionKey(phrase,unhex(archive.salt)),unhex(archive.ciphertext)));}
    catch{throw Error('The recovery phrase or archive is incorrect.');}
    const content=JSON.parse(dec.decode(plaintext));
    assert(keysAre(content,['createdAt','profile','successor','contacts','messages','secrets','link','signature']),'Invalid legacy archive content.');
    assert(Number.isSafeInteger(content.createdAt)&&content.createdAt>=0,'Invalid archive time.');
    const {profile,peers}=await snapshot({profile:content.profile,contacts:content.contacts,messages:content.messages});
    const link=await validateRecoveryLink(content.link,profile.id);
    assert(same(link.from,profile)&&same(link.to,content.successor)&&link.createdAt===content.createdAt,'Archive and recovery link differ.');
    const identity=await stageIdentityRecovery(phrase,content.successor.name);
    assert(identity.profile.id===content.successor.id,'Recovery phrase belongs to another account.');identity.profile=content.successor;
    assert(await verifyValue(profile.signingPublic,await digest(archiveTerms(content)),content.signature),'Archive authorization was rejected.');
    assert(Array.isArray(content.secrets)&&content.secrets.length===content.messages.length,'Invalid archived message keys.');
    const secrets=new Map(),messageIds=new Set(content.messages.map(r=>r.packet.id));
    for(const item of content.secrets){assert(keysAre(item,['message','key'])&&messageIds.has(item.message)&&!secrets.has(item.message)&&typeof item.key==='string'&&/^[0-9a-f]{64}$/.test(item.key),'Invalid archived message key.');secrets.set(item.message,item.key);}
    const history=[];
    for(const {packet} of content.messages){const peer=peers.get(packet.from===profile.id?packet.to:packet.from);assert(peer,'Archived message has no matching contact.');history.push({packet,payload:await historicalMessage(profile,peer,secrets.get(packet.id),packet)});}
    return {identity,sourceProfile:profile,contacts:content.contacts,history,link,recovery:{scope:'legacy-chat',financialState:'not-restored'}};
  }finally{plaintext?.fill(0);}
}
