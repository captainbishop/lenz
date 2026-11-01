import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const files=['engine-access.test.mjs','engine-access.mjs','engine-journal.mjs','engine-journal.test.mjs','engine-signed.mjs','engine-submit-rpc.mjs','engine-receipt.mjs','engine-codec.mjs','engine-submission-fixtures.mjs'];
const contents=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(new URL(file,import.meta.url),'utf8')])));
const variants=[
  ['access-preflight','engine-journal.mjs',"preflight.state!=='permitted'",'false'],
  ['final-before-preflight','engine-journal.mjs','terminal.has(current.outcome.state)?current:{...current,preflight}','({...current,preflight})'],
  ['access-receiver','engine-access.mjs',"if(fc.receiver_id!==artifact.reference.engine)return blocked('receiver_not_permitted');",''],
  ['access-method','engine-access.mjs',"if(fc.method_names.length>0&&!fc.method_names.includes('call'))return blocked('method_not_permitted');",''],
  ['access-nonce','engine-access.mjs',"if(nonce<=BigInt(key.nonce))return blocked('nonce_used');",''],
  ['access-nonce-ceiling','engine-access.mjs',"if(nonce>=(ceiling>max?max:ceiling))return blocked('nonce_too_large');",''],
  ['access-allowance','engine-access.mjs',"if(fc.allowance==='0')return blocked('allowance_exhausted');",''],

  ['signature','engine-signed.mjs',"assert(verify(null,hash,key,signature),'Invalid signed transaction signature');",''],
  ['exact-arguments','engine-signed.mjs',"assert(args.equals(encodeCall({contract:ref.contract,value:BigInt(ref.value),input:Buffer.from(ref.input.slice(2),'hex')})),'Signed Engine arguments differ from the reviewed call');",''],
  ['default-status-only','engine-journal.mjs','!retry||!retryable(checked.outcome)','!retryable(checked.outcome)'],
  ['observed-before-first-send','engine-journal.mjs','row.attempts>0||row.observation','row.attempts>0'],
  ['latest-observation','engine-journal.mjs','if(!retryable(row.observation))return this.#summary(row);',''],
  ['concurrent-claim','engine-journal.mjs','WHERE id=? AND revision=?','WHERE id=? AND ?>=0'],
  ['durable-attempt','engine-journal.mjs','SET attempts=attempts+1, revision=revision+1','SET attempts=attempts, revision=revision+1'],
  ['preserve-final','engine-journal.mjs','if(terminal.has(current.observation?.state)){','if(false){'],
  ['operation-immutability','engine-journal.mjs',"if(old)assert(old.reference===ref&&old.signed===a.signedTxBase64,'This operation already has a different signed transaction');",'if(old){}'],
];
const run=directory=>spawnSync(process.execPath,['--test','--test-reporter=tap','engine-journal.test.mjs','engine-access.test.mjs'],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:30000});
const baseline=run(fileURLToPath(new URL('.',import.meta.url)));
assert.equal(baseline.error,undefined);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);assert.match(baseline.stdout,/# fail 0/);
const results=[];await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
for(const [name,file,from,to] of variants){
  assert.equal(contents[file].split(from).length,2,'Mutation must match once: '+name);
  const directory=await mkdtemp(new URL('./.testnet/submission-',import.meta.url));
  try{
    for(const f of files)await writeFile(join(directory,f),f===file?contents[f].replace(from,to):contents[f]);
    const result=run(directory);
    assert.equal(result.error,undefined);assert.equal(result.status,1,name+' survived');
    assert.match(result.stdout,/# fail [1-9]/);assert.match(result.stdout,/ERR_ASSERTION/);
    assert.doesNotMatch(result.stdout+result.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
    results.push({name,detected:true});console.log('PASS removed guard detected: '+name);
  }finally{
    assert.equal(dirname(directory),fileURLToPath(new URL('./.testnet',import.meta.url)));
    await rm(directory,{recursive:true,force:true});
  }
}
const sha=value=>createHash('sha256').update(value).digest('hex');
await writeFile(new URL('./engine-submission-mutations.json',import.meta.url),JSON.stringify({
  checkedAt:new Date().toISOString(),scope:'Local synthetic signed calls and SQLite failure/restart tests. No live chain submission.',
  sourceFiles:Object.fromEntries(files.map(f=>[f,sha(contents[f])])),results},null,2)+'\n');
