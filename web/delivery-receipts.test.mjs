import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, sealMessage, openMessage } from './public/peer-crypto.js';
import { receivePacket } from './public/receive-packet.js';
import { prepareDeliveryReceipt, deliveryAcknowledged, DELIVERY_RECEIPT } from './public/delivery-receipts.js';
import { prepareNearPayment } from './public/near-payment-service.js';
import { emptyNearVault, fundingRequest, saveNearVault, readNearVault } from './public/near-protocol.js';
import { prepareRheaSwap } from './public/rhea-protocol.js';
const contract='receipt-fixture.lenz.testnet';
async function fixture(payment=false) {
  const identities=await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
  const [a,b,c]=identities.map(identity=>({identity,contacts:identities.filter(i=>i!==identity).map(i=>i.profile),messages:[]}));
  let packet;
  if(payment){const request=await fundingRequest(a.identity,contract,'10'),vault=emptyNearVault(contract);vault.roots.push({id:request.id,owner:request.owner,amount:request.amount});await saveNearVault(a,vault);packet=await prepareNearPayment(a,contract,b.identity.profile.id,'4');}
  else {packet=await sealMessage(a.identity,b.identity.profile,{kind:'chat',text:'Meet by the bookshop'});a.messages.push({packet});}
  await receivePacket(b,packet,false,contract);
  return {a,b,c,packet};
}
test('receipt is encrypted, signed by the recipient and bound to the exact saved file',async()=>{
  const {a,b,packet}=await fixture(),receipt=await prepareDeliveryReceipt(b,packet.id);
  assert(!JSON.stringify(receipt).includes(packet.id));assert(!JSON.stringify(receipt).includes(DELIVERY_RECEIPT));
  const reordered=Object.fromEntries(Object.entries(a.messages[0].packet).reverse());a.messages[0].packet=reordered;
  assert.equal((await receivePacket(a,receipt)).kind,DELIVERY_RECEIPT);assert(await deliveryAcknowledged(a,a.messages[0]));
  for(const s of[a,b]){assert.equal(s.messages.length,1);assert.equal(s.identity.signingPrivate.extractable,false);assert.equal(s.identity.boxPrivate.extractable,false);}
});
test('resending and reopening a receipt is idempotent and creates no receipt loop',async()=>{
  const {a,b,packet}=await fixture(),receipt=await prepareDeliveryReceipt(b,packet.id);
  assert.deepEqual(await prepareDeliveryReceipt(b,packet.id),receipt);assert.equal((await receivePacket(a,receipt)).duplicate,false);
  const before=structuredClone(a);assert.equal((await receivePacket(a,receipt)).duplicate,true);assert.deepEqual(a,before);
  await assert.rejects(prepareDeliveryReceipt(a,receipt.id),/Open the received/);assert.equal(a.messages.length,1);
});
test('changed terms, extra fields and a different recipient cannot acknowledge an outgoing file',async()=>{
  const {a,b,c,packet}=await fixture(),receipt=await prepareDeliveryReceipt(b,packet.id),payload=await openMessage(a.identity,b.identity.profile,receipt);
  for(const altered of [{...payload,messageHash:'0'.repeat(64)},{...payload,messageId:'0'.repeat(32)},{...payload,settled:true},{...payload,messageId:7}]){
    const before=structuredClone(a),forged=await sealMessage(b.identity,a.identity.profile,altered);
    await assert.rejects(receivePacket(a,forged));assert.deepEqual(a,before);
  }
  const wrongPeer=await sealMessage(c.identity,a.identity.profile,payload),before=structuredClone(a);
  await assert.rejects(receivePacket(a,wrongPeer),/different recipient/);assert.deepEqual(a,before);
  await assert.rejects(receivePacket(a,{...receipt,signature:'0'.repeat(128)}));assert.deepEqual(a,before);
});
test('replacing the original content or stored receipt cannot produce a verified badge',async()=>{
  const {a,b,packet}=await fixture(),receipt=await prepareDeliveryReceipt(b,packet.id);await receivePacket(a,receipt);
  const saved=structuredClone(a.messages[0]);a.messages[0].packet.ciphertext=(packet.ciphertext[0]==='0'?'1':'0')+packet.ciphertext.slice(1);
  assert.notEqual(a.messages[0].packet.ciphertext,saved.packet.ciphertext);
  await assert.rejects(deliveryAcknowledged(a,a.messages[0]),/does not match/);
  a.messages[0]=saved;a.messages[0].receivedReceipt.signature='0'.repeat(128);
  await assert.rejects(deliveryAcknowledged(a,a.messages[0]));
});
test('tUSD receipts preserve exact encrypted vault bytes, pending attempts and reservations',async()=>{
  const {a,b,packet}=await fixture(true),config={network:'testnet',adapter:'adapter.testnet',reserve:contract,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
  const swap=await prepareRheaSwap(await readNearVault(a,contract),a.identity,config,{text:'6',minOutput:'1',receiver:'receiver.testnet',deadlineMs:101},100);
  swap.vault.confirmations={pending:{noteId:'pending'}};await saveNearVault(a,swap.vault);
  const before=[structuredClone(a.nearBox),structuredClone(b.nearBox)],receipt=await prepareDeliveryReceipt(b,packet.id);
  assert.equal((await receivePacket(a,receipt,true,contract)).duplicate,false);
  assert.deepEqual([a.nearBox,b.nearBox],before);assert.deepEqual((await readNearVault(b,contract)).receipts,{});
  assert.equal(a.messages.length,1);assert.equal(b.messages.length,1);
});
test('receipt after onward transfer does not revive spent money or remove a conflict',async()=>{
  const {a,b,c,packet}=await fixture(true);await prepareNearPayment(b,contract,c.identity.profile.id,'4');
  const vault=await readNearVault(a,contract);vault.chainConsumed={[vault.roots[0].id]:'a'.repeat(64)};await saveNearVault(a,vault);
  const before=[structuredClone(a.nearBox),structuredClone(b.nearBox)],receipt=await prepareDeliveryReceipt(b,packet.id);
  await receivePacket(a,receipt,false,contract);assert.deepEqual([a.nearBox,b.nearBox],before);
});
test('wallet rejects chat receipts and wrong-contract receipts without mutation',async()=>{
  for(const payment of[false,true]){const {a,b,packet}=await fixture(payment),receipt=await prepareDeliveryReceipt(b,packet.id),before=structuredClone(a);
    await assert.rejects(receivePacket(a,receipt,true,payment?'other.testnet':contract));assert.deepEqual(a,before);}
});
test('only saved incoming messages or payments can generate a receipt',async()=>{
  const {a,b,packet}=await fixture();await assert.rejects(prepareDeliveryReceipt(a,packet.id),/Open the received/);
  await assert.rejects(prepareDeliveryReceipt(b,'missing'),/Open the received/);
  const unsupported=await sealMessage(a.identity,b.identity.profile,{kind:DELIVERY_RECEIPT,messageId:packet.id,messageHash:'0'.repeat(64)});
  b.messages.push({packet:unsupported});await assert.rejects(prepareDeliveryReceipt(b,unsupported.id),/messages and tUSD/);
  const receipt=await prepareDeliveryReceipt(b,packet.id);a.messages=[];await assert.rejects(receivePacket(a,receipt),/original outgoing/);
});
