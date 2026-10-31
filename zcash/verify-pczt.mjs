// Saved-evidence checks only: no native wallet process, synchronization or payment.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root)));
const digest = async file => createHash('sha256').update(await readFile(new URL(file, root))).digest('hex');
export function verifyReport(r, browser) {
  const checks = [];
  assert.equal(r.network, 'test');
  assert.equal(r.from, 'a'); assert.equal(r.to, 'b');
  assert.equal(r.value, 10000000); assert.equal(r.fee, 10000);
  assert.match(r.inspection, /^Version: V6$/m);
  assert.match(r.inspection, /^2 Ironwood actions:$/m);
  assert(!/transparent|Sapling|Orchard/.test(r.inspection));
  assert(r.inspection.includes(`Output: ${r.value} zatoshis to ${r.address}`));
  checks.push('Fixed testnet recipient, amount, fee, version and Ironwood bundle');
  assert.equal(r.steps.reproduce.signing.exitCode, 0);
  assert.equal(r.steps.reproduce.extraction.exitCode, 1);
  assert.match(r.steps.reproduce.extraction.stderr, /Ironwood\(Extract\(MissingSpendAuthSig\)\)/);
  for (const name of ['prepare', 'prove', 'sign', 'send']) assert.equal(r.steps[name].exitCode, 0);
  assert.equal(r.extraction.exitCode, 0); assert.equal(r.extraction.stdout, r.txid);
  checks.push('Original missing-signature failure retained; candidate and cryptographic extraction succeeded');
  for (const [name, reason] of [['wrongAmount', 'Unexpected recipient amount'], ['excessFee', 'Fee exceeds authorized bound'], ['wrongRecipient', 'Recipient must be external to wallet A']]) {
    assert.equal(r.signingControls[name].exitCode, 1);
    assert(r.signingControls[name].stderr.includes(reason));
  }
  checks.push('Wrong amount, excessive fee and wrong recipient rejected for their expected reasons');
  assert.equal(r.submissionAttempt.txid, r.txid);
  assert.equal(r.submissionAttempt.signedSha256, r.signedSha256);
  assert.equal(r.steps.send.stdout, `Sending transaction...\n${r.txid}`);
  assert(Date.parse(r.submissionAttempt.at) < Date.parse(r.updatedAt));
  checks.push('Submission, signed artifact and verified transaction share one identity');
  assert.equal(r.steps.confirm.ok, true);
  assert.equal(r.after.a.minedHeight, r.after.b.minedHeight);
  for (const name of ['a', 'b']) {
    const after = r.after[name], tx = after.transactions.find(t => t.txid === r.txid);
    assert.equal(tx?.mined_height, after.minedHeight);
    assert.equal(after.confirmations, after.balance.chain_tip_height - after.minedHeight + 1);
    assert(after.confirmations >= 10 && after.confirmations >= r.confirmationsRequired);
    assert.equal(after.balance.ironwood_spendable, after.balance.total);
    for (const pool of ['orchard', 'sapling', 'transparent']) assert.equal(after.balance[`${pool}_spendable`], 0);
  }
  checks.push('Same mined transaction in both wallets, at least ten confirmations and spendable Ironwood notes');
  assert.equal(r.before.a.balance.total, 100000000); assert.equal(r.before.b.balance.total, 0);
  assert.equal(r.after.a.balance.total, 89990000); assert.equal(r.after.b.balance.total, r.value);
  assert.equal(r.after.a.balance.total + r.after.b.balance.total + r.fee, r.before.a.balance.total);
  checks.push('Exact recipient value, sender change and fee conserve the initial balance');
  assert.equal(browser.ok, true); assert.equal(browser.refresh, false);
  assert.deepEqual(browser.errors, []); assert.equal(browser.checks.length, 5);
  for (const name of ['a', 'b']) {
    const response = browser.responses.find(v => v.wallet === name);
    assert.equal(response.status, 200); assert.equal(response.body.canSend, false);
    assert.equal(response.body.amounts.total, String(r.after[name].balance.total));
    assert.equal(response.body.amounts.ironwood_spendable, String(r.after[name].balance.total));
  }
  checks.push('Five actual browser checks match the confirmed native balances without enabling browser sending');
  return checks;
}
const report = await json('zcash/pczt-results.json');
const browser = await json('web/zcash-companion-after-pczt-results.json');
const checks = verifyReport(report, browser);
const mutations = [];
for (const [name, mutate] of [
  ['wrong received value', r => { r.after.b.balance.total++; }],
  ['foreign transaction in recipient history', r => { r.after.b.transactions[0].txid = '0'.repeat(64); }],
  ['insufficient confirmations', r => { r.after.b.confirmations = 9; }],
  ['changed signed artifact', r => { r.submissionAttempt.signedSha256 = '0'.repeat(64); }],
]) {
  const changed = structuredClone(report); mutate(changed);
  assert.throws(() => verifyReport(changed, browser)); mutations.push({ name, rejected: true });
}
const build = await json('zcash/pczt-support/build.json');
const lock = await json('zcash/source-lock.json');
assert.equal(build.originalWindowsExeSha256, lock.windowsExeSha256);
assert.equal(build.windowsExeSha256, report.candidateSha256);
for (const [file, expected] of [
  ['tooling/zcash-devtool/target/release/zcash-devtool.exe', lock.windowsExeSha256],
  ['tooling/zcash-devtool/target/release/lenz-zcash-pczt.exe', build.windowsExeSha256],
  ['tooling/zcash-devtool/Cargo.lock', lock.cargoLockSha256],
  ['zcash/pczt-support/ironwood-test-signer.patch', build.patchSha256],
  ['tooling/zcash-devtool/src/commands/pczt/sign.rs', build.signerSourceSha256],
  ['tooling/zcash-devtool/Cargo.toml', build.manifestSha256],
]) assert.equal(await digest(file), expected, file);
checks.push('Pinned original binary/dependencies preserved; candidate source, patch and executable match');
const files = [];
for (const file of ['zcash/pczt-results.json', 'zcash/pczt-support/build.json', 'zcash/pczt-support/ironwood-test-signer.patch', 'zcash/pczt-test.mjs', 'zcash/verify-pczt.mjs', 'web/zcash-companion-live.test.cjs', 'web/zcash-companion-after-pczt-results.json']) files.push({ file, sha256: await digest(file) });
const result = { checkedAt: new Date().toISOString(), ok: true, checks, mutations, files,
  scope: 'Saved-evidence consistency and local artifact hashes. Does not independently query chain consensus or rerun signing.' };
await writeFile(new URL('zcash/pczt-verification.json', root), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, checks: checks.length, rejectedAlterations: mutations.length }, null, 2));
