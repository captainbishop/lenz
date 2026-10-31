import { assert, digest, keysAre, isPublicKey } from './peer-crypto.js';
import { ExchangeLedger, makeAgreement, verifyAgreement, swapOutputs } from './peer-exchange.js';
import { stageReservation } from './exchange-reservations.js';

export const TRADE_CONTEXT = { network: 'research-chat-demo-v1', pool: 'synthetic-only' };
export const ASSETS = { 'DEMO-USD': 'demo dollars', 'DEMO-COIN': 'demo coins' };
export const isTrade = payload => ['trade-offer', 'trade-agreed', 'trade-payment'].includes(payload?.kind);
const now = () => Math.floor(Date.now() / 1000);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function demoRoots(owner) {
  assert(isPublicKey(owner), 'Invalid demo owner');
  return Promise.all(Object.keys(ASSETS).map(async asset => ({
    id: 'root:demo-' + await digest([TRADE_CONTEXT.network, TRADE_CONTEXT.pool, owner, asset]),
    owner, asset, value: asset === 'DEMO-USD' ? '100' : '50',
  })));
}
export async function createTradeVault(owner) {
  return { roots: await demoRoots(owner), agreements: [], journal: [] };
}
export async function tradeLedger(vault) {
  const ledger = new ExchangeLedger(vault.roots, TRADE_CONTEXT);
  for (let i = 0; i < vault.agreements.length; i += 32) await ledger.apply(vault.agreements.slice(i, i + 32), 0);
  return ledger;
}
function conflict(vault, agreement) {
  return vault.journal.some(row => row.agreement.id !== agreement.id && row.inputs.some(id => agreement.body.inputs.includes(id)));
}
async function apply(vault, ledger, agreement) {
  assert(!conflict(vault, agreement), 'This value is held for a different agreement.');
  await ledger.apply([agreement], now());
  if (!vault.agreements.some(item => item.id === agreement.id)) {
    assert(vault.agreements.length < 256, 'This demo workspace is full.');
    vault.agreements.push(agreement);
  }
}
export async function availableNotes(vault, owner) {
  const notes = (await tradeLedger(vault)).unspent().filter(note => note.owner === owner);
  return { available: notes.filter(note => !vault.journal.some(row => row.inputs.includes(note.id))),
    held: notes.filter(note => vault.journal.some(row => row.inputs.includes(note.id))) };
}
function amount(text) {
  assert(typeof text === 'string' && /^[1-9][0-9]{0,18}$/.test(text), 'Enter a positive whole number of demo units.');
  return BigInt(text);
}
function choose(notes, owner, asset, value) {
  assert(Object.hasOwn(ASSETS, asset), 'Choose a supported demo asset.');
  const q = amount(value);
  const choices = notes.filter(n => n.owner === owner && n.asset === asset && BigInt(n.value) >= q);
  choices.sort((a, b) => BigInt(a.value) < BigInt(b.value) ? -1 : 1);
  assert(choices.length, 'That amount is unavailable. Try a smaller amount or finish an open offer.');
  return choices[0];
}
export function packageTrade(vault, agreement, kind) {
  const parents = [], roots = [], visited = new Set();
  function visit(input) {
    if (visited.has(input)) return;
    visited.add(input);
    const root = vault.roots.find(r => r.id === input);
    if (root) { if (!roots.some(r => r.id === input)) roots.push(root); return; }
    const parent = vault.agreements.find(a => a.body.outputs.some((_, i) => `${a.id}:${i}` === input));
    assert(parent, 'Missing payment history.');
    parent.body.inputs.forEach(visit);
    if (!parents.some(p => p.id === parent.id)) parents.push(parent);
  }
  agreement.body.inputs.forEach(visit);
  assert(parents.length < 32, 'This payment history exceeds the current demo limit.');
  return structuredClone({ kind, roots, parents, agreement });
}
// All labels and amounts in a card are derived from the signed transition.
export function terms(agreement, notes) {
  const inputs = agreement.body.inputs.map(id => notes.get(id));
  assert(inputs.every(Boolean), 'Missing payment history.');
  if (agreement.body.kind === 'swap') {
    const [a, b] = inputs;
    const give = agreement.body.outputs.find(o => o.owner === b.owner && o.asset === a.asset)?.value;
    const get = agreement.body.outputs.find(o => o.owner === a.owner && o.asset === b.asset)?.value;
    assert(give && get && equal(agreement.body.outputs, swapOutputs(a, b, give, get)), 'This offer contains unsupported terms.');
    return { from: a.owner, to: b.owner, give, giveAsset: a.asset, get, getAsset: b.asset };
  }
  const [input] = inputs, [paid, change] = agreement.body.outputs;
  assert(paid && paid.owner !== input.owner && paid.asset === input.asset
    && agreement.body.outputs.length <= 2 && (!change || (change.owner === input.owner && change.asset === input.asset)), 'This payment contains unsupported terms.');
  return { from: input.owner, to: paid.owner, give: paid.value, giveAsset: input.asset };
}
export async function inspectTrade(vault, payload, sender, recipient) {
  assert(isTrade(payload) && keysAre(payload, ['kind', 'roots', 'parents', 'agreement']), 'Unsupported trade card.');
  assert(Array.isArray(payload.roots) && payload.roots.length > 0 && payload.roots.length <= 64
    && new Set(payload.roots.map(r => r.id)).size === payload.roots.length, 'Invalid demo backing.');
  assert(Array.isArray(payload.parents) && payload.parents.length < 32
    && new Set(payload.parents.map(p => p.id)).size === payload.parents.length, 'Invalid payment history.');
  const staged = structuredClone(vault);
  for (const root of payload.roots) {
    const expected = (await demoRoots(root.owner)).find(r => r.asset === root.asset);
    assert(keysAre(root, ['id', 'owner', 'asset', 'value']) && expected
      && Object.keys(expected).every(key => expected[key] === root[key]), 'Unrecognized demo backing.');
    if (!staged.roots.some(r => r.id === root.id)) staged.roots.push(root);
  }
  const ledger = await tradeLedger(staged);
  for (const parent of payload.parents) {
    assert(parent.body?.deadline === 0, 'This demo does not support timed agreements.');
    await apply(staged, ledger, parent);
  }
  const notes = new Map(ledger.snapshot().notes.map(note => [note.id, note]));
  const agreement = await verifyAgreement(payload.agreement, notes, payload.kind !== 'trade-offer');
  assert(agreement.body.network === TRADE_CONTEXT.network && agreement.body.pool === TRADE_CONTEXT.pool
    && agreement.body.deadline === 0, 'Wrong demo or unsupported deadline.');
  const details = terms(agreement, notes);
  const reverse = payload.kind === 'trade-agreed';
  assert(details.from === (reverse ? recipient : sender) && details.to === (reverse ? sender : recipient), 'This card belongs to a different conversation.');
  assert((agreement.body.kind === 'transfer') === (payload.kind === 'trade-payment'), 'Wrong financial action.');
  if (payload.kind === 'trade-offer') assert(agreement.signatures.length === 1 && agreement.signatures[0].owner === sender, 'The offer needs its sender’s signature.');
  // Reject unrelated roots/ancestors instead of letting a card import arbitrary history.
  const required = packageTrade({ ...staged, agreements: [...staged.agreements, ...payload.parents] }, agreement, payload.kind);
  assert(equal(required.roots.map(r => r.id).sort(), payload.roots.map(r => r.id).sort())
    && equal(required.parents.map(p => p.id).sort(), payload.parents.map(p => p.id).sort()), 'The card includes unrelated payment history.');
  return { staged, ledger, notes, agreement, details };
}
export async function createTrade(vault, identity, contact, fields) {
  const staged = structuredClone(vault), owner = identity.profile.signingPublic;
  const own = await availableNotes(staged, owner);
  const input = choose(own.available, owner, fields.giveAsset, fields.give);
  let agreement;
  if (fields.mode === 'swap') {
    assert(fields.giveAsset !== fields.getAsset, 'Choose two different assets for a swap.');
    for (const root of await demoRoots(contact.signingPublic)) if (!staged.roots.some(r => r.id === root.id)) staged.roots.push(root);
    const peer = choose((await tradeLedger(staged)).unspent(), contact.signingPublic, fields.getAsset, fields.get);
    agreement = await makeAgreement({ ...TRADE_CONTEXT, kind: 'swap', inputs: [input.id, peer.id], outputs: swapOutputs(input, peer, fields.give, fields.get) });
  } else {
    assert(fields.mode === 'payment', 'Choose a financial action.');
    agreement = await makeAgreement({ ...TRADE_CONTEXT, kind: 'transfer', inputs: [input.id], outputs: [
      { owner: contact.signingPublic, asset: input.asset, value: fields.give },
      ...(BigInt(input.value) > BigInt(fields.give) ? [{ owner, asset: input.asset, value: String(BigInt(input.value) - BigInt(fields.give)) }] : []),
    ] });
  }
  const ledger = await tradeLedger(staged), notes = new Map(ledger.snapshot().notes.map(n => [n.id, n]));
  agreement = await stageReservation(identity, agreement, notes, { ...TRADE_CONTEXT, now: now() }, staged.journal);
  const payload = packageTrade(staged, agreement, fields.mode === 'swap' ? 'trade-offer' : 'trade-payment');
  if (fields.mode === 'payment') await apply(staged, ledger, agreement);
  return { vault: staged, payload };
}
export async function receiveTrade(vault, payload, sender, recipient) {
  const checked = await inspectTrade(vault, payload, sender, recipient);
  if (payload.kind === 'trade-agreed') {
    const prior = vault.journal.find(row => row.agreement.id === checked.agreement.id);
    assert(prior, 'No matching offer was saved on this device.');
    assert(checked.agreement.signatures.some(s => s.owner === recipient && s.signature === prior.agreement.signatures.find(p => p.owner === recipient)?.signature), 'This reply does not match your saved authorization.');
  }
  if (payload.kind !== 'trade-offer') await apply(checked.staged, checked.ledger, checked.agreement);
  return checked.staged;
}
export async function acceptTrade(vault, identity, contact, payload) {
  assert(payload.kind === 'trade-offer', 'Choose an incoming offer.');
  const owner = identity.profile.signingPublic;
  const checked = await inspectTrade(vault, payload, contact.signingPublic, owner);
  assert(!checked.staged.agreements.some(a => a.id === checked.agreement.id), 'This trade is already agreed.');
  const unspent = checked.ledger.unspent();
  assert(checked.agreement.body.inputs.every(id => unspent.some(n => n.id === id)), 'This offer uses value that has already moved.');
  const signed = await stageReservation(identity, checked.agreement, checked.notes, { ...TRADE_CONTEXT, now: now() }, checked.staged.journal);
  await apply(checked.staged, checked.ledger, signed);
  return { vault: checked.staged, payload: packageTrade(checked.staged, signed, 'trade-agreed') };
}
