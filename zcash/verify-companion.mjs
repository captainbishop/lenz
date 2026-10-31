// Local tests plus saved evidence verification. No native wallet command or network call.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url),run=promisify(execFile),json=async file=>JSON.parse(await readFile(new URL(file,root)));
const args=['--test','--test-reporter=tap','zcash/companion.test.mjs','web/zcash-relay.test.mjs','web/defi-relay.test.mjs'];
const node=await run(process.execPath,args,{cwd:fileURLToPath(root),windowsHide:true,timeout:60000});
assert.match(node.stdout,/# fail 0/);const nodeCount=Number(node.stdout.match(/# tests (\d+)/)[1]);
await writeFile(new URL('zcash/companion-node-results.txt',root),node.stdout);
const browser=[];
for(const file of ['web/zcash-browser-results.json','web/offline-social-browser-results.json','web/security-upgrade-results.json']){const report=await json(file);assert.equal(report.failed,0);browser.push({file,passed:report.passed});}
const live=await json('web/zcash-companion-live-results.json');assert.equal(live.ok,true);assert.equal(live.refresh,true);assert.equal(live.checks.length,5);assert.deepEqual(live.errors,[]);
for(const wallet of ['a','b']){
  for(const refresh of [false,true]){const r=live.responses.find(r=>r.wallet===wallet&&r.refresh===refresh);assert.equal(r?.status,200);assert.equal(r.body.network,'testnet');assert.equal(r.body.canSend,false);assert.equal(r.body.refreshed,refresh);}
}
const funded=live.responses.find(r=>r.wallet==='a'&&r.refresh).body;assert.equal(funded.amounts.total,'100000000');assert.equal(funded.amounts.ironwood_spendable,'100000000');
const txs=await json('zcash/transactions-a-results.json');assert.equal(txs.ok,true);assert.equal(txs.network,'test');assert(txs.transactions.some(t=>t.txid==='3b08a1472e873eb0c665e707cfec37416b230b652d582fd8dddd29ac858b749e'&&t.minedHeight===4542640));
const mutations=await json('zcash/companion-mutations.json');assert.equal(mutations.ok,true);assert.equal(mutations.results.length,2);assert(mutations.results.every(r=>r.detected));
const staticCheck=await run(process.execPath,['web/verify-chat-static.mjs'],{cwd:fileURLToPath(root),windowsHide:true,timeout:30000});assert.match(staticCheck.stdout,/44 chat cache routes/);
const files=[];
for(const file of ['zcash/companion.mjs','zcash/wallet.mjs','web/zcash-relay.mjs','web/server.mjs','web/public/zcash-lab.html','web/public/zcash-lab.js','web/public/zcash-lab.css','web/public/chat-sw.js','zcash/source-lock.json','zcash/transactions-a-results.json','zcash/companion-node-results.txt','zcash/companion-mutations.json','web/zcash-companion-live-results.json','web/zcash-companion-live-first-failure.json','web/zcash-companion-live-second-failure.json',...browser.map(r=>r.file)])files.push({file,sha256:createHash('sha256').update(await readFile(new URL(file,root))).digest('hex')});
const report={checkedAt:new Date().toISOString(),ok:true,node:{passed:nodeCount,command:'node '+args.join(' ')},browser,actualNativeBrowser:{passed:live.checks.length,completedAt:live.completedAt},mutations:2,cacheRoutes:44,funding:{wallet:'a',zatoshis:'100000000',spendablePool:'Ironwood',source:'Unknown; previous faucet failures preserved'},limits:['No outgoing Zcash transaction or offline PCZT signing/proving','Developer companion wallets are separate from Lenz browser identity','Two initial browser update failures remain unexplained; later direct/native/browser runs passed','No private NEAR settlement, deployed Aurora route, safe recovery or phone certification'],files};
await writeFile(new URL('zcash/companion-verification.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,node:nodeCount,browser:browser.reduce((sum,r)=>sum+r.passed,0),actualNativeBrowser:live.checks.length,mutations:2,cacheRoutes:44},null,2));
