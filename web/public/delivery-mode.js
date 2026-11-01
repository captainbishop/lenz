import { readState } from './chat-store.js';

let configured = false, enabled = false;
export const automaticDelivery = () => enabled;
export function updateDeliveryMode(available, state) {
  configured = available;
  const next = !!(configured && state.identity && state.carrier?.enabled);
  if (next === enabled) return;
  enabled = next;
  dispatchEvent(new Event('lenz-delivery-mode'));
}
// Check persisted consent again: another tab may have disabled delivery.
export async function requestAutomaticDelivery(packet) {
  const state = await readState();
  if (!configured || !state.carrier?.enabled || state.carrier.excluded.includes(packet.id)) return false;
  dispatchEvent(new Event('lenz-delivery-ready'));
  return true;
}
