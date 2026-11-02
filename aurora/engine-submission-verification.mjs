// Reproduce local acceptance evidence without chain access.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url)));
assert(pkg.scripts.test.startsWith('node --test '));
function run(args){
  const result=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  return result.stdout;
}
const files=['engine-transfer.mjs','engine-transfer.test.mjs','engine-transfer-evm.test.mjs','engine-transfer-cli.test.mjs','engine-transfer-fixtures.mjs','engine-transfer-mutations.mjs','engine-transfer-mutations.json','scripts/check-transfer.js','local-evm.mjs','compiler.mjs','engine-access.mjs','engine-access.test.mjs','engine-access-source.json','engine-signed.mjs','engine-journal.mjs','engine-submit-rpc.mjs','engine-receipt.mjs','engine-codec.mjs',
  'engine-journal.test.mjs','engine-submit-rpc.test.mjs','engine-submission-cli.test.mjs','engine-submission-sdk.test.mjs',
  'engine-submission-fixtures.mjs','scripts/engine-submission.js','engine-submission-mutations.mjs',
  'engine-submission-mutations.json','engine-receipt-mutations.mjs','engine-receipt-mutations.json',
  'engine-submission-verification.mjs','engine-submission-source.json','package.json','package-lock.json','../contracts/package-lock.json'];
const shaFile=async file=>createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
const before={};
for(const file of files)if(!file.endsWith('-mutations.json'))before[file]=await shaFile(file);
const results=[];
for(const [name,files] of [['aurora',pkg.scripts.test.slice('node --test '.length).split(' ')],['near-sdk',['engine-submission-sdk.test.mjs']]]){
  const output=run(['--test','--test-reporter=tap',...files]);
  const count=Number(output.match(/^# tests (\d+)$/m)?.[1]);
  assert(count>0);assert.match(output,/^# fail 0$/m);assert.match(output,/^# cancelled 0$/m);assert.match(output,/^# skipped 0$/m);
  results.push({name,passed:count,failed:0});console.log(name+': '+count+' passed');
}
for(const file of ['engine-submission-mutations.mjs','engine-receipt-mutations.mjs','engine-transfer-mutations.mjs'])console.log(run([file]).trim());
const sourceFiles={};
for(const file of files){
  sourceFiles[file]=await shaFile(file);
  if(Object.hasOwn(before,file))assert.equal(sourceFiles[file],before[file],'Verification input changed while tests ran: '+file);
}
const sdk=JSON.parse(await readFile(new URL('../contracts/node_modules/near-api-js/package.json',import.meta.url)));
assert.equal(sdk.version,'7.4.0');
await writeFile(new URL('./engine-submission-results.json',import.meta.url),JSON.stringify({
  checkedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,nearApiJs:sdk.version,
  scope:'Local SQLite, child-process interruption, synthetic signed calls/NEAR receipts, actual local EVM token execution and loopback HTTP. No live transaction or wallet changes.',
  results,sourceFiles},null,2)+'\n');
