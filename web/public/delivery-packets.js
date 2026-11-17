import { openMessage, digest } from './peer-crypto.js';
import { DELIVERY_RECEIPT } from './delivery-receipts.js';
import { isNearPayment } from './near-payment-service.js';
import { readNearVault, nearLedger, transferTerms } from './near-protocol.js';
import {CONTACT_REQUEST,contactForPacket,contactRequestStatus,isContactControl} from './contact-requests.js';

export const savedPackets = state => state.messages.flatMap(r=>[r.packet,r.receiptToShare].filter(p=>p?.from===state.identity?.profile.id));
export async function sendable(state,packet,contract){
  const contact=contactForPacket(state,packet);if(!contact)return false;
  const payload=await openMessage(state.identity,contact,packet);
  if(payload.kind===CONTACT_REQUEST&&state.contactRequests?.some(r=>r.requestId===packet.id&&r.direction==='outgoing'&&r.status!=='pending'))return false;
  if(isContactControl(payload)||payload.kind===DELIVERY_RECEIPT)return true;
  if(contactRequestStatus(state,contact.id)==='declined')return false;
  if(isNearPayment(payload)){
    if(contactRequestStatus(state,contact.id)==='pending')return false;
    if(payload.contract!==contract)return false;
    const ledger=await nearLedger(await readNearVault(state,contract));
    return !ledger.blocked.has(await digest(transferTerms(contract,payload.path.at(-1)))+':0');
  }
  return payload.kind==='chat'||payload.kind===DELIVERY_RECEIPT;
}
