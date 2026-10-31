import { assert, bytes, hex, unhex, sealMessage, openMessage } from './peer-crypto.js';
import { createTradeVault, createTrade, receiveTrade, acceptTrade, TRADE_CONTEXT } from './trade-model.js';

const aad = state => bytes([TRADE_CONTEXT.network, state.identity.profile.id]);
export async function readTradeVault(state) {
  if (!state.tradeBox) return null;
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(state.tradeBox.iv), additionalData: aad(state) }, state.tradeKey, unhex(state.tradeBox.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function saveTradeVault(state, vault) {
  state.tradeKey ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(state) }, state.tradeKey, bytes(vault));
  state.tradeBox = { iv: hex(iv), ciphertext: hex(ciphertext) };
}
export async function enableDemoMoney(state) {
  assert(state.identity, 'Choose your name first.');
  if (!state.tradeBox) await saveTradeVault(state, await createTradeVault(state.identity.profile.signingPublic));
}
async function requireVault(state) {
  const vault = await readTradeVault(state);
  assert(vault, 'Choose “Try demo money” before opening a financial card.');
  return vault;
}
async function commitOutgoing(state, contact, result) {
  assert(state.messages.length < 1000, 'This prototype has reached its 1,000-message storage limit.');
  const packet = await sealMessage(state.identity, contact, result.payload);
  await saveTradeVault(state, result.vault);
  state.messages.push({ packet });
  return packet;
}
// Call these only inside updateState. That caller commits the complete encrypted
// vault (including reservations) and outbox message before returning the packet.
export async function prepareTrade(state, contactId, fields) {
  const contact = state.contacts.find(p => p.id === contactId);
  assert(contact, 'Choose a contact first.');
  return commitOutgoing(state, contact, await createTrade(await requireVault(state), state.identity, contact, fields));
}
export async function agreeToTrade(state, packetId) {
  const record = state.messages.find(r => r.packet.id === packetId);
  assert(record && record.packet.to === state.identity.profile.id, 'Choose an incoming offer.');
  const contact = state.contacts.find(p => p.id === record.packet.from);
  assert(contact, 'Add the sender to your contacts first.');
  const payload = await openMessage(state.identity, contact, record.packet);
  return commitOutgoing(state, contact, await acceptTrade(await requireVault(state), state.identity, contact, payload));
}
export async function openTradeCard(state, contact, payload) {
  const vault = await receiveTrade(await requireVault(state), payload, contact.signingPublic, state.identity.profile.signingPublic);
  await saveTradeVault(state, vault);
}
