// Verify this change's saved browser evidence and current local wallet invariants.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const execute=promisify(execFile),root=new URL('../',import.meta.url);
const json=async file=>JSON.parse(await readFile(new URL(file,root)));
const live=await json('web/zcash-freshness-live-results.json'),fixture=await json('web/zcash-freshness-browser-results.json');
assert(live.ok&&fixture.ok);assert.equal(live.checks.length,6);assert.equal(fixture.checks.length,8);assert.deepEqual(live.errors,[]);
assert.equal(live.networkChecks.length,1);assert.equal(live.networkChecks[0].status,'expired');
assert(live.networkChecks[0].serverHeight>=live.networkChecks[0].expiryHeight);
assert.equal(live.requests.filter(x=>x.url.endsWith('/review')).length,1);
assert.equal(live.requests.filter(x=>x.url.endsWith('/review-check')).length,1);
assert.equal(live.requests.filter(x=>x.url.endsWith('/review-discard')).length,1);
assert(!live.requests.some(x=>/\/(sign|send|prove|refresh)$/.test(x.url)));
const prior=await json('zcash/payment-review-native-after.json'),wallets={};
for(const wallet of ['a','b']){
  wallets[wallet]={};
  for(const action of ['balance','transactions']){
    const {stdout}=await execute(process.execPath,[fileURLToPath(new URL('zcash/wallet.mjs',root)),action,wallet,'--no-save'],{windowsHide:true,timeout:75000});
    wallets[wallet][action]=JSON.parse(stdout);
  }
  assert.deepEqual(wallets[wallet].balance.balance,prior.wallets[wallet].balance.balance);
  assert.deepEqual(wallets[wallet].transactions.transactions,prior.wallets[wallet].transactions.transactions);
}
const journal=await json('zcash/.testnet/payment-review/current.json');assert.equal(journal.state,'discarded');assert.equal(journal.freshness.status,'expired');
const files=[];
for(const file of ['zcash/payment-freshness.mjs','zcash/payment-review.mjs','zcash/review-inspector/src/main.rs','zcash/review-inspector/Cargo.lock','web/zcash-relay.mjs','web/public/zcash-lab.html','web/public/zcash-lab.js','web/public/chat-sw.js','web/zcash-freshness-live-results.json','web/zcash-freshness-browser-results.json'])files.push({file,sha256:createHash('sha256').update(await readFile(new URL(file,root))).digest('hex')});
const result={checkedAt:new Date().toISOString(),ok:true,actualBrowser:live.checks.length,fixtureBrowser:fixture.checks.length,observed:live.networkChecks[0],unchangedWallets:true,noNewNativeTransactions:true,discarded:true,files,
  scope:'One actual unsigned payment review; read-only provider height and local wallet observations. Local balance/history reads confirm no changes. No signatures, proofs, submissions, synchronization or user browser identity access.'};
await writeFile(new URL('zcash/payment-freshness-verification.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
