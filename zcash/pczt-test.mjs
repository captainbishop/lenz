// One disposable A -> B test. PCZTs stay private; default invocation only reads evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = new URL('./', import.meta.url);
const path = relative => fileURLToPath(new URL(relative, base));
const privateDir = '.testnet/pczt-a-to-b-2026-10-31/';
const reportPath = 'pczt-results.json';
const original = '../tooling/zcash-devtool/target/release/zcash-devtool.exe';
const candidate = '../tooling/zcash-devtool/target/release/lenz-zcash-pczt.exe';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = async file => hash(await readFile(path(file)));
const exists = async file => access(path(file)).then(() => true, e => {
  if (e.code === 'ENOENT') return false;
  throw e;
});
const [action = 'status', ...extra] = process.argv.slice(2);
assert(!extra.length && ['status', 'prepare', 'review', 'prove', 'reproduce', 'sign', 'send', 'confirm'].includes(action));
let report = await exists(reportPath) ? JSON.parse(await readFile(path(reportPath))) : {
  network: 'test', from: 'a', to: 'b', value: 10000000,
  maximumFee: 100000, confirmationsRequired: 10, steps: {},
  scope: 'Disposable native Zcash test; no Lenz identity or production funds. Network settlement requires reconnection.',
};
if (action === 'status') { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
const lock = JSON.parse(await readFile(path('source-lock.json')));
assert.equal(await digest(original), lock.windowsExeSha256);
assert.equal(await digest('../tooling/zcash-devtool/Cargo.lock'), lock.cargoLockSha256);
for (const name of ['a', 'b']) {
  assert(/^network\s*=\s*"test"\s*$/m.test(await readFile(path(`.testnet/${name}/keys.toml`), 'utf8')));
}
const save = async () => writeFile(path(reportPath), `${JSON.stringify(report, null, 2)}\n`);
const run = (exe, args, input) => {
  const start = performance.now();
  const child = spawnSync(path(exe), args, {
    input: input ?? '\n', encoding: 'utf8', timeout: 900000,
    maxBuffer: 1024 * 1024, windowsHide: true,
  });
  return { exitCode: child.status, milliseconds: Math.round(performance.now() - start),
    stdout: child.stdout?.trim() ?? '', stderr: child.stderr?.trim() ?? '', error: child.error?.code };
};
const good = result => { assert.equal(result.exitCode, 0, result.stderr || result.error); return result; };
const wallet = (name, command) => good(run(original, ['wallet', '-w', path(`.testnet/${name}/`), ...command]));
const pczt = (exe, command, input) => run(exe, ['pczt', '-w', path('.testnet/a/'), ...command], input);
const file = name => `${privateDir}${name}.pczt`;
const inspect = name => good(pczt(original, ['inspect', path(file(name)), '--identity', path('.testnet/a/identity.age')])).stdout;
const snapshot = () => Object.fromEntries(['a', 'b'].map(name => [name, {
  balance: JSON.parse(wallet(name, ['balance', '--json']).stdout),
  transactions: JSON.parse(wallet(name, ['list-tx', '--json']).stdout),
}]));
const inspectSame = name => assert.equal(inspect(name), report.inspection, 'Transaction effects changed');
assert(!report.steps[action], `Step ${action} is already recorded; inspect status before continuing`);

try {
  if (action === 'prepare') {
    assert.equal(Object.keys(report.steps).length, 0);
    assert(!(await exists(privateDir)), 'Existing private run requires manual reconciliation');
    report.before = snapshot();
    assert.equal(report.before.a.balance.total, 100000000);
    assert.equal(report.before.a.balance.ironwood_spendable, 100000000);
    assert.equal(report.before.b.balance.total, 0);
    report.address = wallet('b', ['list-addresses', '--receiver', 'orchard']).stdout.match(/^Receiver\(orchard\): (utest1\S+)$/m)?.[1];
    assert(report.address);
    await mkdir(path(privateDir));
    report.sourceRevision = lock.revision;
    await save();
    report.steps.prepare = good(pczt(original, ['create', '--address', report.address,
      '--value', String(report.value), '--target-note-count', '1', '--output', path(file('unsigned'))]));
    report.inspection = inspect('unsigned');
    report.txid = report.inspection.match(/^TxID: ([0-9a-f]{64})$/m)?.[1];
    assert(report.txid);
    assert.match(report.inspection, /^Version: V6$/m);
    assert.match(report.inspection, /^2 Ironwood actions:$/m);
    assert(!/transparent|Sapling|Orchard/.test(report.inspection), 'Unexpected additional pool');
    assert(report.inspection.includes(`10000000 zatoshis to ${report.address}`));
    const inputs = [...report.inspection.matchAll(/Spend: (\d+) zatoshis/g)].map(m => Number(m[1]));
    const outputs = [...report.inspection.matchAll(/Output: (\d+) zatoshis/g)].map(m => Number(m[1]));
    report.fee = inputs.reduce((a, b) => a + b, 0) - outputs.reduce((a, b) => a + b, 0);
    assert(report.fee > 0 && report.fee <= report.maximumFee);
    assert.equal(inputs.reduce((a, b) => a + b, 0), 100000000);
    assert.equal(outputs.length, 2);
    report.changeOwnership = 'Requires native key-derived check before signing; inspection lacks change derivation metadata';
    report.unsignedSha256 = await digest(file('unsigned'));
  } else if (action === 'review') {
    // Recover this run's documented inspection-only failure without rebuilding a transaction.
    assert(report.steps.prepare && report.failures?.[0]?.action === 'prepare');
    inspectSame('unsigned');
    assert.equal(report.fee, 10000);
    report.changeOwnership = 'Requires native key-derived check before signing; inspection lacks change derivation metadata';
    report.unsignedSha256 = await digest(file('unsigned'));
    report.steps.review = { ok: true };
  } else if (action === 'prove') {
    assert(report.unsignedSha256);
    assert.equal(await digest(file('unsigned')), report.unsignedSha256);
    assert(!(await exists(file('proved'))));
    report.steps.prove = good(pczt(original, ['prove', path(file('unsigned')), '--output', path(file('proved'))]));
    inspectSame('proved');
    report.provedSha256 = await digest(file('proved'));
  } else if (action === 'reproduce') {
    assert.equal(await digest(file('unsigned')), report.unsignedSha256);
    assert(!(await exists(file('original-signed'))));
    const signing = good(pczt(original, ['sign', '--identity', path('.testnet/a/identity.age'), path(file('unsigned')), '--output', path(file('original-signed'))]));
    inspectSame('original-signed');
    const extraction = pczt(original, ['extract'], await readFile(path(file('original-signed'))));
    assert.notEqual(extraction.exitCode, 0, 'Original signer did not reproduce the suspected failure');
    report.steps.reproduce = { signing, extraction };
  } else if (action === 'sign') {
    assert(report.steps.reproduce);
    const build = JSON.parse(await readFile(path('pczt-support/build.json')));
    assert.equal(await digest(candidate), build.windowsExeSha256);
    assert.equal(await digest(file('proved')), report.provedSha256);
    assert(!(await exists(file('signed'))));
    inspectSame('proved');
    const signArgs = ['sign', '--identity', path('.testnet/a/identity.age'), path(file('proved')),
      '--expected-recipient', report.address, '--expected-value', String(report.value), '--maximum-fee', String(report.fee)];
    report.signingControls = {};
    for (const [name, flag, value] of [
      ['wrongAmount', '--expected-value', '9999999'],
      ['excessFee', '--maximum-fee', '9999'],
      ['wrongRecipient', '--expected-recipient', wallet('a', ['list-addresses', '--receiver', 'orchard']).stdout.match(/^Receiver\(orchard\): (utest1\S+)$/m)[1]],
    ]) {
      const args = [...signArgs];
      args[args.indexOf(flag) + 1] = value;
      const control = pczt(candidate, [...args, '--output', path(file(`rejected-${name}`))]);
      assert.equal(control.exitCode, 1, `Control ${name} did not reject`);
      assert(!(await exists(file(`rejected-${name}`))), 'Rejected signer produced an output');
      report.signingControls[name] = control;
    }
    report.steps.sign = good(pczt(candidate, [...signArgs, '--output', path(file('signed'))]));
    inspectSame('signed');
    const extracted = good(pczt(original, ['extract'], await readFile(path(file('signed')))));
    assert.equal(extracted.stdout, report.txid);
    report.extraction = extracted;
    report.signedSha256 = await digest(file('signed'));
    report.candidateSha256 = build.windowsExeSha256;
    report.changeOwnership = 'Verified from wallet A account 0 full viewing key, internal scope and output note commitment';
  } else if (action === 'send') {
    assert(report.signedSha256 && report.extraction);
    assert(!report.submissionAttempt, 'Submission already attempted; reconcile the recorded txid, never regenerate automatically');
    assert.equal(await digest(file('signed')), report.signedSha256);
    inspectSame('signed');
    report.submissionAttempt = { at: new Date().toISOString(), txid: report.txid, signedSha256: report.signedSha256 };
    await save();
    report.steps.send = pczt(original, ['send', '--server', 'zecrocks', path(file('signed'))]);
    await save();
    good(report.steps.send);
    assert(report.steps.send.stdout.endsWith(report.txid));
  } else if (action === 'confirm') {
    assert(report.submissionAttempt);
    report.after = snapshot();
    for (const name of ['a', 'b']) {
      const tx = report.after[name].transactions.find(tx => tx.txid === report.txid);
      assert(tx?.mined_height > 0, `Not yet mined in wallet ${name}; sync then recheck`);
      report.after[name].minedHeight = tx.mined_height;
      report.after[name].confirmations = report.after[name].balance.chain_tip_height - tx.mined_height + 1;
      assert(report.after[name].confirmations >= report.confirmationsRequired, `Waiting for confirmations in wallet ${name}`);
    }
    assert.equal(report.after.a.minedHeight, report.after.b.minedHeight);
    assert.equal(report.after.a.balance.total, report.before.a.balance.total - report.value - report.fee);
    assert.equal(report.after.b.balance.total, report.value);
    for (const name of ['a', 'b']) assert.equal(report.after[name].balance.ironwood_spendable, report.after[name].balance.total);
    report.steps.confirm = { ok: true };
  }
  report.updatedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failures ??= [];
  report.failures.push({ action, at: new Date().toISOString(), message: error.message });
  await save();
  throw error;
}
