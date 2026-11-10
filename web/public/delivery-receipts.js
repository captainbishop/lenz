import { assert, digest, keysAre, openMessage, sealMessage } from './peer-crypto.js';
import { isNearPayment } from './near-payment-service.js';

export const DELIVERY_RECEIPT = 'lenz-delivery-receipt-v1';
const packetHash = packet => digest([packet.type, packet.id, packet.from, packet.to, packet.iv, packet.ciphertext, packet.signature]);
const supported = payload => payload?.kind === 'chat' || isNearPayment(payload);
function receiptTerms(payload) {
  assert(keysAre(payload, ['kind', 'messageId', 'messageHash']) && payload.kind === DELIVERY_RECEIPT &&
    typeof payload.messageId === 'string' && typeof payload.messageHash === 'string' &&
    /^[0-9a-f]{32}$/.test(payload.messageId) && /^[0-9a-f]{64}$/.test(payload.messageHash), 'Invalid delivery receipt.');
}
export async function validateDeliveryReceipt(state, record, packet) {
  const original = record.packet;
  assert(packet && typeof packet === 'object', 'Invalid delivery receipt.');
  assert(packet.from === original.to && packet.to === original.from, 'This receipt is from a different recipient.');
  const peer = state.contacts.find(c => c.id === (original.from === state.identity.profile.id ? original.to : original.from));
  assert(peer, 'Add and verify the contact first.');
  const payload = await openMessage(state.identity, peer, packet); receiptTerms(payload);
  assert(payload.messageId === original.id && payload.messageHash === await packetHash(original), 'This receipt does not match the saved file.');
  const content = await openMessage(state.identity, peer, original);
  assert(supported(content), 'Receipts are available for messages and tUSD payments.');
  return content;
}
// Call inside updateState. The UI exposes the receipt only after that commit succeeds.
export async function prepareDeliveryReceipt(state, messageId) {
  const record = state.messages.find(r => r.packet.id === messageId);
  assert(record && record.packet.to === state.identity.profile.id, 'Open the received message or payment first.');
  const peer = state.contacts.find(c => c.id === record.packet.from);
  assert(peer, 'Add and verify the sender first.');
  const payload = await openMessage(state.identity, peer, record.packet);
  assert(supported(payload), 'Receipts are available for messages and tUSD payments.');
  if (record.receiptToShare) { await validateDeliveryReceipt(state, record, record.receiptToShare); return record.receiptToShare; }
  const packet = await sealMessage(state.identity, peer, {kind: DELIVERY_RECEIPT, messageId, messageHash: await packetHash(record.packet)});
  record.receiptToShare = packet;
  return packet;
}
export async function acceptDeliveryReceipt(state, packet, {financialOnly = false, nearContract = null} = {}) {
  const peer = state.contacts.find(c => c.id === packet.from);
  assert(peer, 'Add and verify the recipient first.');
  const payload = await openMessage(state.identity, peer, packet); receiptTerms(payload);
  const record = state.messages.find(r => r.packet.id === payload.messageId);
  assert(record && record.packet.from === state.identity.profile.id, 'The original outgoing file is not saved on this device.');
  const original = await validateDeliveryReceipt(state, record, packet);
  if (financialOnly) assert(isNearPayment(original), 'Open this message receipt in Conversations.');
  if (isNearPayment(original)) assert(nearContract && original.contract === nearContract, 'This receipt belongs to another network or contract.');
  const duplicate = !!record.receivedReceipt;
  if (duplicate) await validateDeliveryReceipt(state, record, record.receivedReceipt);
  else record.receivedReceipt = packet;
  return {duplicate, contactId: peer.id, kind: DELIVERY_RECEIPT};
}
export async function deliveryAcknowledged(state, record) {
  if (!record?.receivedReceipt) return false;
  assert(record.packet.from === state.identity.profile.id, 'Only an outgoing file can have a received receipt.');
  await validateDeliveryReceipt(state, record, record.receivedReceipt);
  return true;
}
