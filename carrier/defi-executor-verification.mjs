import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['carrier/defi-executor.mjs','carrier/defi-executor-verification.mjs','carrier/defi-inbox.mjs','carrier/server.mjs','carrier/store.mjs',
  'contracts/defi-executor-client.mjs','contracts/defi-result-client.mjs','contracts/defi-executor.test.mjs','contracts/client.mjs',
  'integrations/near-network.mjs','web/public/defi-request.js','web/public/peer-crypto.js','web/public/profile-display.js',
  'web/public/carrier-protocol.js','web/public/near-protocol.js','web/public/rhea-protocol.js','web/public/near-deposit.js'];
const contents=Object.fromEntries(await Promise.all(files.map(async f=>[f,await readFile(join(root,f),'utf8')])));
const run=directory=>{
  const r=spawnSync(process.execPath,['--test','--test-reporter=tap','contracts/defi-executor.test.mjs'],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  assert.equal(r.error,undefined);assert.doesNotMatch(r.stdout+r.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);return r;
};
const baseline=run(root);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
assert.match(baseline.stdout,/^# fail 0$/m);assert.match(baseline.stdout,/^# skipped 0$/m);
const passed=Number(baseline.stdout.match(/^# tests (\d+)$/m)?.[1]);assert(passed>0);console.log('Executor: '+passed+' passed');
const worker='carrier/defi-executor.mjs',client='contracts/defi-executor-client.mjs',recipient='contracts/defi-result-client.mjs';
const variants=[
  ['final-report',worker,'WHERE excluded.height>=reports.height AND excluded.terminal>=reports.terminal','WHERE 1=1','unavailable and stale'],
  ['final-dispatch',worker,'return !!known &&','return false &&','a saved final state'],
  ['duplicate-step',worker,'[id,observation.step,observation.call]','[id,observation.step,observation.call,crypto.randomUUID()]','unresolved attempt'],
  ['signing-expiry',worker,"assert(this.#now()<request.expiresAt,'DeFi approval expired before broadcast');",'','approval expiring'],
  ['durable-reference',client,'await record({sender:account.accountId,txHash});','', 'real SDK dispatch'],
  ['funded-root',client,"assert.deepEqual(state.root,p.root,'Unrecognized funded reserve root');",'', 'code hash, chain'],
  ['code-pin',client,"assert.equal((await rpc.viewAccount({accountId,blockQuery})).code_hash,expected,'Contract code changed');","await rpc.viewAccount({accountId,blockQuery});",'code hash, chain'],
  ['payer-authority',client,"assert(!expected.payer || expected.payer===account.accountId,'The refund payer must sign its own deposit');",'','refund absent'],
  ['finality',client,"assert(tx.final_execution_status==='FINAL','Transaction is not final');",'','receipt checks reject'],
  ['receipt-arguments',client,"assert.deepEqual(JSON.parse(Buffer.from(a.args,'base64').toString('utf8')),expected.args,'Different transaction arguments');",'','receipt checks reject'],
  ['signed-bytes',client,"assert(Buffer.from(encodeTransaction(signed.signedTransaction.transaction)).equals(unsigned),'Signer changed the approved transaction');",'','a signer replacing'],
  ['recipient-independent-read',recipient,'await observe(structuredClone(checked.operation))','claimed.observation','recipient checks use independent'],
  ['recipient-request-binding',recipient,"&&claimed.requestId===checked.id","",'recipient rejects foreign'],
  ['recipient-report-time',recipient,'claimed.checkedAt>=checked.createdAt&&claimed.checkedAt<=now+60000','true','recipient rejects foreign'],
  ['recipient-finality',recipient,"observation?.finality==='FINAL'&&","",'recipient rejects foreign'],
  ['recipient-known-state',recipient,"assert(['observed','pending','ready','conflicted','needs_review'].includes(observation.state),'Invalid independent result state');","",'recipient rejects foreign'],
  ['recipient-unavailable',recipient,"state:'unverified',observation:null","state:claimed.state,observation:claimed.observation",'recipient checks use independent'],
  ['recipient-expired-recovery',recipient,'executor,request,request.createdAt','executor,request,now','recipient recovery remains','DeFi request expired or has invalid timing'],
];
const parent=join(root,'contracts','.testnet');await mkdir(parent,{recursive:true});const mutations=[];
for(const [name,file,from,to,expected,diagnostic='ERR_ASSERTION'] of variants) {
  assert.equal(contents[file].split(from).length,2,'Unique mutation: '+name);
  const directory=await mkdtemp(join(parent,'defi-verification-'));
  try {
    for(const f of files){const path=join(directory,f);await mkdir(dirname(path),{recursive:true});await writeFile(path,f===file?contents[f].replace(from,to):contents[f]);}
    const r=run(directory);assert.equal(r.status,1,name+' survived');
    const failed=[...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]);assert(failed.some(t=>t.startsWith(expected)),name+' did not fail the expected test: '+r.stdout);
    assert.match(r.stdout,new RegExp(diagnostic));mutations.push({name,detected:true,failedTests:failed});console.log('Detected '+name);
  } finally {assert.equal(dirname(directory),parent);await rm(directory,{recursive:true,force:true});}
}
const sha=b=>createHash('sha256').update(b).digest('hex'),sourceFiles={};
for(const f of files){sourceFiles[f]=sha(await readFile(join(root,f)));assert.equal(sourceFiles[f],sha(contents[f]),'Source changed: '+f);}
sourceFiles['contracts/package-lock.json']=sha(await readFile(join(root,'contracts/package-lock.json')));
const sdk=JSON.parse(await readFile(join(root,'contracts/node_modules/near-api-js/package.json')));assert.equal(sdk.version,'7.4.0');
await writeFile(join(root,'carrier/defi-executor-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),node:process.version,nearApiJs:sdk.version,
  scope:'Real P-256 encryption, NEAR SDK signing, SQLite and local HTTP. Synthetic funded roots and chain/receipt responses; no live transaction or wallet changes.',
  tests:{passed,failed:0,skipped:0},mutations,sourceFiles},null,2)+'\n');
