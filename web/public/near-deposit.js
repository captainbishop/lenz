import { assert, bytes, digest, signValue, unhex, keysAre } from './peer-crypto.js';
import { compressed, checkRoot } from './near-protocol.js';
const account=s=>typeof s==='string'&&s.length<=64&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(s);
export const depositTerms = r => ['lenz/near-deposit/v1','testnet',r.contract,r.payer,r.source,r.owner,r.amount];
export const depositId = r => digest(['lenz/near-deposit-root/v1','testnet',r.contract,r.payer,r.source]).then(id=>'root:'+id);
export const refundSource = (adapter,id) => digest(['lenz/rhea-refund-source/v1',adapter,id]);
export async function checkDepositRequest(r) {
  assert(keysAre(r,['contract','payer','source','owner','amount','signature','id']), 'Invalid deposit request');
  assert(account(r.contract)&&account(r.payer)&&r.contract!==r.payer,'Invalid deposit accounts');
  assert(typeof r.source==='string'&&/^[0-9a-f]{64}$/.test(r.source),'Invalid deposit source');
  assert(typeof r.owner==='string'&&/^(02|03)[0-9a-f]{64}$/.test(r.owner),'Invalid deposit owner');
  assert(typeof r.amount==='string'&&/^[1-9][0-9]{0,38}$/.test(r.amount)&&BigInt(r.amount)<2n**128n,'Invalid deposit amount');
  assert(typeof r.signature==='string'&&/^[0-9a-f]{128}$/.test(r.signature),'Invalid deposit signature');
  const key=await crypto.subtle.importKey('raw',unhex(r.owner),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(r.signature),bytes(depositTerms(r))),'Deposit signature rejected');
  assert(r.id===await depositId(r),'Deposit root id mismatch');return r;
}
export async function makeDepositRequest(identity,contract,payer,amount,source) {
  const r={contract,payer,amount,source,owner:compressed(identity.profile.signingPublic),signature:'',id:''};
  r.signature=await signValue(identity,depositTerms(r));r.id=await depositId(r);await checkDepositRequest(r);return r;
}
export async function prepareRefundReturn(vault,identity,entry) {
  const i=entry.packet.instruction;
  assert(entry.status?.stage==='refunded','A final refund is required before returning tUSD');
  assert(i.owner===compressed(identity.profile.signingPublic),'Only the original Lenz owner can request this refund return');
  assert(entry.packet.config.reserve===vault.contract,'Wrong reserve for refund');
  return makeDepositRequest(identity,vault.contract,i.receiver_id,i.amount,await refundSource(entry.packet.config.adapter,entry.packet.id));
}
export async function acceptDepositResult(vault,identity,request,result) {
  await checkDepositRequest(request);
  assert(request.contract===vault.contract&&request.owner===compressed(identity.profile.signingPublic),'This deposit is for another wallet');
  assert(result.finality==='FINAL'&&result.root?.id===request.id&&result.root.owner===request.owner&&result.root.amount===request.amount,'Deposit receipt does not match your request');
  assert(result.spent===null||(typeof result.spent==='string'&&/^[0-9a-f]{64}$/.test(result.spent)),'Missing deposit consumption check');
  await checkRoot(result.root);const next=structuredClone(vault),existing=next.roots.find(n=>n.id===request.id);
  assert(!existing||(existing.owner===request.owner&&existing.amount===request.amount),'Deposit conflicts with saved root');
  if(!existing)next.roots.push(result.root);
  next.chainConsumed??={};
  // Never downgrade a known consumption from a later/other response to unspent.
  if(result.spent!==null||!Object.hasOwn(next.chainConsumed,request.id))next.chainConsumed[request.id]=result.spent;
  next.receipts[request.id]={...result,root:undefined};return next;
}
