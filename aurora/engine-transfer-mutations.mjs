import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const files=['engine-transfer.mjs','engine-transfer.test.mjs','engine-transfer-fixtures.mjs','engine-submission-fixtures.mjs','engine-codec.mjs','engine-receipt.mjs'];
const contents=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(new URL(file,import.meta.url),'utf8')])));
const variants=[
  ['execution-success',"if(execution.state!=='evm_succeeded')return result('unconfirmed',execution.state);",''],
  ['canonical-true',"if(execution.evm.output!==TRUE)return result('unverified','unsupported_return');",''],
  ['exact-calldata',"assert(ref.input.toLowerCase()===calldata,'Different transfer calldata');",''],
  ['engine-caller',"assert(nearImplicitAddress(ref.sender)===p.from,'Different Engine caller');",''],
  ['token-and-value',"assert(ref.contract.toLowerCase()===p.token&&ref.value==='0','Different token or attached EVM value');",''],
  ['single-transfer','transfers.length!==1','transfers.length===0'],
  ['event-emitter','log.address!==p.token||',''],
  ['event-sender','log.topics[1]!==word(p.from)||',''],
  ['event-recipient','log.topics[2]!==word(p.to)||',''],
  ['event-amount','||log.data!==amount',''],
  ['expectation-snapshot','const p={...payment};','const p=payment;'],
];
const run=directory=>spawnSync(process.execPath,['--test','--test-reporter=tap','engine-transfer.test.mjs'],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:20000});
const baseline=run(fileURLToPath(new URL('.',import.meta.url)));
assert.equal(baseline.error,undefined);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);assert.match(baseline.stdout,/# fail 0/);
const results=[];await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
for(const [name,from,to] of variants){
  const source=contents['engine-transfer.mjs'];assert.equal(source.split(from).length,2,'Mutation must match once: '+name);
  const directory=await mkdtemp(new URL('./.testnet/transfer-',import.meta.url));
  try{
    for(const f of files)await writeFile(join(directory,f),f==='engine-transfer.mjs'?source.replace(from,to):contents[f]);
    const result=run(directory);assert.equal(result.error,undefined);assert.equal(result.status,1,name+' survived');
    assert.match(result.stdout,/# fail [1-9]/);assert.match(result.stdout,/ERR_ASSERTION/);
    assert.doesNotMatch(result.stdout+result.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
    results.push({name,detected:true});console.log('PASS transfer guard alteration detected: '+name);
  }finally{
    assert.equal(dirname(directory),fileURLToPath(new URL('./.testnet',import.meta.url)));
    await rm(directory,{recursive:true,force:true});
  }
}
const sha=value=>createHash('sha256').update(value).digest('hex');
await writeFile(new URL('./engine-transfer-mutations.json',import.meta.url),JSON.stringify({
  checkedAt:new Date().toISOString(),scope:'Synthetic Engine receipts and independent ethers ABI encodings. No live submission.',
  sourceFiles:Object.fromEntries(files.map(f=>[f,sha(contents[f])])),results},null,2)+'\n');
