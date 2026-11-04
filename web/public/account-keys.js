import {Mnemonic} from './evm-vendor/identity-recovery.js';
import {stageIdentityRecovery} from './identity-recovery.js';
import {assert,bytes,hex,unhex} from './peer-crypto.js';
export const ACCOUNT_REQUEST='lenz/account-request/v1';
export const PASSKEY_SALT=new TextEncoder().encode('lenz/account-passkey/v1');
export async function accountKeys(secret,name='Lenz account'){
  assert(secret instanceof ArrayBuffer&&secret.byteLength===32,'This passkey cannot unlock encrypted backup.');
  const root=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
  const derive=async label=>new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:PASSKEY_SALT,info:new TextEncoder().encode(label)},root,256));
  const own=await derive('chat-identity'),auth=await derive('backup-authorization'),encryption=await derive('backup-encryption');
  try{
    const phrase=Mnemonic.fromEntropy(own).phrase,identity=await stageIdentityRecovery(phrase,name),authority=await stageIdentityRecovery(Mnemonic.fromEntropy(auth).phrase,'Lenz backup');
    const deviceKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
    const plaintext=new TextEncoder().encode(phrase);let ciphertext;
    try{ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(authority.profile.id)},deviceKey,plaintext));}finally{plaintext.fill(0);}
    const backupKey=await crypto.subtle.importKey('raw',encryption,{name:'AES-GCM'},false,['encrypt','decrypt']);
    return {identity,phrase,authority,backupKey,deviceKey,phraseBox:{iv:hex(iv),ciphertext},accountId:authority.profile.id};
  }finally{own.fill(0);auth.fill(0);encryption.fill(0);new Uint8Array(secret).fill(0);}
}
export async function unlockLocalBackup(sync){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(sync.phraseBox.iv),additionalData:bytes(sync.accountId)},sync.deviceKey,unhex(sync.phraseBox.ciphertext));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(plain);}finally{new Uint8Array(plain).fill(0);}
}
export async function useAccountPasskey(create,name){
  assert(globalThis.isSecureContext&&navigator.credentials,'Passkeys are unavailable in this browser.');
  const extensions={prf:{eval:{first:PASSKEY_SALT}}};
  let id;
  if(create){
    const credential=await navigator.credentials.create({publicKey:{rp:{name:'Lenz',id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(32)),name:name||'Lenz account',displayName:name||'Lenz account'},challenge:crypto.getRandomValues(new Uint8Array(32)),pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},attestation:'none',extensions,timeout:60000}});
    assert(credential,'Account setup was cancelled.');id=credential.rawId;
    const flags=new Uint8Array(credential.response.getAuthenticatorData())[32];
    assert((flags&0x18)===0x18,'Choose a synced passkey so this account can open on another device.');
    const first=credential.getClientExtensionResults().prf?.results?.first;
    if(first)return accountKeys(first,name);
    assert(credential.getClientExtensionResults().prf?.enabled,'This passkey does not support encrypted backup.');
  }
  const credential=await navigator.credentials.get({publicKey:{rpId:location.hostname,challenge:crypto.getRandomValues(new Uint8Array(32)),userVerification:'required',...(id?{allowCredentials:[{type:'public-key',id}]}:{}),extensions,timeout:60000}});
  assert(credential,'Sign-in was cancelled.');
  return accountKeys(credential.getClientExtensionResults().prf?.results?.first,name);
}
