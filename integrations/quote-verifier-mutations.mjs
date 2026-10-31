import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=fileURLToPath(new URL('./',import.meta.url)),base=await mkdtemp(path.join(here,'.quote-mutation-'));
const source=await readFile(path.join(here,'intents.mjs'),'utf8'),tests=await readFile(path.join(here,'quotes.test.mjs'),'utf8');
const guards=[['signature',"  require(verifySignature(result) === true, 'Invalid 1Click quote signature');"],['freshness',"  require(Number.isFinite(timestamp) && timestamp >= now - 5 * 60000 && timestamp <= now + 30000, 'Quote timestamp is missing, stale or too far in the future');"]];
const results=[];
try{
  await writeFile(path.join(base,'quotes.test.mjs'),tests.replace("'./rhea.mjs'","'../rhea.mjs'").replaceAll("'./quote-verifier/","'../quote-verifier/"));
  for(const [name,guard] of guards){
    if(!source.includes(guard))throw Error('Missing guard: '+name);
    await writeFile(path.join(base,'intents.mjs'),source.replace(guard,'').replace("'./quote-verifier/","'../quote-verifier/"));
    const run=spawnSync(process.execPath,['--test',path.join(base,'quotes.test.mjs')],{encoding:'utf8',timeout:30000});
    if(run.error||run.status===0||!run.stdout.includes('Missing expected rejection'))throw Error('Mutation failed for an unexpected reason: '+name+'\n'+run.stdout+'\n'+run.stderr);
    results.push({guard:name,detected:true});console.log('DETECTED '+name);
  }
  await writeFile(path.join(here,'quote-verifier/mutation-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),detected:results.length,results,scope:'Independent source copies. Original tests pass; each removed guard causes a missing-rejection assertion.'},null,2)+'\n');
}finally{
  if(path.dirname(path.resolve(base))!==path.resolve(here)||!path.basename(base).startsWith('.quote-mutation-'))throw Error('Unsafe cleanup path');
  await rm(base,{recursive:true});
}
