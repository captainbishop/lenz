import { openMessage, bytes } from './peer-crypto.js';
import { isTrade } from './trade-model.js';
import { openTradeCard } from './trade-service.js';
import { isNearPayment } from './near-payment-service.js';
import { acceptNearPayment, readNearVault, saveNearVault } from './near-protocol.js';
import { DELIVERY_RECEIPT, acceptDeliveryReceipt } from './delivery-receipts.js';
// Caller commits this together with the updated balance inside updateState.
export async function receivePacket(state, packet, financialOnly = false, nearContract = null) {
  if (!state.identity) throw new Error('Create your identity first.');
  if (packet.to !== state.identity.profile.id) throw new Error('This message is addressed to someone else.');
  const contact = state.contacts.find(p => p.id === packet.from);
  if (!contact) throw new Error('Add and verify the sender’s contact card first.');
  const payload = await openMessage(state.identity, contact, packet);
  if (payload?.kind === DELIVERY_RECEIPT) return acceptDeliveryReceipt(state, packet, {financialOnly, nearContract});
  if (financialOnly && nearContract && !isNearPayment(payload)) throw new Error('Choose an encrypted tUSD payment file.');
  if (financialOnly && !isTrade(payload) && !isNearPayment(payload)) throw new Error('This file is a chat message. Open it in Conversations.');
  if (!isTrade(payload) && !isNearPayment(payload) && (!payload || payload.kind !== 'chat' || typeof payload.text !== 'string' || !payload.text.trim() || bytes(payload.text).length > 16002)) throw new Error('This is not a supported chat message.');
  if (isNearPayment(payload) && (!nearContract || payload.contract !== nearContract)) throw new Error('This payment belongs to another network or contract. Open it in the matching wallet.');
  const previous = state.messages.find(item => item.packet.id === packet.id);
  if (previous && Object.keys(previous.packet).some(key => previous.packet[key] !== packet[key])) throw new Error('This message ID was reused with different content.');
  let duplicate = !!previous;
  if (!previous) {
    if (state.messages.length >= 1000) throw new Error('This prototype has reached its 1,000-message storage limit.');
    if (isTrade(payload)) await openTradeCard(state, contact, payload);
    if (isNearPayment(payload)) {
      const result = await acceptNearPayment(await readNearVault(state, nearContract), state.identity, contact, payload);
      await saveNearVault(state, result.vault); duplicate = result.duplicate;
    }
    state.messages.push({ packet });
  }
  return { duplicate, contactId: contact.id, kind: payload.kind };
}
