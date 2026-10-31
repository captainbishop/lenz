import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,sealMessage,openMessage} from './public/peer-crypto.js';
import {emptyNearVault,fundingRequest,readNearVault,saveNearVault,nearLedger,compressed,acceptNearPayment} from './public/near-protocol.js';
import {prepareNearPayment} from './public/near-payment-service.js';
import {receivePacket} from './public/receive-packet.js';
import {prepareRheaSwap} from './public/rhea-protocol.js';
const contract='reserve.lenz.testnet';
async function fixture(){
  const people=await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
  const [a,b,c]=people.map(identity=>({identity,contacts:people.filter(p=>p!==identity).map(p=>p.profile),messages:[]}));
  const r=await fundingRequest(a.identity,contract,'10'),v=emptyNearVault(contract);v.roots.push({id:r.id,owner:r.owner,amount:r.amount});await saveNearVault(a,v);
  return {a,b,c};
}
async function balance(s){const v=await readNearVault(s,contract),l=await nearLedger(v);return l.available.filter(n=>n.owner===compressed(s.identity.profile.signingPublic)).reduce((n,v)=>n+BigInt(v.amount),0n);}
test('wallet and chat share encrypted payments; the receiver can pass value onward without settlement',async()=>{
  const {a,b,c}=await fixture();const first=await prepareNearPayment(a,contract,b.identity.profile.id,'6');
  assert.equal(a.messages[0].packet,first);assert.deepEqual((await readNearVault(a,contract)).outbox[0].packet,first);
  await receivePacket(b,first,false,contract);const next=await prepareNearPayment(b,contract,c.identity.profile.id,'2.5');await receivePacket(c,next,true,contract);
  assert.deepEqual(await Promise.all([a,b,c].map(balance)),[4000000n,3500000n,2500000n]);
  assert.equal(b.messages.length,2);assert.equal(c.messages.length,1);
  for(const s of [a,b,c]){assert(s.nearBox.ciphertext);assert.equal(s.nearKey.extractable,false);assert(!JSON.stringify(s.messages).includes('lenz-near-payment-v1'));assert.deepEqual((await readNearVault(s,contract)).receipts,{});}
});
test('opening a payment in either screen twice cannot create a second credit or history entry',async()=>{
  const {a,b}=await fixture(),packet=await prepareNearPayment(a,contract,b.identity.profile.id,'4');
  assert.equal((await receivePacket(b,packet,true,contract)).duplicate,false);
  assert.equal((await receivePacket(b,packet,false,contract)).duplicate,true);
  assert.equal(b.messages.length,1);assert.equal(await balance(b),4000000n);
});
test('an earlier wallet receipt can gain conversation history without becoming spendable twice',async()=>{
  const {a,b,c}=await fixture(),packet=await prepareNearPayment(a,contract,b.identity.profile.id,'4');
  const payload=await openMessage(b.identity,a.identity.profile,packet),r=await acceptNearPayment(emptyNearVault(contract),b.identity,a.identity.profile,payload);await saveNearVault(b,r.vault);
  await prepareNearPayment(b,contract,c.identity.profile.id,'4');assert.equal(await balance(b),0n);
  assert.equal((await receivePacket(b,packet,false,contract)).duplicate,true);assert.equal(await balance(b),0n);assert.equal(b.messages.length,2);
});
test('wrong contract, sender, recipient or signature cannot change the receiving vault',async()=>{
  const {a,b,c}=await fixture(),packet=await prepareNearPayment(a,contract,b.identity.profile.id,'4');
  for(const [s,pin,p] of [[b,null,packet],[b,'other.testnet',packet],[c,contract,packet],[b,contract,{...packet,signature:'0'.repeat(128)}]]){
    const before=structuredClone(s);await assert.rejects(receivePacket(s,p,false,pin));assert.deepEqual(s,before);
  }
  const payload=await openMessage(b.identity,a.identity.profile,packet),forged=await sealMessage(c.identity,b.identity.profile,payload);
  await assert.rejects(receivePacket(b,forged,false,contract),/does not own/);assert.equal(await balance(b),0n);
});
test('signed swap reservations remain unavailable to both payment entry points after expiry',async()=>{
  const {a,b}=await fixture(),config={network:'testnet',adapter:'adapter.testnet',reserve:contract,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
  const r=await prepareRheaSwap(await readNearVault(a,contract),a.identity,config,{text:'10',minOutput:'1',receiver:'receiver.testnet',deadlineMs:101},100);await saveNearVault(a,r.vault);
  const before=structuredClone(a);await assert.rejects(prepareNearPayment(a,contract,b.identity.profile.id,'1'),/No single available/);assert.deepEqual(a,before);assert.equal(await balance(a),0n);
});
test('conflicting histories and re-used message identifiers fail without changing the saved payment',async()=>{
  const {a,b}=await fixture(),copy=structuredClone(a),first=await prepareNearPayment(a,contract,b.identity.profile.id,'4'),other=await prepareNearPayment(copy,contract,b.identity.profile.id,'4');
  await receivePacket(b,first,false,contract);const before=structuredClone(b);
  await assert.rejects(receivePacket(b,other,false,contract),/Conflicting/);assert.deepEqual(b,before);
  await assert.rejects(receivePacket(b,{...first,ciphertext:other.ciphertext},false,contract));assert.deepEqual(b,before);
});
test('storage limits and insufficient money expose no new packet or synthetic tUSD',async()=>{
  const {a,b}=await fixture();assert.equal(await balance(b),0n);await assert.rejects(prepareNearPayment(b,contract,a.identity.profile.id,'1'),/No single available/);assert.equal(b.nearBox,undefined);
  a.messages=Array.from({length:1000},()=>({packet:{}}));const before=structuredClone(a);await assert.rejects(prepareNearPayment(a,contract,b.identity.profile.id,'1'),/storage limit/);assert.deepEqual(a,before);
});
test('chat stays usable without the money configuration; a tUSD importer cannot accept a chat file',async()=>{
  const {a,b}=await fixture(),packet=await sealMessage(a.identity,b.identity.profile,{kind:'chat',text:'Meet me outside'});
  await assert.rejects(receivePacket(b,packet,true,contract),/tUSD payment/);assert.equal(b.messages.length,0);
  await receivePacket(b,packet);assert.equal(b.messages.length,1);assert.equal(b.nearBox,undefined);
});
