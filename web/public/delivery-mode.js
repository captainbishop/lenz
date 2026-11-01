import { readState } from './chat-store.js';

let configured = false, publicConfigured = false, enabled = false, nearbyRecipient = null;
export function setNearbyRecipient(id) { nearbyRecipient = id; dispatchEvent(new Event('lenz-delivery-mode')); }
export const deliveryMode = recipient => recipient && recipient === nearbyRecipient ? 'nearby' : enabled ? 'automatic' : 'file';
export function updateDeliveryMode(available, state, publicAvailable = false) {
  configured = available; publicConfigured = publicAvailable;
  const next = !!(state.identity && ((configured && state.carrier?.enabled) || (publicConfigured && state.nostr?.enabled)));
  if (next === enabled) return;
  enabled = next;
  dispatchEvent(new Event('lenz-delivery-mode'));
}
// Check persisted consent again: another tab may have disabled delivery.
export async function requestAutomaticDelivery(packet) {
  const state = await readState();
  const local = configured && state.carrier?.enabled && !state.carrier.excluded.includes(packet.id);
  const internet = publicConfigured && state.nostr?.enabled && !state.nostr.excluded.includes(packet.id);
  if (packet.from !== state.identity?.profile.id || (!local && !internet && packet.to !== nearbyRecipient)) return false;
  dispatchEvent(new Event('lenz-delivery-ready'));
  return true;
}
