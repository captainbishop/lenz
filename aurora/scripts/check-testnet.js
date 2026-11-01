import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { AURORA_TESTNET, readAuroraQuantity } from '../rpc.mjs';

// Read-only: no wallet, signing or transaction method.
const chainId = await readAuroraQuantity('eth_chainId');
assert.equal(chainId, 1313161555n, 'Unexpected Aurora network');
const block = await readAuroraQuantity('eth_blockNumber');
const evidence = { checkedAt: new Date().toISOString(), endpoint: AURORA_TESTNET, chainId: Number(chainId), block: block.toString(), scope: 'Bounded read-only RPC; no signing, transaction or deployment' };
await writeFile(new URL('../testnet-rpc-results.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
