// Staged identity/chat recovery only. No storage writes or financial restoration.
import {Mnemonic,p256} from './evm-vendor/identity-recovery.js';
import {CHAT_DOMAIN,assert,bytes,hex,unhex,digest,keysAre,validateProfile,openMessage} from './peer-crypto.js';
import {validateDeliveryReceipt} from './delivery-receipts.js';
import {isContactControl,contactForPacket} from './contact-requests.js';
import {validateContactRequestSnapshot,validateDeclinedContacts,validateChatBackupRecord,validateChatBackupPayload} from './contact-request-backup.js';
const DOMAIN='lenz/identity-recovery/v1',ARCHIVE='lenz/chat-archive/v2',PREVIOUS_ARCHIVE='lenz/chat-archive/v1',MAX_BYTES=8_000_000;
export const isChatArchiveType=type=>type===ARCHIVE||type===PREVIOUS_ARCHIVE;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const b64=raw=>btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function entropyOf(phrase){
  assert(typeof phrase==='string'&&phrase.length<=512,'Invalid Lenz recovery phrase.');
  const normalized=phrase.trim().toLowerCase().split(/\s+/).join(' ');
  assert(normalized.split(' ').length===24,'Enter the 24-word Lenz recovery phrase.');
  try { return unhex(Mnemonic.fromPhrase(normalized).entropy.slice(2)); }
  catch { throw Error('Invalid Lenz recovery phrase.'); }
}
async function material(entropy){return crypto.subtle.importKey('raw',entropy,'HKDF',false,['deriveBits','deriveKey']);}
async function keyPair(root,purpose,name,uses){
  for(let counter=0;counter<256;counter++){
    const raw=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:enc.encode(DOMAIN),info:enc.encode(`${purpose}/${counter}`)},root,256));
    try {
      if(!p256.utils.isValidPrivateKey(raw))continue;
      const pub=p256.getPublicKey(raw,false);
      const jwk={kty:'EC',crv:'P-256',x:b64(pub.slice(1,33)),y:b64(pub.slice(33)),d:b64(raw),ext:false,key_ops:uses};
      const privateKey=await crypto.subtle.importKey('jwk',jwk,{name,namedCurve:'P-256'},false,uses);
      return {publicKey:hex(pub),privateKey};
    } finally {raw.fill(0);}
  }
  throw Error('Could not derive identity keys.');
}
async function identityFromEntropy(entropy,name){
  assert(typeof name==='string'&&name.trim().length>0&&name.length<=48,'Choose a name of 1–48 characters.');
  const root=await material(entropy);
  const signing=await keyPair(root,'signing','ECDSA',['sign']);
  const box=await keyPair(root,'encryption','ECDH',['deriveBits']);
  const profile={type:CHAT_DOMAIN,id:await digest([CHAT_DOMAIN,signing.publicKey,box.publicKey]),name:name.trim(),signingPublic:signing.publicKey,boxPublic:box.publicKey};
  return {profile,signingPrivate:signing.privateKey,boxPrivate:box.privateKey};
}
export async function createRecoverableIdentity(name){
  const entropy=crypto.getRandomValues(new Uint8Array(32));
  try {return {identity:await identityFromEntropy(entropy,name),phrase:Mnemonic.fromEntropy(entropy).phrase};}
  finally {entropy.fill(0);}
}
// Does not install the identity. Recovered keys must not unlock payment snapshots.
export async function stageIdentityRecovery(phrase,name){
  const entropy=entropyOf(phrase);
  try {return await identityFromEntropy(entropy,name);}finally {entropy.fill(0);}
}
async function validateChatSnapshot(identity,input,withReceipts){
  const fields=['profile','contacts','messages'];for(const field of ['contactRequests','declinedContactIds'])if(withReceipts&&Object.hasOwn(input,field))fields.push(field);
  assert(keysAre(input,fields),'Only identity and chat history can be archived.');
  assert(Array.isArray(input.contacts)&&input.contacts.length<=500&&Array.isArray(input.messages)&&input.messages.length<=1000,'Archive exceeds the contact or message limit.');
  // Bound the whole serialized input before cloning/cryptographic validation.
  assert(bytes(input).length<=MAX_BYTES,'Chat archive is too large.');
  const snapshot=structuredClone(input),profile=await validateProfile(snapshot.profile);
  assert(profile.id===identity.profile.id,'Recovery phrase belongs to another identity.');
  const contacts=new Map();
  for(const value of snapshot.contacts){const p=await validateProfile(value);assert(p.id!==profile.id&&!contacts.has(p.id),'Duplicate or own contact in archive.');contacts.set(p.id,p);}
  const state={identity,contacts:snapshot.contacts,messages:snapshot.messages,contactRequests:snapshot.contactRequests??[],declinedContactIds:snapshot.declinedContactIds??[]};
  if(withReceipts)await validateContactRequestSnapshot(state);
  const ids=new Set();
  for(const record of snapshot.messages){
    assert(record?.packet&&typeof record.packet.id==='string'&&!ids.has(record.packet.id),'Invalid or duplicate archived message.');
    const packet=record.packet,peer=withReceipts?contactForPacket(state,packet):contacts.get(packet.from===profile.id?packet.to:packet.from);
    const receiptField=validateChatBackupRecord(record,profile.id,withReceipts);
    assert(peer,'Archived message has no matching contact.');
    const payload=await openMessage(identity,peer,packet);
    if(!withReceipts||!isContactControl(payload))validateChatBackupPayload(payload);
    if(Object.hasOwn(record,receiptField))await validateDeliveryReceipt(state,record,record[receiptField]);
    ids.add(packet.id);
  }
  return snapshot;
}
async function archiveKey(entropy,salt,type){return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(type)},await material(entropy),{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const header=archive=>bytes([archive.type,archive.kdf,archive.salt,archive.iv]);
export async function sealChatArchive(phrase,input){
  // Capture caller-owned values before the first asynchronous operation.
  assert(input&&bytes(input).length<=MAX_BYTES,'Chat archive is too large.');
  const snapshot=structuredClone(input),entropy=entropyOf(phrase);
  let plaintext;
  try {
    const identity=await identityFromEntropy(entropy,snapshot.profile?.name);
    plaintext=bytes(await validateChatSnapshot(identity,snapshot,true));
    const salt=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
    const archive={type:ARCHIVE,kdf:'HKDF-SHA256/entropy256',salt:hex(salt),iv:hex(iv),ciphertext:''};
    archive.ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:header(archive),tagLength:128},await archiveKey(entropy,salt,ARCHIVE),plaintext));
    return archive;
  } finally {entropy.fill(0);plaintext?.fill(0);}
}
export async function openChatArchive(phrase,input){
  assert(keysAre(input,['type','kdf','salt','iv','ciphertext'])&&isChatArchiveType(input.type)&&input.kdf==='HKDF-SHA256/entropy256','Unsupported chat archive.');
  assert(typeof input.salt==='string'&&/^[0-9a-f]{64}$/.test(input.salt)&&typeof input.iv==='string'&&/^[0-9a-f]{24}$/.test(input.iv),'Invalid archive header.');
  assert(typeof input.ciphertext==='string'&&input.ciphertext.length>=32&&input.ciphertext.length<=(MAX_BYTES+16)*2&&/^(?:[0-9a-f]{2})+$/.test(input.ciphertext),'Invalid archive size or encoding.');
  const archive=structuredClone(input),entropy=entropyOf(phrase);
  let plaintext;
  try {
    try {plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(archive.iv),additionalData:header(archive),tagLength:128},await archiveKey(entropy,unhex(archive.salt),archive.type),unhex(archive.ciphertext)));}
    catch {throw Error('The recovery phrase or archive is incorrect.');}
    const input=JSON.parse(dec.decode(plaintext));
    const identity=await identityFromEntropy(entropy,input.profile?.name);
    const snapshot=await validateChatSnapshot(identity,input,archive.type===ARCHIVE);
    identity.profile=snapshot.profile;
    return {identity,contacts:snapshot.contacts,messages:snapshot.messages,...(snapshot.contactRequests?{contactRequests:snapshot.contactRequests}:{}),...(snapshot.declinedContactIds?{declinedContactIds:validateDeclinedContacts(snapshot.declinedContactIds)}:{}),recovery:{scope:'chat-only',financialState:'not-restored'}};
  } finally {entropy.fill(0);plaintext?.fill(0);}
}
