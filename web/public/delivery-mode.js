import { readState, updateState } from './chat-store.js';

let configured = false, publicConfigured = false, enabled = false, publicEnabled = false, nearbyRecipient = null, connection = 'connecting';
let bluetooth = {supported:false,state:'off',peers:0};
export function setNearbyRecipient(id) { nearbyRecipient = id; dispatchEvent(new Event('lenz-delivery-mode')); }
export const deliveryMode = recipient => recipient && recipient === nearbyRecipient ? 'nearby' : bluetooth.supported&&bluetooth.state==='ready' ? 'bluetooth' : enabled ? 'automatic' : 'queued';
export const bluetoothConnection = () => ({...bluetooth});
export function updateBluetoothConnection(next) {
  if(bluetooth.supported===!!next.supported&&bluetooth.state===next.state&&bluetooth.peers===next.peers)return;
  bluetooth={supported:!!next.supported,state:next.state,peers:next.peers??0};dispatchEvent(new Event('lenz-delivery-mode'));
}
export const requestedDeliveryPackets = state => state.messages.flatMap(record=>[
  record.deliveryRequested&&record.packet.from===state.identity?.profile.id?record.packet:null,
  record.receiptDeliveryRequested&&record.receiptToShare?.from===state.identity?.profile.id?record.receiptToShare:null,
].filter(Boolean));
export const internetConnection = () => publicEnabled ? connection : 'off';
export function updateInternetConnection(next) {
  if (next === connection) return;
  connection = next; dispatchEvent(new Event('lenz-delivery-mode'));
}
export function refreshDeliveryMode(state) { updateDeliveryMode(configured, state, publicConfigured); }
export async function prepareChatDelivery(owner) {
  let state = await readState();
  if (state.identity?.profile.id !== owner) throw Error('Your account changed. Reload before sending.');
  if (publicConfigured && !state.nostr) {
    await (await import('./nostr-client.js')).setNostrEnabled(true, {owner});
    state = await readState();
  }
  refreshDeliveryMode(state);
}
// Renew only deliveries explicitly requested by this account, retaining the signed originals.
export async function requeueRequestedDeliveries() {
  const state=await readState(),requested=new Set(requestedDeliveryPackets(state).map(packet=>packet.id)),now=Date.now();
  const pending=id=>requested.has(id)&&!state.messages.some(record=>record.packet.id===id&&record.receivedReceipt);
  if(!state.identity||!state.nostr?.enabled&&!state.carrier?.enabled)return;
  if(!state.nostr?.outbox?.some(entry=>entry.expiresAt<=now&&pending(entry.packetId))&&!state.carrier?.outbox?.some(entry=>entry.envelope.expiresAt<=now&&pending(entry.envelope.packet.id)))return;
  const owner=state.identity.profile.id;
  await updateState(current=>{
    if(current.identity?.profile.id!==owner)return;
    const ids=new Set(requestedDeliveryPackets(current).filter(packet=>!current.messages.some(record=>record.packet.id===packet.id&&record.receivedReceipt)).map(packet=>packet.id));
    if(current.nostr?.enabled)current.nostr.outbox=current.nostr.outbox.filter(entry=>entry.expiresAt>now||!ids.has(entry.packetId));
    if(current.carrier?.enabled)current.carrier.outbox=current.carrier.outbox.filter(entry=>entry.envelope.expiresAt>now||!ids.has(entry.envelope.packet.id));
  },{markBackup:false});
}
export function updateDeliveryMode(available, state, publicAvailable = false) {
  configured = available; publicConfigured = publicAvailable;
  publicEnabled = !!(state.identity && publicConfigured && state.nostr?.enabled);
  const next = !!(state.identity && ((configured && state.carrier?.enabled) || (publicConfigured && state.nostr?.enabled)));
  if (next === enabled) return;
  enabled = next;
  dispatchEvent(new Event('lenz-delivery-mode'));
}
// Check persisted consent again: another tab may have disabled delivery.
export async function requestAutomaticDelivery(packet) {
  const accepted=await updateState(state=>{
    if(packet.from!==state.identity?.profile.id)return false;
    const message=state.messages.find(record=>record.packet.id===packet.id&&record.packet.signature===packet.signature);
    const receipt=state.messages.find(record=>record.receiptToShare?.id===packet.id&&record.receiptToShare.signature===packet.signature);
    if(!message&&!receipt)return false;
    if(message)message.deliveryRequested=true;
    if(receipt)receipt.receiptDeliveryRequested=true;
    if(state.nostr?.enabled)state.nostr.excluded=state.nostr.excluded.filter(id=>id!==packet.id);
    if(state.carrier?.enabled)state.carrier.excluded=state.carrier.excluded.filter(id=>id!==packet.id);
    return true;
  },{markBackup:false});
  if(!accepted)return false;
  dispatchEvent(new Event('lenz-delivery-ready'));
  return true;
}
