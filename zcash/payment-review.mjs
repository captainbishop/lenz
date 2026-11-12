// Unsigned test-payment preparation only. No signing, proving or broadcast command.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readNativeWallet } from './companion.mjs';
import { checkNativeFreshness, evaluateFreshness } from './payment-freshness.mjs';
import { inspectNativeEffects, inspectNativeMemos, validateEffects } from './payment-effects.mjs';
import { validateMemos, publicMemos } from './payment-memos.mjs';
const execute = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('./', import.meta.url));
const executable = fileURLToPath(new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe', import.meta.url));
const fail = (message, status = 400) => Object.assign(Error(message), { status });
export function reviewAmount(amount) {
  if (typeof amount !== 'string' || !/^0\.(?:[0-9]{1,8})$/.test(amount)) throw fail('Enter an amount between 0.00000001 and 0.1 test ZEC, with at most eight decimal places.');
  const value = BigInt(amount.slice(2).padEnd(8, '0'));
  if (value < 1n || value > 10000000n) throw fail('This test review is limited to 0.1 test ZEC.');
  return Number(value);
}
export function inspectReview(text, value, address) {
  assert.match(text, /^2 Ironwood actions:$/m); assert.match(text, /^Version: V6$/m);
  assert(!/transparent|Sapling|Orchard/.test(text));
  const txid = text.match(/^TxID: ([0-9a-f]{64})$/m)?.[1]; assert(txid);
  const inputs = [...text.matchAll(/Spend: (\d+) zatoshis/g)].map(m => Number(m[1]));
  const outputs = [...text.matchAll(/Output: (\d+) zatoshis([^\n]*)/g)];
  assert.equal(inputs.length, 1); assert.equal(outputs.length, 2);
  assert(inputs.every(Number.isSafeInteger));
  const recipient = outputs.filter(m => m[2] === ` to ${address}`), change = outputs.filter(m => m[2] === '');
  assert.equal(recipient.length, 1); assert.equal(change.length, 1);
  assert.equal(Number(recipient[0][1]), value);
  const changeValue = Number(change[0][1]); assert(Number.isSafeInteger(changeValue) && changeValue > 0);
  const fee = inputs[0] - value - changeValue;
  assert(fee > 0 && fee <= 10000, 'Unexpected fee');
  return { txid, fee: String(fee), change: String(changeValue), totalDebit: String(value + fee) };
}
async function prepareNative(wallet, value, output) {
  // The existing bridge checks exact executable/dependency hashes and testnet config.
  const source = await readNativeWallet('balance', wallet);
  const recipient = wallet === 'a' ? 'b' : 'a';
  const destination = await readNativeWallet('address', recipient);
  assert(source.ok && source.wallet === wallet && source.network === 'test');
  assert(destination.ok && destination.wallet === recipient && destination.network === 'test');
  const address = destination.orchardAddress;
  assert(/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(address));
  const spendable = source.balance.ironwood_spendable;
  assert(Number.isSafeInteger(spendable));
  if (spendable <= value + 10000) throw fail('Not enough spendable test ZEC for this payment, fee and change.', 422);
  const args = ['pczt', '-w', join(root, '.testnet', wallet)];
  await execute(executable, [...args, 'create', '--address', address, '--value', String(value), '--target-note-count', '1', '--output', output], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  const { stdout } = await execute(executable, [...args, 'inspect', output], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  return { ...inspectReview(stdout.trim(), value, address), recipient, address, walletHeight: source.balance.chain_tip_height };
}
export function createPaymentReviewService({ directory = join(root, '.testnet', 'payment-review'), prepare = prepareNative, check = checkNativeFreshness, effects = inspectNativeEffects, memos = inspectNativeMemos } = {}) {
  const recordPath = join(directory, 'current.json');
  let busy = false;
  let memoLease = null;
  const read = async () => {
    try { return JSON.parse(await readFile(recordPath)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const save = async record => { const temporary = recordPath + '.tmp'; await writeFile(temporary, JSON.stringify(record)); await rename(temporary, recordPath); };
  const assertSavedHash = async (file,record,message) => {
    try { assert.equal(hash(await readFile(file)),record.sha256,message); }
    catch (error) { memoLease = null; record.memos = {status:'unavailable',checkedAt:new Date().toISOString()}; await save(record); throw error; }
  };
  const publicRecord = record => ({ id: record.id, wallet: record.wallet, state: record.state,
    createdAt: record.createdAt, amount: String(record.value), ...record.summary, freshness: record.freshness ?? null,
    effects: record.effects?.status === 'verified' ? { ...record.effects, noteEncryptionVerified: record.effects.noteEncryptionVerified === true } : record.effects ?? null,
    memos: publicMemos(record), canSign: false, canSend: false });
  return async (action, input, { signal } = {}) => {
    if (!['prepare', 'status', 'discard', 'check', 'effects', 'memos', 'memo-confirm'].includes(action) || !['a', 'b'].includes(input?.wallet)) throw fail('Choose test wallet A or B.');
    if (busy) throw fail('A payment review is already running.', 409);
    busy = true;
    try {
      await mkdir(directory, { recursive: true });
      const record = await read();
      if (record) assert(/^[0-9a-f-]{36}$/.test(record.id));
      if (['memos','memo-confirm'].includes(action)) {
        const current = () => { if (signal?.aborted) throw fail('Memo review was interrupted.',409); };
        try {
          current();
          if (!record || record.wallet !== input.wallet || record.id !== input.id || record.state !== 'ready') throw fail('Open the matching completed review before inspecting its memos.',409);
          const file = join(directory,record.id+'.pczt');
          if (action === 'memo-confirm') {
            if (!memoLease || memoLease.id !== record.id || memoLease.wallet !== record.wallet || memoLease.binding !== input.binding || record.memos?.status !== 'inspected' || record.memos.binding !== input.binding || memoLease.pcztSha256 !== record.sha256) throw fail('Inspect these exact memos again before confirming them.',409);
            await assertSavedHash(file,record,'Saved transaction changed before memo confirmation'); current();
            record.memos = {...record.memos,status:'confirmed',confirmedAt:new Date().toISOString()};
            await save(record); current(); await assertSavedHash(file,record,'Saved transaction changed during memo confirmation'); current(); memoLease = null;
            return {review:publicRecord(record)};
          }
          memoLease = null;
          record.memos = {status:'checking',checkedAt:new Date().toISOString()}; await save(record); current();
          await assertSavedHash(file,record,'Saved transaction changed');
          const result = validateMemos(await memos(record.wallet,file,record,{signal}),record); current();
          await assertSavedHash(file,record,'Saved transaction changed during memo inspection'); current();
          record.memos = {...result.descriptor,status:'inspected',inspectedAt:new Date().toISOString()};
          await save(record); current();
          memoLease = {id:record.id,wallet:record.wallet,binding:result.descriptor.binding,pcztSha256:record.sha256};
          return {review:publicRecord(record),memoInspection:result.inspection};
        } catch (error) {
          memoLease = null;
          if (record) { record.memos = {status:'unavailable',checkedAt:new Date().toISOString()}; await save(record); }
          throw error;
        }
      }
      if (action === 'effects') {
        if (!record || record.wallet !== input.wallet || record.id !== input.id || record.state !== 'ready') throw fail('Open the matching completed review before checking it.', 409);
        const file = join(directory, record.id + '.pczt');
        record.effects = { status: 'checking', checkedAt: new Date().toISOString() }; await save(record);
        try {
          await assertSavedHash(file,record,'Saved transaction changed');
          const verified = validateEffects(await effects(record.wallet, file, record), record);
          await assertSavedHash(file,record,'Saved transaction changed during check');
          record.effects = { ...verified, checkedAt: new Date().toISOString() }; await save(record);
          return { review: publicRecord(record) };
        } catch (error) {
          record.effects = { status: 'unavailable', checkedAt: new Date().toISOString() }; await save(record); throw error;
        }
      }
      if (action === 'check') {
        if (!record || record.wallet !== input.wallet || record.id !== input.id || record.state !== 'ready') throw fail('Open the matching completed review before checking it.', 409);
        const file = join(directory, record.id + '.pczt');
        // Invalidate the previous observation before I/O, including after interruption.
        record.freshness = { status: 'checking', checkedAt: new Date().toISOString() }; await save(record);
        try {
          await assertSavedHash(file,record,'Saved transaction changed');
          const observed = evaluateFreshness(await check(record.wallet, file));
          await assertSavedHash(file,record,'Saved transaction changed during check');
          record.freshness = { ...observed, checkedAt: new Date().toISOString() }; await save(record);
          return { review: publicRecord(record) };
        } catch (error) {
          record.freshness = { status: 'unavailable', checkedAt: new Date().toISOString() }; await save(record);
          throw error;
        }
      }
      if (action === 'discard') {
        memoLease = null;
        if (!record || record.wallet !== input.wallet || record.id !== input.id) throw fail('The saved review does not match this request.', 409);
        // Only unsigned requests exist here. Keep private evidence, mark it discarded.
        await save({ ...record, state: 'discarded' }); return { review: null };
      }
      if (record && record.state !== 'discarded') {
        if (record.wallet !== input.wallet) throw fail('A review is saved for the other test account. Open that account to review or discard it.', 409);
        if (record.state === 'ready') await assertSavedHash(join(directory,record.id+'.pczt'),record,'Saved transaction changed');
        if (action === 'prepare' && record.value !== reviewAmount(input.amount)) throw fail('Review or discard the saved payment before preparing a different amount.', 409);
        return { review: publicRecord(record) };
      }
      if (action === 'status') return { review: null };
      const value = reviewAmount(input.amount), id = randomUUID();
      const next = { id, wallet: input.wallet, value, createdAt: new Date().toISOString(), state: 'preparing' };
      await save(next); // Crash/interruption cannot silently create another transaction.
      try {
        const output = join(directory, id + '.pczt');
        next.summary = await prepare(input.wallet, value, output);
        next.sha256 = hash(await readFile(output)); next.state = 'ready'; await save(next);
        return { review: publicRecord(next) };
      } catch (error) {
        await save({ ...next, state: 'failed' }); throw error;
      }
    } finally { busy = false; }
  };
}
export const paymentReview = createPaymentReviewService();
