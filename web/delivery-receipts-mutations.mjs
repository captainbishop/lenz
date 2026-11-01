// Behavioral guard checks in disposable source copies; never modify the app.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const mutations=[
  ['exact file binding','payload.messageHash === await packetHash(original)','true'],
  ['wallet receipt scope',"if (financialOnly) assert(isNearPayment(original), 'Open this message receipt in Conversations.');",''],
  ['payment contract binding',"if (isNearPayment(original)) assert(nearContract && original.contract === nearContract, 'This receipt belongs to another network or contract.');",''],
  ['stored receipt verification','await checkReceipt(state, record, record.receivedReceipt);\n  return true;','return true;'],
];
const results=[];
for(const[guard,from,to]of mutations){
  const directory=await mkdtemp(join(tmpdir(),'lenz-delivery-mutation-'));assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  const copied=new Set();
  async function copy(file){
    if(copied.has(file))return;copied.add(file);let text=await readFile(new URL(file,import.meta.url),'utf8');
    if(file==='public/delivery-receipts.js'){assert(text.includes(from));text=text.replace(from,to);}
    await mkdir(dirname(join(directory,file)),{recursive:true});await writeFile(join(directory,file),text);
    for(const m of text.matchAll(/from ['"](\.[^'"]+)['"]/g)){const next=new URL(m[1],new URL(file,import.meta.url));await copy(decodeURIComponent(next.pathname.slice(new URL('./',import.meta.url).pathname.length)));}
  }
  try{
    await copy('delivery-receipts.test.mjs');
    const run=spawnSync(process.execPath,['--test','delivery-receipts.test.mjs'],{cwd:directory,encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(run.error,undefined);assert.notEqual(run.status,0,guard+' survived');assert(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(run.stdout+run.stderr));assert.match(run.stdout,/tests 8/);results.push({guard,rejected:true});
  }finally{await rm(directory,{recursive:true,force:true});}
}
await writeFile(new URL('delivery-receipts-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(`PASS ${results.length} removed receipt guards caused behavioral test failures.`);
