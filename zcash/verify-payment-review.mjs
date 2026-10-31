import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const execute=promisify(execFile),root=new URL('../',import.meta.url);
const json=async file=>JSON.parse(await readFile(new URL(file,root)));
const nativeFile='zcash/payment-review-native-after.json';
if(process.argv.includes('--capture-native')){
  const wallets={};
  for(const wallet of ['a','b']){
    wallets[wallet]={};
    for(const action of ['balance','transactions']){
      const r=await execute(process.execPath,[fileURLToPath(new URL('zcash/wallet.mjs',root)),action,wallet,'--no-save'],{windowsHide:true,timeout:75000});
      wallets[wallet][action]=JSON.parse(r.stdout);
    }
  }
  await writeFile(new URL(nativeFile,root),JSON.stringify({checkedAt:new Date().toISOString(),wallets,scope:'Local native balance/history reads after unsigned preparation and discard. No synchronization or broadcast.'},null,2)+'\n');
}
const native=await json(nativeFile),funded=await json('zcash/pczt-results.json'),live=await json('web/zcash-review-live-results.json'),fixture=await json('web/zcash-review-browser-results.json');
assert(live.ok&&fixture.ok);assert.equal(live.checks.length,5);assert.equal(fixture.checks.length,6);assert.deepEqual(live.errors,[]);
for(const wallet of ['a','b']){
  assert.equal(native.wallets[wallet].balance.balance.total,funded.after[wallet].balance.total);
  const old=funded.after[wallet].transactions.map(t=>t.txid).sort(),current=native.wallets[wallet].transactions.transactions.map(t=>t.txid).sort();
  assert.deepEqual(current,old);
}
assert(live.details.includes('Proposed change 0.8898 test ZEC'));
assert.equal(live.requests.filter(r=>r.url.endsWith('/review')).length,1);
assert.equal(live.requests.filter(r=>r.url.endsWith('/review-discard')).length,1);
assert(!live.requests.some(r=>/\/(send|sign|prove|refresh)$/.test(r.url)));
const node=await execute(process.execPath,['--test','--test-reporter=tap','zcash/payment-review.test.mjs','zcash/companion.test.mjs','web/zcash-relay.test.mjs','web/defi-relay.test.mjs'],{cwd:fileURLToPath(root),windowsHide:true,timeout:60000});
assert.match(node.stdout,/# fail 0/);const count=Number(node.stdout.match(/# tests (\d+)/)[1]);
await writeFile(new URL('zcash/payment-review-node-results.txt',root),node.stdout);
const files=[];for(const file of ['zcash/payment-review.mjs','web/zcash-relay.mjs','web/public/zcash-lab.html','web/public/zcash-lab.js','web/public/zcash-lab.css','web/public/chat-sw.js','web/zcash-review-live-results.json','web/zcash-review-browser-results.json',nativeFile])files.push({file,sha256:createHash('sha256').update(await readFile(new URL(file,root))).digest('hex')});
const result={checkedAt:new Date().toISOString(),ok:true,node:count,fixtureBrowser:fixture.checks.length,actualBrowser:live.checks.length,unchangedNativeBalances:true,noNewNativeTransactions:true,files,scope:'Unsigned review only. Local tests and saved live evidence; native reads run only with --capture-native. No signing or transaction submission.'};
await writeFile(new URL('zcash/payment-review-verification.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({ok:true,node:count,fixtureBrowser:fixture.checks.length,actualBrowser:live.checks.length,balancesUnchanged:true},null,2));
