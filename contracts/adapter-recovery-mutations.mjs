import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=fileURLToPath(new URL('./',import.meta.url)),base=await mkdtemp(path.join(here,'.receipt-mutation-'));
const source=await readFile(path.join(here,'adapter-recovery.mjs'),'utf8'),test=await readFile(path.join(here,'adapter-recovery.test.mjs'),'utf8');
const guards=[['finality',"  assert(tx.final_execution_status==='FINAL','Transaction is not final');",''],['transaction identity',"  assert(t?.hash===ref.txHash && t.signer_id===ref.sender && t.receiver_id===c.adapter,'Different transaction identity');",''],['swap action',"if(ref.method!=='submit')assert.deepEqual(args,{id},'Different swap action');","if(ref.method!=='submit'){}"],['receipt summary',"  assert.deepEqual(tx.status,returned.outcome.status,'Transaction summary differs from return receipt');",'']];
const results=[];
try{
  await writeFile(path.join(base,'test.mjs'),test.replaceAll("'./adapter-client.mjs'","'../adapter-client.mjs'").replaceAll("'./adapter/fixtures/browser-swap.json'","'../adapter/fixtures/browser-swap.json'").replaceAll("'./adapter/recovery-live-results.json'","'../adapter/recovery-live-results.json'"));
  for(const [name,guard,replacement] of guards){
    if(!source.includes(guard))throw Error('Guard missing: '+name);
    await writeFile(path.join(base,'adapter-recovery.mjs'),source.replace(guard,replacement).replace("'./client.mjs'","'../client.mjs'").replace("'../web/public/rhea-protocol.js'","'../../web/public/rhea-protocol.js'"));
    const r=spawnSync(process.execPath,['--test',path.join(base,'test.mjs')],{encoding:'utf8',timeout:30000});
    if(r.error||r.status===0||!r.stdout.includes('Missing expected exception'))throw Error('Mutation did not fail the intended assertion: '+name+'\n'+r.stdout+'\n'+r.stderr);
    results.push({guard:name,detected:true});console.log('DETECTED '+name);
  }
  await writeFile(path.join(here,'adapter/recovery-mutation-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),detected:results.length,results,scope:'Independent source copies. Removed receipt guards must produce missing-exception assertions.'},null,2)+'\n');
}finally{const resolved=path.resolve(base);if(path.dirname(resolved)!==path.resolve(here)||!path.basename(resolved).startsWith('.receipt-mutation-'))throw Error('Unsafe cleanup path');await rm(resolved,{recursive:true});}
