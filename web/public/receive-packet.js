import { openMessage, bytes } from './peer-crypto.js';
import { isTrade } from './trade-model.js';
import { isNearPayment } from './near-payment-service.js';
import { acceptNearPayment, readNearVault, saveNearVault } from './near-protocol.js';
import { DELIVERY_RECEIPT, acceptDeliveryReceipt, prepareDeliveryReceipt } from './delivery-receipts.js';
import {contactForPacket,contactRequestStatus,isContactControl,requestSender,receiveContactControl} from './contact-requests.js';
// Caller commits this together with the updated balance inside updateState.
export async function receivePacket(state, packet, financialOnly = false, nearContract = null, sender = null) {
  if (!state.identity) throw new Error('Create your identity first.');
  if (packet.to !== state.identity.profile.id) throw new Error('This message is addressed to someone else.');
  const known=contactForPacket(state,packet);
  const contact = known??await requestSender(packet,sender);
  const payload = await openMessage(state.identity, contact, packet);
  if (payload?.kind === DELIVERY_RECEIPT) return acceptDeliveryReceipt(state, packet, {financialOnly, nearContract});
  if(isContactControl(payload)){
    if(financialOnly)throw Error('Open this message request in Conversations.');
    return receiveContactControl(state,packet,payload,contact);
  }
  if(!known)throw Error('This person must send a message request first.');
  const requestStatus=contactRequestStatus(state,contact.id);
  if(requestStatus==='declined')return {duplicate:false,contactId:contact.id,kind:payload?.kind,ignored:true};
  if(requestStatus==='pending'&&isNearPayment(payload))throw Error('Accept this message request before receiving payments.');
  if (isTrade(payload)) throw new Error('This demo payment format is no longer supported. Use a tUSD payment.');
  if (financialOnly && nearContract && !isNearPayment(payload)) throw new Error('Choose an encrypted tUSD payment file.');
  if (financialOnly && !isTrade(payload) && !isNearPayment(payload)) throw new Error('This file is a chat message. Open it in Conversations.');
  if (!isTrade(payload) && !isNearPayment(payload) && (!payload || payload.kind !== 'chat' || typeof payload.text !== 'string' || !payload.text.trim() || bytes(payload.text).length > 16002)) throw new Error('This is not a supported chat message.');
  if (isNearPayment(payload) && (!nearContract || payload.contract !== nearContract)) throw new Error('This payment belongs to another network or contract. Open it in the matching wallet.');
  const previous = state.messages.find(item => item.packet.id === packet.id);
  if (previous && Object.keys(previous.packet).some(key => previous.packet[key] !== packet[key])) throw new Error('This message ID was reused with different content.');
  let duplicate = !!previous;
  if (!previous) {
    const pending=(state.contactRequests??[]).filter(r=>r.direction==='incoming'&&r.status==='pending');
    if(pending.some(r=>r.peerId===contact.id)){
      const peers=new Set(pending.map(r=>r.peerId)),requests=new Set(pending.map(r=>r.requestId));
      const messages=state.messages.filter(r=>peers.has(r.packet.from)&&!requests.has(r.packet.id));
      if(messages.length>=96||messages.filter(r=>r.packet.from===contact.id).length>=8)throw Error('This message request has reached the pending message limit. Accept it before receiving more messages.');
    }
    if (state.messages.length >= 1000) throw new Error('This prototype has reached its 1,000-message storage limit.');
    if (isNearPayment(payload)) {
      const result = await acceptNearPayment(await readNearVault(state, nearContract), state.identity, contact, payload);
      await saveNearVault(state, result.vault); duplicate = result.duplicate;
    }
    state.messages.push({ packet });
  }
  return { duplicate, contactId: contact.id, kind: payload.kind };
}
// Call inside updateState so incoming history and its signed receipt commit together.
export async function receiveDeliveredPacket(state, packet, {contract = null, sender = null} = {}) {
  const result = await receivePacket(state, packet, false, contract, sender);
  const receipt = result.kind === DELIVERY_RECEIPT || result.ignored ? null : await prepareDeliveryReceipt(state, packet.id);
  return {result, receipt};
}
