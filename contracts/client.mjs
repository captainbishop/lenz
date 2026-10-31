import { readFile } from 'node:fs/promises';
import { Account, JsonRpcProvider, nearToYocto, teraToGas, getTransactionLastResult } from 'near-api-js';
import { TESTNET_RPC } from '../integrations/near-network.mjs';

export const provider = new JsonRpcProvider({ url: TESTNET_RPC });
export const configPath = new URL('../web/public/near-config.json', import.meta.url);
export async function configuration() { return JSON.parse(await readFile(configPath, 'utf8')); }
export async function relayAccount() {
  const key = JSON.parse(await readFile(new URL('./.testnet/deployer.json', import.meta.url), 'utf8'));
  if (!key.accountId.endsWith('.testnet')) throw new Error('The relay must use a testnet account.');
  return new Account(key.accountId, provider, key.privateKey);
}
export async function view(contract, method, args) {
  return provider.callFunction({ contractId: contract, method, args, blockQuery: { finality: 'final' } });
}
export function finalReceipt(tx) {
  if (tx.final_execution_status !== 'FINAL' || typeof tx.status !== 'object' || !Object.hasOwn(tx.status, 'SuccessValue')) throw new Error('NEAR did not confirm successful final execution.');
  const failures = tx.receipts_outcome.filter(r => typeof r.outcome.status === 'object' && Object.hasOwn(r.outcome.status, 'Failure'));
  if (failures.length) throw new Error('A NEAR execution receipt failed.');
  return { finality: 'FINAL', txHash: tx.transaction.hash,
    receiptIds: tx.receipts_outcome.map(r=>r.id), gasBurnt: tx.receipts_outcome.reduce((s,r)=>s+BigInt(r.outcome.gas_burnt),0n).toString(),
    value: getTransactionLastResult(tx) };
}
export async function call(account, contract, method, args, deposit='0.2') {
  const tx = await account.callFunctionRaw({ contractId:contract, methodName:method, args, gas:teraToGas('250'), deposit:nearToYocto(deposit), waitUntil:'FINAL' });
  return finalReceipt(tx);
}
