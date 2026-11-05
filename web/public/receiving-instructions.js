import {assert,keysAre,validateProfile,signValue,verifyValue,hex} from './peer-crypto.js';
import {address,transferAssets} from './evm-transfer.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {TypedDataEncoder,recoverAddress} from './evm-vendor/offline-budget.js';

export const RECEIVING_DOMAIN='lenz/receiving-instruction/v1';
export const RECEIVING_TTL=15*60*1000;
const zero='0x'+'0'.repeat(40),prefix='lenz:receive:v1:';
const fields=['version','profile','chainId','address','asset','issuedAt','expiresAt','nonce','visibility'];
export function checkReceivingTerms(value,{now=Date.now()}={}){
 assert(keysAre(value,fields)&&value.version===1&&value.visibility==='public','Invalid receiving instructions.');
 assert(Object.hasOwn(WALLET_NETWORKS,value.chainId),'Receiving network is not supported.');
 assert(address(value.address)===value.address,'Invalid receiving address.');
 assert(transferAssets(value.chainId).some(a=>a.id===value.asset),'Receiving asset is not supported.');
 assert(Number.isSafeInteger(value.issuedAt)&&value.issuedAt>0&&value.issuedAt<=now&&value.expiresAt===value.issuedAt+RECEIVING_TTL&&now<value.expiresAt,'Receiving link expired or not yet valid. Ask for a new link.');
 assert(typeof value.nonce==='string'&&/^[a-f0-9]{64}$/.test(value.nonce),'Invalid receiving nonce.');
 const p=value.profile;
 assert(keysAre(p,['type','id','name','signingPublic','boxPublic'])&&typeof p.id==='string'&&/^[a-f0-9]{64}$/.test(p.id)&&typeof p.name==='string'&&!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(p.name),'Invalid recipient identity.');
 return structuredClone(value);
}
export async function receivingTerms(profile,snapshot,asset,{now=Date.now()}={}){
 const p=await validateProfile(profile);
 return checkReceivingTerms({version:1,profile:{type:p.type,id:p.id,name:p.name,signingPublic:p.signingPublic,boxPublic:p.boxPublic},chainId:snapshot.chainId,address:address(snapshot.address),asset,issuedAt:now,expiresAt:now+RECEIVING_TTL,nonce:hex(crypto.getRandomValues(new Uint8Array(32))),visibility:'public'},{now});
}
// A purpose-specific EIP-712 message, never an allowance, transaction or order.
export function receivingWalletData(value,options){
 const t=checkReceivingTerms(value,options);
 return {domain:{name:'Lenz receiving instructions',version:'1',chainId:WALLET_NETWORKS[t.chainId].id},primaryType:'ReceivingInstructions',types:{ReceivingInstructions:[{name:'purpose',type:'string'},{name:'lenzId',type:'bytes32'},{name:'recipient',type:'address'},{name:'asset',type:'address'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'},{name:'nonce',type:'bytes32'}]},message:{purpose:'Receive a public payment. No spending permission.',lenzId:'0x'+t.profile.id,recipient:t.address,asset:t.asset==='native'?zero:t.asset,issuedAt:String(t.issuedAt),expiresAt:String(t.expiresAt),nonce:'0x'+t.nonce}};
}
export function verifyReceivingWallet(terms,signature,options){
 assert(typeof signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(signature),'Invalid receiving wallet signature.');
 const d=receivingWalletData(terms,options);
 assert(address(recoverAddress(TypedDataEncoder.hash(d.domain,d.types,d.message),signature))===terms.address,'Receiving wallet ownership could not be verified.');
}
export async function signReceivingInstruction(identity,terms,walletSignature,options){
 const t=checkReceivingTerms(terms,options);await validateProfile(t.profile);
 assert(identity.profile.id===t.profile.id,'Lenz account changed.');
 verifyReceivingWallet(t,walletSignature,options);
 return {type:RECEIVING_DOMAIN,terms:t,walletSignature,signature:await signValue(identity,[RECEIVING_DOMAIN,t,walletSignature])};
}
export async function verifyReceivingInstruction(input,{recipientId,chainId,asset,now=Date.now()}={}){
 assert(keysAre(input,['type','terms','walletSignature','signature'])&&input.type===RECEIVING_DOMAIN,'Invalid receiving link.');
 const t=checkReceivingTerms(input.terms,{now});await validateProfile(t.profile);
 assert(!recipientId||t.profile.id===recipientId,'Receiving link belongs to another Lenz ID.');
 assert(!chainId||t.chainId===chainId,'Receiving network differs. A cross-chain payment route is not connected yet.');
 assert(!asset||t.asset===asset,'Choose the asset requested in the receiving link.');
 verifyReceivingWallet(t,input.walletSignature,{now});
 assert(await verifyValue(t.profile.signingPublic,[RECEIVING_DOMAIN,t,input.walletSignature],input.signature),'Receiving instructions changed or were not signed by the recipient.');
 return structuredClone(input);
}
export function encodeReceivingInstruction(instruction){
 const raw=new TextEncoder().encode(JSON.stringify(instruction));assert(raw.length<=4096,'Receiving link is too large.');
 return prefix+btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeReceivingInstruction(text){
 assert(typeof text==='string'&&text.length<=6000,'Receiving link is too large.');
 assert(text.startsWith(prefix),'Paste a Lenz receiving link.');const body=text.slice(prefix.length);
 assert(/^[A-Za-z0-9_-]+$/.test(body),'Invalid receiving link.');
 const raw=Uint8Array.from(atob(body.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-body.length%4)%4)),c=>c.charCodeAt(0));
 const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 assert(encodeReceivingInstruction(result)===text,'Invalid receiving link encoding.');return result;
}
export function receivingLink(instruction,origin){
 const url=new URL('/money.html',origin);assert(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)),'Use a secure Lenz origin.');
 url.hash='receive='+encodeReceivingInstruction(instruction);return url.href;
}
export function receivingInput(text){
 assert(typeof text==='string'&&text.length<=6500,'Receiving details are too large.');text=text.trim();
 if(text.startsWith(prefix))return decodeReceivingInstruction(text);
 if(/^https?:\/\//.test(text)){
  const url=new URL(text);assert(url.pathname==='/money.html'&&!url.search&&!url.username&&!url.password&&url.hash.startsWith('#receive='),'Unsupported payment link.');
  // Parse only; never fetch a pasted URL or send its fragment to a server.
  return decodeReceivingInstruction(url.hash.slice(9));
 }
 return null;
}
