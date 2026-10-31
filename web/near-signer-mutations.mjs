import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=path.resolve(fileURLToPath(new URL('./',import.meta.url))),base=await mkdtemp(path.join(here,'.signer-mutation-'));
const source=await readFile(path.join(here,'public/near-signer.js'),'utf8');
const guards=[['network and reserve',"  assert(config.network ==="],['refund recipient and amount',"  assert(request.payer ==="],['NEAR signer',"  assert(accounts?.length === 1 && accounts[0].accountId ==="]];
const results=[];
try{
  await mkdir(path.join(base,'public'));for(const file of ['peer-crypto.js','profile-display.js','near-deposit.js','near-protocol.js'])await cp(path.join(here,'public',file),path.join(base,'public',file));
  await cp(path.join(here,'near-signer.test.mjs'),path.join(base,'near-signer.test.mjs'));
  for(const [name,prefix]of guards){const line=source.split('\n').find(s=>s.startsWith(prefix));if(!line)throw Error('Guard not found: '+name);
    await writeFile(path.join(base,'public/near-signer.js'),source.replace(line,''));
    const r=spawnSync(process.execPath,['--test',path.join(base,'near-signer.test.mjs')],{encoding:'utf8',timeout:30000});
    if(r.error||!r.stdout.includes('Missing expected rejection')||r.status===0)throw Error('Mutation did not fail the expected assertion: '+name+'\n'+r.stdout+'\n'+r.stderr);
    results.push({guard:name,detected:true});console.log('DETECTED '+name);
  }
  await writeFile(path.join(here,'near-signer-mutation-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),detected:results.length,results,scope:'Independent copies; removed guards must cause a missing-rejection assertion. Product sources are never mutated.'},null,2)+'\n');
}finally{
  const resolved=path.resolve(base);if(path.dirname(resolved)!==here||!path.basename(resolved).startsWith('.signer-mutation-'))throw Error('Unsafe cleanup path');await rm(resolved,{recursive:true});
}
