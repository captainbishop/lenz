// Expiry/network observations for a saved unsigned PCZT; never a signing approval.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readNativeWallet } from './companion.mjs';
const execute = promisify(execFile), sha256 = value => createHash('sha256').update(value).digest('hex');
const height = value => Number.isSafeInteger(value) && value > 0 && value < 500000000;

export function evaluateFreshness({ serverHeight, walletHeight, expiryHeight, targetHeight, branchMatches }) {
  assert(height(serverHeight) && height(walletHeight) && height(expiryHeight) && height(targetHeight), 'Invalid block height');
  assert.equal(targetHeight, serverHeight + 1, 'Wrong target block');
  assert.equal(typeof branchMatches, 'boolean');
  const blocksRemaining = Math.max(0, expiryHeight - serverHeight);
  const status = !branchMatches ? 'network-changed' : targetHeight > expiryHeight ? 'expired'
    : blocksRemaining <= 20 ? 'expires-soon' : walletHeight < serverHeight ? 'wallet-behind'
    : walletHeight > serverHeight ? 'network-behind' : 'within-expiry';
  return { status, serverHeight, walletHeight, expiryHeight, targetHeight, branchMatches, blocksRemaining };
}

export async function checkNativeFreshness(wallet, file, run = readNativeWallet) {
  assert(['a', 'b'].includes(wallet));
  const build = JSON.parse(await readFile(new URL('./review-inspector/build.json', import.meta.url)));
  const executable = new URL('./review-inspector/target/release/lenz-zcash-review-inspector.exe', import.meta.url);
  assert.equal(sha256(await readFile(executable)), build.executableSha256, 'Inspector executable changed');
  for (const [path, field] of [['src/main.rs','sourceSha256'],['src/effects.rs','effectsSourceSha256'],['Cargo.lock','lockSha256'],['Cargo.toml','manifestSha256']]) {
    assert.equal(sha256(await readFile(new URL('./review-inspector/' + path, import.meta.url))), build[field], 'Inspector source/dependencies changed');
  }
  const info = await run('info', wallet);
  assert(info.ok === true && info.wallet === wallet && info.action === 'info' && info.network === 'test' && info.info?.chain_name === 'test');
  const serverHeight = info.info.chain_tip_height; assert(height(serverHeight) && height(serverHeight + 1));
  const local = await run('balance', wallet);
  assert(local.ok === true && local.wallet === wallet && local.action === 'balance' && local.network === 'test');
  const { stdout } = await execute(fileURLToPath(executable), [file, String(serverHeight + 1)], { windowsHide: true, timeout: 15000, maxBuffer: 4096 });
  const decoded = JSON.parse(stdout);
  assert(decoded.version === 6 && decoded.network === 'testnet');
  return evaluateFreshness({ ...decoded, serverHeight, walletHeight: local.balance?.chain_tip_height });
}
