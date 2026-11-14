import { buildLendingPermissionReview, checkLendingPermissionReview, checkLendingSignedPermission } from './intent-lending-account.js';
import { LENDING_TESTNET } from './intent-lending-config.js';

const check = (value, reason) => { if (!value) throw Error(reason); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLendingIntentService({ account, config = LENDING_TESTNET, fetchImpl = fetch, now = Date.now, online = () => navigator.onLine } = {}) {
  check(account, 'Open the recoverable lending account.');
  const results = new Map();
  async function request(operation, body, { signal } = {}) {
    check(online(), 'Reconnect to submit or check the original lending request.');
    signal?.throwIfAborted();
    const response = await fetchImpl('/api/intents/lending/' + operation, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    check(response.body, 'The lending response is unavailable.');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; check(length <= 2000000, 'The lending response is too large.'); chunks.push(value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const data = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    let result; try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw Error('The lending response cannot be read.'); }
    check(response.ok, result?.error ?? 'The original lending request is unavailable.'); return result;
  }
  function own(review, lease) {
    lease.assertCurrent();
    check(review.owner === lease.identity.lenzIdentity && review.ownerAddress === lease.identity.ownerAddress && review.account === lease.identity.account && review.chainId === lease.identity.chainId && same(review.route, lease.identity.route), 'Open the original lending owner and account.');
  }
  async function prepare(input, options = {}) {
    await account.refreshAccount(options);
    const lease = account.capture(), review = buildLendingPermissionReview(lease.identity, input, { config, now: now() });
    const result = await request('prepare', { review }, options); own(review, lease);
    check(result?.execute === true && result.available === true && same(checkLendingPermissionReview(result.review, { config, now: now() }), review), 'The reviewed lending permission changed or is unavailable.');
    return review;
  }
  async function approve(value, options = {}) {
    const review = checkLendingPermissionReview(value, { config, now: now() }), lease = account.capture(); own(review, lease);
    const fresh = await request('prepare', { review }, options); own(review, lease);
    check(fresh?.execute === true && fresh.available === true && same(checkLendingPermissionReview(fresh.review, { config, now: now() }), review), 'The original lending review changed before approval.');
    const method = review.kind === 'Order' ? 'signOrder' : review.kind === 'Cancel' ? 'signCancel' : 'signTransfer';
    const signed = await lease[method](review, options); own(review, lease);
    return checkLendingSignedPermission(signed, review);
  }
  async function prepareCancellation(id, options = {}) {
    await account.refreshAccount(options);
    const lease = account.capture(), rows = await account.pendingOrders(), row = rows.find(value => value.id === id);
    check(row?.status === 'approval-unresolved' && !row.signed, 'Keep and check the original unresolved lending approval.');
    const original = checkLendingPermissionReview(row.review, { config, allowExpired: true }); own(original, lease);
    check(original.kind !== 'Cancel' && original.terms.nonce === lease.identity.nonce, 'The original permission nonce has advanced or changed. Refresh its status.');
    check(!rows.some(value => value.review.kind === 'Cancel' && value.review.terms.nonce === original.terms.nonce), 'Check the original cancellation before creating another authority.');
    await lease.requireRecovery({ latest: true, ...options }); own(original, lease);
    return prepare({ kind: 'Cancel', terms: { nonce: original.terms.nonce, deadline: String(Math.floor(now() / 1000) + 300) }, cancels: original.id }, options);
  }
  async function original(id) {
    const row = (await account.pendingOrders()).find(value => value.id === id);
    check(row?.signed, 'Keep the original lending approval before submission.');
    const review = checkLendingPermissionReview(row.review, { config, allowExpired: true }), signed = checkLendingSignedPermission(row.signed, review);
    own(review, account.capture()); return { row, review, signed };
  }
  function outcome(value, review, signed) {
    check(value?.intentId === review.id && value.artifactId === signed.digest && ['pending', 'unknown', 'executed'].includes(value.status), 'The lending result belongs to another original permission.');
    if (value.status === 'executed') {
      const evidence = value.evidence;
      check(value.verified === true && evidence?.chainId === config.chain && evidence.account === review.account && evidence.ownerAddress === review.ownerAddress && evidence.nonce === review.terms.nonce && evidence.digest === signed.digest && evidence.kind === review.kind && /^0x[0-9a-f]{64}$/.test(evidence.transaction) && /^0x[0-9a-f]{64}$/.test(evidence.blockHash) && /^(0|[1-9][0-9]*)$/.test(evidence.blockNumber) && evidence.position, 'The finalized lending receipt and position evidence are incomplete.');
      if (review.kind !== 'Cancel') check(evidence.amount === review.terms.amount && evidence.recipient === review.terms.recipient && (review.kind === 'Order' ? evidence.action === review.terms.action && /^(0|[1-9][0-9]*)$/.test(evidence.result) && BigInt(evidence.result) >= BigInt(review.terms.minResult) && BigInt(evidence.result) <= BigInt(review.terms.amount) : evidence.asset === review.terms.asset), 'The finalized lending amount or result changed.');
    } else check(value.verified !== true, 'An unresolved lending request cannot be shown as verified.');
    results.set(review.id, structuredClone(value)); return structuredClone(value);
  }
  async function submit(id, options = {}) {
    const { row, review, signed } = await original(id), lease = account.capture(); own(review, lease);
    check(BigInt(review.terms.deadline) * 1000n > BigInt(now()), 'The original lending permission expired. Check its status.');
    check(online(), 'Reconnect to submit the original lending request.');
    if (row.status === 'signed') {
      const retained = await account.beginOrderDispatch(id, options); own(review, lease);
      check(same(retained, signed), 'The original lending signature changed before dispatch.');
    } else check(row.status === 'submission-unresolved', 'Check the original lending approval first.');
    const value = await request('submit', { review, signed }, options); own(review, lease); return outcome(value, review, signed);
  }
  async function recover(operation, id, options = {}) {
    const { review, signed } = await original(id), lease = account.capture(); own(review, lease);
    const value = await request(operation, { review, signed }, options); own(review, lease); return outcome(value, review, signed);
  }
  async function pending() { return (await account.pendingOrders()).map(row => ({ ...row, outcome: structuredClone(results.get(row.id) ?? null) })); }
  return Object.freeze({ prepare, prepareCancellation, approve, submit, reconcile: (id, options) => recover('reconcile', id, options), resume: (id, options) => recover('resume', id, options), pending, configuration: options => request('config', {}, options) });
}
