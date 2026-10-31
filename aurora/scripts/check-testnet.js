import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Read-only: no wallet, signing or transaction method.
const endpoint = 'https://testnet.aurora.dev';
async function rpc(method) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Aurora HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const chainId = await rpc('eth_chainId');
assert.equal(BigInt(chainId), 1313161555n, 'Unexpected Aurora network');
const block = await rpc('eth_blockNumber');
const evidence = { checkedAt: new Date().toISOString(), endpoint, chainId: Number(BigInt(chainId)), block: BigInt(block).toString(), scope: 'read-only RPC; no deployment' };
await writeFile(new URL('../testnet-rpc-results.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
