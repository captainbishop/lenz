import { assert, bytes, digest, randomId, signValue, unhex, keysAre } from './peer-crypto.js';
import { compressed, makeNearPayment, nearLedger, paymentPath, units, applySpend, checkRoot } from './near-protocol.js';

export const SWAP = 'lenz/rhea-swap/v1';
const account = value => typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value);
const amount = value => typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) < 2n ** 128n;
export function checkRheaConfig(c) {
  assert(c?.network === 'testnet' && account(c.adapter) && account(c.reserve) && c.adapter !== c.reserve
    && c.exchange === 'ref-finance-101.testnet' && c.tokenOut === 'wrap.testnet'
    && Number.isSafeInteger(c.poolId) && c.poolId >= 0, 'Invalid Rhea testnet configuration');
}
export const swapTerms = (c, i) => [SWAP, 'testnet', c.adapter, c.reserve, c.exchange, String(c.poolId), c.tokenOut,
  i.input, i.owner, i.amount, i.min_output, i.receiver_id, i.nonce, i.deadline_ms];
export const redemptionTerms = (c, i) => ['lenz/near-redeem/v1', 'testnet', c.reserve, i.input, c.adapter, i.nonce];
export async function checkRheaInstruction(c, i) {
  checkRheaConfig(c);
  assert(keysAre(i, ['input','owner','amount','min_output','receiver_id','nonce','deadline_ms','signature','redemption_signature']), 'Invalid swap instruction');
  assert(typeof i.input === 'string' && /^(root:[0-9a-f]{64}|[0-9a-f]{64}:[01])$/.test(i.input), 'Invalid swap input');
  assert(typeof i.owner === 'string' && /^(02|03)[0-9a-f]{64}$/.test(i.owner), 'Invalid swap owner');
  assert(amount(i.amount) && amount(i.min_output), 'Invalid swap amount');
  assert(account(i.receiver_id) && ![c.adapter,c.reserve,c.exchange].includes(i.receiver_id), 'Choose a separate testnet receiving account');
  assert(typeof i.nonce === 'string' && /^[0-9a-f]{32}$/.test(i.nonce), 'Invalid swap nonce');
  assert(typeof i.deadline_ms === 'string' && /^[1-9][0-9]{0,15}$/.test(i.deadline_ms)
    && Number.isSafeInteger(Number(i.deadline_ms)), 'Invalid swap deadline');
  const key = await crypto.subtle.importKey('raw', unhex(i.owner), { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
  for (const [signature, terms] of [[i.signature, swapTerms(c,i)], [i.redemption_signature, redemptionTerms(c,i)]]) {
    assert(typeof signature === 'string' && /^[0-9a-f]{128}$/.test(signature), 'Invalid swap signature');
    assert(await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, key, unhex(signature), bytes(terms)), 'Swap signature rejected');
  }
  return digest(swapTerms(c,i));
}
export async function prepareRheaSwap(vault, identity, c, {text, minOutput, receiver, deadlineMs}, now = Date.now()) {
  checkRheaConfig(c); assert(vault.contract === c.reserve, 'Swap reserve differs from this wallet');
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > now && deadlineMs <= now + 86400000, 'Choose a deadline within 24 hours');
  const wanted = units(text), owner = compressed(identity.profile.signingPublic);
  let next = structuredClone(vault), ledger = await nearLedger(next);
  let input = ledger.available.find(n => n.owner === owner && n.amount === wanted);
  if (!input) {
    // A self-transfer creates the exact input and preserves the remaining change.
    const split = await makeNearPayment(next, identity, identity.profile, text); next = split.vault;
    ledger = await nearLedger(next); input = ledger.available.find(n => n.owner === owner && n.amount === wanted);
  }
  assert(input, 'No available payment covers this swap');
  const i = { input:input.id, owner, amount:wanted, min_output:minOutput, receiver_id:receiver,
    nonce:randomId(), deadline_ms:String(deadlineMs), signature:'', redemption_signature:'' };
  i.signature = await signValue(identity, swapTerms(c,i)); i.redemption_signature = await signValue(identity, redemptionTerms(c,i));
  const id = await checkRheaInstruction(c,i), {root,path} = await paymentPath(next,input.id);
  const packet = {kind:'lenz-rhea-order-v1', config:{network:c.network,adapter:c.adapter,reserve:c.reserve,exchange:c.exchange,poolId:c.poolId,tokenOut:c.tokenOut}, id, instruction:i, root, path};
  next.rheaOrders ??= []; assert(next.rheaOrders.length < 64, 'This test wallet has reached its swap limit');
  next.rheaOrders.push({packet, status:null});
  // Callers must commit the encrypted vault before exposing packet to a carrier.
  return {vault:next, packet};
}
export async function checkRheaPacket(c, packet) {
  assert(keysAre(packet,['kind','config','id','instruction','root','path']) && packet.kind === 'lenz-rhea-order-v1', 'Invalid swap file');
  for (const k of ['network','adapter','reserve','exchange','poolId','tokenOut']) assert(packet.config?.[k] === c[k], 'Swap belongs to another adapter');
  const id = await checkRheaInstruction(c,packet.instruction); assert(id === packet.id, 'Swap id differs from signed terms');
  await checkRoot(packet.root); assert(Array.isArray(packet.path) && packet.path.length <= 16, 'Invalid swap ancestry');
  const notes = new Map([[packet.root.id,packet.root]]), consumed = new Map();
  for (const spend of packet.path) await applySpend(c.reserve,notes,consumed,spend);
  const input = notes.get(packet.instruction.input);
  assert(input && !consumed.has(input.id) && input.owner === packet.instruction.owner && input.amount === packet.instruction.amount, 'Swap input does not match its ancestry');
  return id;
}
