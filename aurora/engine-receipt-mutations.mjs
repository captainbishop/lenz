import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source=await readFile(new URL('./engine-receipt.mjs',import.meta.url),'utf8');
const tests=await readFile(new URL('./engine-receipt.test.mjs',import.meta.url),'utf8');
const codec=await readFile(new URL('./engine-codec.mjs',import.meta.url),'utf8');
const variants=[
  ['finality',"assert(tx.final_execution_status==='FINAL','Unknown execution finality');",''],
  ['exact-call','call.args===args','true'],
  ['direct-return-child','outcome.receipt_ids.includes(status[key])','byId.has(status[key])'],
  ['summary-match',"assert.deepEqual(tx.status,returned.outcome.status,'Summary differs from return outcome');",''],
  ['failed-side-receipt',"failedReceiptIds.length?'needs_review':'evm_succeeded'","'evm_succeeded'"],
  ['evm-revert',"!evm.succeeded?'evm_failed':",''],
  ['reference-snapshot','const ref={...reference};','const ref=reference;'],
  ['receipt-completeness',"assert(visited.size===receipts.length,'Unrelated receipt outcome');",''],
];
const run=directory=>spawnSync(process.execPath,['--test','engine-receipt.test.mjs'],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:20000});
const baseline=run(fileURLToPath(new URL('.',import.meta.url)));
assert.equal(baseline.error,undefined);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);assert.match(baseline.stdout,/fail 0/);
const results=[];await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
for(const [name,from,to] of variants){
  assert.equal(source.split(from).length,2,'Mutation must match once: '+name);
  const directory=await mkdtemp(new URL('./.testnet/receipt-',import.meta.url));
  try{
    await writeFile(join(directory,'engine-receipt.mjs'),source.replace(from,to));
    await writeFile(join(directory,'engine-receipt.test.mjs'),tests);await writeFile(join(directory,'engine-codec.mjs'),codec);
    const result=run(directory);assert.equal(result.error,undefined);assert.equal(result.status,1,`${name} survived`);
    assert.match(result.stdout,/fail [1-9]/);assert.match(result.stdout,/ERR_ASSERTION/);assert.doesNotMatch(result.stdout+result.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
    results.push({name,detected:true});console.log('PASS removed guard detected: '+name);
  }finally{
    assert.equal(dirname(directory),fileURLToPath(new URL('./.testnet',import.meta.url)));
    await rm(directory,{recursive:true,force:true});
  }
}
const sha=value=>createHash('sha256').update(value).digest('hex');
await writeFile(new URL('./engine-receipt-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),
  scope:'Synthetic NEAR/Engine receipt fixtures and loopback HTTP transport; no live Aurora transaction.',
  sourceSha256:sha(source),testSha256:sha(tests),codecSha256:sha(codec),results},null,2)+'\n');
