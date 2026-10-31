import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Read-only discovery, based on Rhea's published contract list and CLI guide.
// Never selects a pool or assumes that a returned pool has usable liquidity.
const endpoint = 'https://test.rpc.fastnear.com';
const contract = 'ref-finance-101.testnet';
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'lenz-rhea-inspect', method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`NEAR HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  if (body.result?.error) throw new Error(body.result.error);
  return body.result;
}
const status = await rpc('status', []);
assert.equal(status.chain_id, 'testnet');
const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: contract });
const result = await rpc('query', {
  request_type: 'call_function', block_id: account.block_hash, account_id: contract,
  method_name: 'get_pools', args_base64: Buffer.from(JSON.stringify({ from_index: 0, limit: 10 })).toString('base64'),
});
const pools = JSON.parse(Buffer.from(result.result).toString('utf8'));
assert.ok(Array.isArray(pools), 'Unexpected get_pools response');
const evidence = {
  checkedAt: new Date().toISOString(), endpoint, network: status.chain_id,
  contract, codeHash: account.code_hash, blockHash: result.block_hash, blockHeight: result.block_height,
  query: { method: 'get_pools', from_index: 0, limit: 10 }, pools,
  scope: 'Contract discovery only. No Lenz swap, tUSD pool, funding or verified source-to-bytecode match.',
  sources: ['https://guide.rhea.finance/developers/contracts', 'https://guide.rhea.finance/developers-1/cli-trading'],
};
await writeFile(new URL('../research/rhea-testnet-check.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ contract, blockHeight: evidence.blockHeight, codeHash: evidence.codeHash, returnedPools: pools.length, scope: evidence.scope }, null, 2));
