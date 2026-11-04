import { assert, bytes, digest, hex, unhex, signValue, randomId, keysAre } from './peer-crypto.js';
import {requirePaymentAccess} from './chat-access.js';

export const FUND = 'lenz/near-fund/v1', TRANSFER = 'lenz/near-transfer/v1';
export const emptyNearVault = contract => ({ contract, roots: [], spends: [], outbox: [], receipts: {}, funding: null });
export function compressed(publicKey) {
  assert(/^04[0-9a-f]{128}$/.test(publicKey), 'Invalid profile key');
  return (parseInt(publicKey.slice(-2), 16) % 2 ? '03' : '02') + publicKey.slice(2, 66);
}
export function units(text) {
  assert(typeof text === 'string' && /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$/.test(text), 'Enter an amount with up to six decimal places.');
  const [whole, part = ''] = text.split('.'); const value = BigInt(whole) * 1000000n + BigInt(part.padEnd(6, '0'));
  assert(value > 0n, 'Enter an amount above zero.'); return value.toString();
}
export function displayUnits(value) {
  const n = BigInt(value), part = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${n / 1000000n}${part ? '.' + part : ''}`;
}
function validContract(contract) { assert(typeof contract === 'string' && /^[a-z0-9._-]{2,64}$/.test(contract) && contract.endsWith('.testnet'), 'Invalid testnet contract'); }
function validAmount(amount) { assert(typeof amount === 'string' && /^[1-9][0-9]{0,38}$/.test(amount) && BigInt(amount) < 2n ** 128n, 'Invalid amount'); }
async function publicKey(key) {
  assert(typeof key === 'string' && /^(02|03)[0-9a-f]{64}$/.test(key), 'Invalid spending key');
  return crypto.subtle.importKey('raw', unhex(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}
export const transferTerms = (contract, spend) => [TRANSFER, 'testnet', contract, spend.input, spend.recipient, spend.amount, spend.nonce];
export async function fundingRequest(identity, contract, text = '100') {
  validContract(contract); const owner = compressed(identity.profile.signingPublic), amount = units(text), nonce = randomId();
  assert(BigInt(amount) <= 100000000n, 'The test grant is at most 100 tUSD.');
  const terms = [FUND, 'testnet', contract, owner, amount, nonce];
  return { owner, amount, nonce, signature: await signValue(identity, terms), id: 'root:' + await digest(terms) };
}
export async function checkRoot(root) {
  assert(keysAre(root, ['id', 'owner', 'amount']) && /^root:[0-9a-f]{64}$/.test(root.id), 'Invalid reserve record');
  validAmount(root.amount); await publicKey(root.owner);
  // Structure only. Authentic funding is checked against the configured NEAR RPC.
}
export async function applySpend(contract, notes, consumed, spend) {
  assert(keysAre(spend, ['input', 'recipient', 'amount', 'nonce', 'signature']), 'Invalid transfer');
  validAmount(spend.amount);
  assert(typeof spend.nonce === 'string' && /^[0-9a-f]{32}$/.test(spend.nonce), 'Invalid nonce');
  assert(typeof spend.signature === 'string' && /^[0-9a-f]{128}$/.test(spend.signature), 'Invalid signature');
  await publicKey(spend.recipient);
  const terms = transferTerms(contract, spend), id = await digest(terms), input = notes.get(spend.input);
  assert(input, 'The payment is missing its earlier transfers.');
  assert(BigInt(spend.amount) <= BigInt(input.amount), 'This payment exceeds its reserve.');
  const signer = await publicKey(input.owner);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signer, unhex(spend.signature), bytes(terms)), 'Transfer signature rejected');
  assert(!consumed.has(input.id) || consumed.get(input.id) === id, 'Conflicting offline transfers were found.');
  consumed.set(input.id, id);
  const outputs = [{ id: `${id}:0`, owner: spend.recipient, amount: spend.amount }];
  if (BigInt(input.amount) > BigInt(spend.amount)) outputs.push({ id: `${id}:1`, owner: input.owner, amount: String(BigInt(input.amount) - BigInt(spend.amount)) });
  for (const output of outputs) notes.set(output.id, output);
  return { id, outputs };
}
export async function nearLedger(vault) {
  validContract(vault.contract);
  assert(vault.roots.length <= 128 && vault.spends.length <= 256, 'This test wallet has reached its storage limit.');
  const notes = new Map(), consumed = new Map();
  for (const root of vault.roots) { await checkRoot(root); assert(!notes.has(root.id), 'Duplicate reserve'); notes.set(root.id, root); }
  for (const spend of vault.spends) await applySpend(vault.contract, notes, consumed, spend);
  const blocked = new Set();
  for (const [id, chainSpend] of Object.entries(vault.chainConsumed ?? {})) {
    if (chainSpend && consumed.get(id) !== chainSpend) blocked.add(id);
  }
  for (const spend of vault.spends) {
    if (!blocked.has(spend.input)) continue;
    const id = await digest(transferTerms(vault.contract, spend)); blocked.add(`${id}:0`); blocked.add(`${id}:1`);
  }
  // An exported redemption signature has no expiry. Never release its input on a timer.
  const reserved = new Set((vault.rheaOrders ?? []).map(order => order.packet.instruction.input));
  return { notes, consumed, blocked, reserved, available: [...notes.values()].filter(note => !consumed.has(note.id) && !blocked.has(note.id) && !reserved.has(note.id)) };
}
export async function paymentPath(vault, inputId) {
  const byOutput = new Map();
  for (const spend of vault.spends) { const id = await digest(transferTerms(vault.contract, spend)); byOutput.set(`${id}:0`, spend); byOutput.set(`${id}:1`, spend); }
  const path = []; let id = inputId;
  while (byOutput.has(id)) { const parent = byOutput.get(id); path.unshift(parent); id = parent.input; assert(path.length < 16, 'Settle this payment before passing it on again.'); }
  const root = vault.roots.find(n => n.id === id); assert(root, 'Missing reserve record'); return { root, path };
}
export async function makeNearPayment(vault, identity, contact, text) {
  const next = structuredClone(vault), ledger = await nearLedger(next), owner = compressed(identity.profile.signingPublic), amount = units(text);
  const choices = ledger.available.filter(n => n.owner === owner && BigInt(n.amount) >= BigInt(amount));
  choices.sort((a, b) => BigInt(a.amount) < BigInt(b.amount) ? -1 : 1);
  assert(choices.length, 'No single available payment covers that amount.'); const input = choices[0];
  const spend = { input: input.id, recipient: compressed(contact.signingPublic), amount, nonce: randomId(), signature: '' };
  spend.signature = await signValue(identity, transferTerms(next.contract, spend));
  const { root, path } = await paymentPath(next, input.id); path.push(spend);
  await applySpend(next.contract, ledger.notes, ledger.consumed, spend); next.spends.push(spend);
  return { vault: next, payload: { kind: 'lenz-near-payment-v1', contract: next.contract, root, path } };
}
export async function acceptNearPayment(vault, identity, contact, payload) {
  requirePaymentAccess(identity);
  assert(keysAre(payload, ['kind', 'contract', 'root', 'path']) && payload.kind === 'lenz-near-payment-v1' && payload.contract === vault.contract, 'This payment belongs to another network or contract.');
  assert(Array.isArray(payload.path) && payload.path.length > 0 && payload.path.length <= 16, 'Invalid payment history');
  await checkRoot(payload.root);
  const isolatedNotes = new Map([[payload.root.id, payload.root]]), isolatedConsumed = new Map();
  let last;
  for (const spend of payload.path) last = await applySpend(vault.contract, isolatedNotes, isolatedConsumed, spend);
  assert(payload.path.at(-1).recipient === compressed(identity.profile.signingPublic), 'This payment is for another person.');
  assert(isolatedNotes.get(payload.path.at(-1).input).owner === compressed(contact.signingPublic), 'The sender does not own this payment.');
  const next = structuredClone(vault), existingRoot = next.roots.find(r => r.id === payload.root.id);
  assert(!existingRoot || JSON.stringify(existingRoot) === JSON.stringify(payload.root), 'Reserve records disagree.');
  if (!existingRoot) next.roots.push(payload.root);
  const known = new Set(await Promise.all(next.spends.map(s => digest(transferTerms(next.contract, s)))));
  const duplicate = known.has(last.id);
  for (const spend of payload.path) { const id = await digest(transferTerms(next.contract, spend)); if (!known.has(id)) { next.spends.push(spend); known.add(id); } }
  await nearLedger(next); return { vault: next, duplicate, id: last.id };
}
export async function readNearVault(state, contract) {
  if (!state.nearBox) return emptyNearVault(contract);
  requirePaymentAccess(state.identity);
  const aad = bytes(['lenz/near-vault/v1', state.identity.profile.id]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(state.nearBox.iv), additionalData: aad }, state.nearKey, unhex(state.nearBox.ciphertext));
  const vault = JSON.parse(new TextDecoder().decode(plain)); assert(vault.contract === contract, 'This wallet belongs to a different testnet contract.'); return vault;
}
export async function saveNearVault(state, vault) {
  requirePaymentAccess(state.identity);
  state.nearKey ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12)), additionalData = bytes(['lenz/near-vault/v1', state.identity.profile.id]);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, state.nearKey, bytes(vault));
  state.nearBox = { iv: hex(iv), ciphertext: hex(encrypted) };
}
