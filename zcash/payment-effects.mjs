// Read-only local inspection. Viewing keys stay in process memory, never HTTP.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readNativeWallet } from './companion.mjs';
const execute = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateEffects(value, review) {
  assert(value?.status === 'verified' && value.version === 6 && value.pool === 'ironwood' &&
    value.changeOwned === true && value.commitmentsVerified === true && value.noteEncryptionVerified === true && value.canSign === false && value.canSend === false,
  'Invalid cryptographic review');
  for (const field of ['amount', 'fee', 'change', 'inputValue']) assert(typeof value[field] === 'string' && /^[1-9][0-9]{0,15}$/.test(value[field]), 'Invalid review value');
  assert.equal(value.amount, String(review.value)); assert.equal(value.fee, review.summary.fee);
  assert.equal(value.change, review.summary.change); assert.equal(value.recipient, review.summary.address);
  assert(BigInt(value.amount) <= 10000000n && BigInt(value.fee) <= 10000n);
  assert.equal(BigInt(value.inputValue), BigInt(value.amount) + BigInt(value.fee) + BigInt(value.change), 'Input value differs from review');
  // Whitelist fields even if a future native tool emits additional information.
  return { status: 'verified', version: 6, pool: 'ironwood', amount: value.amount, fee: value.fee,
    change: value.change, inputValue: value.inputValue, recipient: value.recipient,
    changeOwned: true, commitmentsVerified: true, noteEncryptionVerified: true, canSign: false, canSend: false };
}
export async function inspectNativeEffects(wallet, file, review) {
  assert(['a', 'b'].includes(wallet) && review.wallet === wallet);
  const build = JSON.parse(await readFile(new URL('./review-inspector/build.json', import.meta.url)));
  for (const [path, field] of [['src/main.rs','sourceSha256'],['src/effects.rs','effectsSourceSha256'],['Cargo.lock','lockSha256'],['Cargo.toml','manifestSha256'],['target/release/lenz-zcash-review-inspector.exe','executableSha256']]) {
    assert.equal(sha(await readFile(new URL('./review-inspector/' + path, import.meta.url))), build[field], 'Inspector source or executable changed');
  }
  // The existing read validates testnet configuration and pinned wallet binaries.
  await readNativeWallet('balance', wallet);
  const walletExecutable = fileURLToPath(new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe', import.meta.url));
  const { stdout } = await execute(walletExecutable, ['wallet', '-w', fileURLToPath(new URL('./.testnet/' + wallet, import.meta.url)), 'list-accounts'],
    { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  const viewingKeys = [...stdout.matchAll(/^\s+UFVK: (\S+)$/gm)];
  assert.equal(viewingKeys.length, 1, 'Expected one disposable native account');
  assert.equal([...stdout.matchAll(/^Account /gm)].length, 1);
  assert(/^\s+Account index: 0\s*$/m.test(stdout), 'Unexpected native account index');
  const input = JSON.stringify({ ufvk: viewingKeys[0][1], recipient: review.summary.address, amount: review.value, fee: Number(review.summary.fee) });
  const inspector = fileURLToPath(new URL('./review-inspector/target/release/lenz-zcash-review-inspector.exe', import.meta.url));
  // Keep the viewing key off command lines and sanitize native diagnostics.
  const result = await new Promise((resolve, reject) => {
    const child = execFile(inspector, ['--effects', file], { windowsHide: true, timeout: 15000, maxBuffer: 4096 }, (error, out, stderr) => {
      const safeReasons = ['Invalid value commitment','Input does not match wallet viewing key','Invalid spend key binding','Invalid output commitment','Change is not owned by the sending wallet','Invalid Ironwood bundle','Invalid testnet viewing key','Recipient must be the other test wallet','Expected an unsigned two-action Ironwood test payment','Invalid review terms','Expected a testnet shielded recipient','Invalid cross-address binding','Expected one real input, recipient and owned change','Recipient amount differs from review','Fee differs from review','Unsupported note encryption domain','Output note encryption could not be verified','Encrypted output differs from committed terms'];
      if (error) reject(Object.assign(Error('The transaction did not pass the local cryptographic check.'), { nativeCode: error.code, reason: safeReasons.includes(stderr.trim()) ? stderr.trim() : 'Native review rejected' }));
      else { try { resolve(JSON.parse(out)); } catch { reject(Error('Invalid native review response.')); } }
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
  return validateEffects(result, review);
}
