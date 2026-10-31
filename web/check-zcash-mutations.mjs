// Isolated temporary copies only; production source and native wallets are untouched.
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run=promisify(execFile),results=[];
for(const item of [
  {source:'./zcash-relay.mjs',test:'./zcash-relay.test.mjs',name:'origin',find:"req.headers.origin !== 'http://127.0.0.1:4173'",replace:'false'},
  {source:'../zcash/companion.mjs',test:'../zcash/companion.test.mjs',name:'network',find:"assert(info?.chain_name === 'test', 'Zcash server is not on testnet');",replace:'assert(true);'}
]){
  const source=new URL(item.source,import.meta.url),test=new URL(item.test,import.meta.url),text=await readFile(source,'utf8');
  assert(text.includes(item.find));
  const mutant=new URL(`./.zcash-${item.name}-mutant.mjs`,source),testFile=new URL(`./.zcash-${item.name}-mutant.test.mjs`,test);
  const originalImport=item.name==='origin'?'./zcash-relay.mjs':'./companion.mjs';
  try{
    await writeFile(mutant,text.replace(item.find,item.replace),{flag:'wx'});
    await writeFile(testFile,(await readFile(test,'utf8')).replace(originalImport,`./.zcash-${item.name}-mutant.mjs`),{flag:'wx'});
    let failure;
    try{await run(process.execPath,['--test','--test-reporter=tap',fileURLToPath(testFile)],{windowsHide:true,timeout:30000});}catch(e){failure=e;}
    assert.equal(failure?.code,1,'Removed guard survived its tests');assert.match(failure.stdout,/not ok/);
    results.push({guard:item.name,detected:true,output:failure.stdout});console.log('PASS removed '+item.name+' guard was detected');
  }finally{await unlink(testFile).catch(e=>{if(e.code!=='ENOENT')throw e;});await unlink(mutant).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
await writeFile(new URL('../zcash/companion-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),ok:true,results},null,2)+'\n');
