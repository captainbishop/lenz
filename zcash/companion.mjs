// Browser boundary for the two existing disposable native wallets. No key or send API.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
export async function readNativeWallet(action, wallet) {
  assert(['info', 'sync', 'balance', 'address'].includes(action), 'Unsupported companion action');
  assert(['a', 'b'].includes(wallet), 'Unknown test wallet');
  try {
    // wallet.mjs checks pinned executable/dependency hashes and the wallet's testnet config.
    const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('./wallet.mjs', import.meta.url)), action, wallet, '--no-save'],
      { windowsHide: true, timeout: 75000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    // Native stderr may include local paths or wallet metadata. Never return it over HTTP.
    throw Object.assign(Error('The local Zcash test wallet could not complete this check. Its last balance may be out of date.'), {
      operation: action,
      code: error.killed || /\bETIMEDOUT\b/.test(error.stderr ?? '') ? 'ZCASH_TIMEOUT' : 'ZCASH_NATIVE_FAILURE'
    });
  }
}
function checked(result, action, wallet) {
  assert(result?.ok === true && result.network === 'test' && result.wallet === wallet && result.action === action, 'Unexpected test wallet response');
  return result;
}
export async function companionSnapshot(wallet, refresh = false, run = readNativeWallet) {
  assert(['a', 'b'].includes(wallet), 'Unknown test wallet');
  assert.equal(typeof refresh, 'boolean');
  let serverHeight = null;
  if (refresh) {
    const info = checked(await run('info', wallet), 'info', wallet).info;
    assert(info?.chain_name === 'test', 'Zcash server is not on testnet');
    assert(Number.isSafeInteger(info.chain_tip_height) && info.chain_tip_height > 0, 'Invalid server height');
    serverHeight = info.chain_tip_height;
    checked(await run('sync', wallet), 'sync', wallet);
  }
  const raw = checked(await run('balance', wallet), 'balance', wallet).balance;
  const fields = ['total', 'ironwood_spendable', 'orchard_spendable', 'sapling_spendable', 'transparent_spendable'];
  const amounts = {};
  for (const field of fields) {
    assert(Number.isSafeInteger(raw?.[field]) && raw[field] >= 0 && raw[field] <= 2100000000000000, 'Invalid Zcash amount');
    amounts[field] = BigInt(raw[field]).toString();
  }
  const spendable = fields.slice(1).reduce((sum, field) => sum + BigInt(amounts[field]), 0n);
  assert(spendable <= BigInt(amounts.total), 'Zcash balance totals disagree');
  assert(Number.isSafeInteger(raw.chain_tip_height) && raw.chain_tip_height > 0, 'Invalid wallet height');
  const address = checked(await run('address', wallet), 'address', wallet).orchardAddress;
  assert(typeof address === 'string' && /^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(address), 'Invalid testnet receive address');
  return { network: 'testnet', wallet, mode: 'native-test-companion', checkedAt: new Date().toISOString(),
    refreshed: refresh, serverHeight, walletHeight: raw.chain_tip_height,
    amounts: { ...amounts, spendable: spendable.toString(), pending: (BigInt(amounts.total) - spendable).toString() },
    address, receiver: 'orchard', canSend: false };
}
