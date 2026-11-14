// Browser boundary for the two existing disposable native wallets. No key or send API.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const execute = promisify(execFile);
export function createNativeWalletReader({walletRoot}) {
  assert(typeof walletRoot==='string' && walletRoot.length>0,'Choose an explicit native wallet directory');
  return async (action,wallet,{signal}={}) => {
    assert(['info','sync','balance','address'].includes(action) && ['a','b'].includes(wallet),'Unsupported native wallet read');
    const lock=JSON.parse(await readFile(new URL('./source-lock.json',import.meta.url)));
    const executable=fileURLToPath(new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe',import.meta.url));
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha(await readFile(executable)),lock.windowsExeSha256,'Native wallet executable changed');
    assert.equal(sha(await readFile(new URL('../tooling/zcash-devtool/Cargo.lock',import.meta.url))),lock.cargoLockSha256,'Native wallet dependencies changed');
    const directory=join(walletRoot,wallet),configuration=await readFile(join(directory,'keys.toml'),'utf8');
    assert(/^network\s*=\s*"test"\s*$/m.test(configuration),'Refusing a non-testnet native wallet');
    const commands={info:['get-info','--server','zecrocks'],sync:['sync','--server','zecrocks'],balance:['balance','--json'],address:['list-addresses','--receiver','orchard']};
    try {
      const {stdout}=await execute(executable,['wallet','-w',directory,...commands[action]],{windowsHide:true,timeout:action==='sync'?900000:75000,maxBuffer:1048576,signal});
      const value={ok:true,network:'test',wallet,action};
      if(action==='info'){value.info=JSON.parse(stdout);assert.equal(value.info.chain_name,'test');}
      else if(action==='balance')value.balance=JSON.parse(stdout);
      else if(action==='address'){value.orchardAddress=stdout.match(/^Receiver\(orchard\): (utest1\S+)$/m)?.[1];assert(value.orchardAddress);}
      return value;
    } catch { throw Object.assign(Error('The configured local testnet wallet could not complete this check.'),{status:503}); }
  };
}
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
