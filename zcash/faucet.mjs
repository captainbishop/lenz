// One disposable testnet claim. An ambiguous request is polled, never resent.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const action = process.argv[2] ?? 'status';
assert(['claim', 'status'].includes(action), 'Use claim or status');
const url = 'https://fauzec.com', file = new URL('./faucet-a-results.json', import.meta.url);
let record;
try { record = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (action === 'claim') {
  assert(!record, 'A claim was already attempted. Use status; do not request another drip.');
  const wallet = JSON.parse(await readFile(new URL('./address-a-results.json', import.meta.url)));
  assert(wallet.ok && wallet.network === 'test' && wallet.orchardAddress.startsWith('utest1'));
  const networkResponse = await fetch(url + '/api/v1/network', { signal: AbortSignal.timeout(20000) });
  assert(networkResponse.ok, `Faucet network HTTP ${networkResponse.status}`);
  const network = await networkResponse.json();
  assert.equal(network.network, 'testnet', 'Faucet is not on testnet');
  record = { provider: url, network: 'testnet', address: wallet.orchardAddress,
    request_id: randomUUID(), attemptedAt: new Date().toISOString(), state: 'submission_pending' };
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', flush: true });
  const response = await fetch(url + '/api/v1/claim', { method: 'POST',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ network: 'testnet', address: record.address, request_id: record.request_id }) });
  record.httpStatus = response.status;
  record.response = await response.json();
} else {
  assert(record?.request_id, 'No recorded claim');
  const response = await fetch(url + '/api/v1/status/testnet/' + encodeURIComponent(record.request_id), { signal: AbortSignal.timeout(20000) });
  record.httpStatus = response.status;
  record.response = await response.json();
}
record.checkedAt = new Date().toISOString();
record.state = record.response.state ?? 'unknown';
await writeFile(file, JSON.stringify(record, null, 2) + '\n', { flush: true });
console.log(JSON.stringify(record, null, 2));
assert(!record.response.network || record.response.network === 'testnet', 'Wrong faucet network');
assert(!record.response.address || record.response.address === record.address, 'Wrong faucet recipient');
assert(!record.response.request_id || record.response.request_id === record.request_id, 'Wrong faucet request');
if (record.httpStatus >= 400 || record.response.error_code) process.exitCode = 1;
