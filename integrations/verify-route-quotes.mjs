import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{run:browser}=require('../web/route-drafts-browser.test.cjs');
const root=new URL('../',import.meta.url),file='web/public/defi-route-quote.js',test='integrations/route-quotes.test.mjs',draftFile='web/public/defi-route-drafts.js';
const mutations=[
 ['private policy',"objective.privacy==='transparent'",'true'],
 ['funding/return boundary','objective.source.asset.chainId===d.chainId&&objective.returnTo===null','true'],
 ['asset binding','sameAsset(objective.source.asset,tokens[r.inputSymbol])&&sameAsset(d.outputAsset,tokens[r.outputSymbol])','true'],
 ['amount binding','objective.source.amount===r.inputUnits','true'],
 ['minimum output','BigInt(r.minOutputUnits)>=BigInt(objective.limits.minReceive)','true'],
 ['order precision','o.sizeDecimals===r.sizeDecimals&&o.priceDecimals===6','true'],
 ['order terms','o.instrument===r.instrument&&o.side===quote.request.side&&o.size===r.sizeUnits','true'],
 ['order price limit',"o.side==='buy'?worst<=limit:worst>=limit",'true'],
 ['future observation','quote.observedAt>=0&&quote.observedAt<=now','true'],
 ['quote size bound','JSON.stringify(value).length<=16384','true'],
];
const browserMutations=[
 ['immutable objective ID','same(existing.objective,objective)','true','two tabs'],
 ['quote revision','row&&row.revision===expectedRevision','row','two tabs'],
 ['objective expiry before commit','Date.now()<objective.limits.deadline','true','expiry during'],
 ['quote expiry before commit','Date.now()<match.expiresAt','true','expiry during'],
 ['identity-bound encryption',"bytes(['lenz/route-drafts/v1',s.identity.profile.id])","bytes(['lenz/route-drafts/v1'])",'ciphertext corruption'],
];
const directory=await mkdtemp(join(tmpdir(),'lenz-route-quote-')),results=[],hashes={};
const execute=env=>spawnSync(process.execPath,['--test',fileURLToPath(new URL(test,root))],{cwd:fileURLToPath(root),env:{...process.env,...env},encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024,timeout:15000});
try{
 const source=await readFile(new URL(file,root),'utf8'),draftSource=await readFile(new URL(draftFile,root),'utf8');
 for(const f of [file,test,draftFile,'integrations/route-quote-fixtures.mjs','web/public/defi-route-plan.js','web/route-drafts-browser.test.cjs','web/public/chat-store.js','web/public/market-quote.js'])hashes[f]=createHash('sha256').update(await readFile(new URL(f,root))).digest('hex');
 const baseline=execute({});assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);const tests=Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)?.[1]);assert(tests>0);const browserReport=await browser();
 for(const [guard,from,to]of mutations){
  assert.equal(source.split(from).length,2,guard);const mutant=source.replace(from,to).replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,new URL(file,root)).href}${q}`),module=join(directory,'mutant.mjs');await writeFile(module,mutant);
  const r=execute({LENZ_ROUTE_QUOTE_MODULE:module});assert.notEqual(r.status,0,`Undetected guard: ${guard}`);assert.match(r.stdout+r.stderr,/AssertionError/,`Missing assertion failure: ${guard}\n${r.stdout}${r.stderr}`);results.push({guard,detected:true});
 }
 for(const [guard,from,to,filter]of browserMutations){
  assert.equal(draftSource.split(from).length,2,guard);let error;
  try{await browser({draftSource:draftSource.replace(from,to),filter,record:false});}catch(e){error=e;}
  assert(error&&error.code==='ERR_ASSERTION',`Undetected browser guard: ${guard}: ${error?.message}`);results.push({guard,detected:true});
 }
 for(const [f,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(await readFile(new URL(f,root))).digest('hex'),hash,`Changed during checks: ${f}`);
 const report={checkedAt:new Date().toISOString(),tests,browserTests:browserReport.passed,guardAlterations:results.length,results,overlappingGuard:{guard:'provider binding',independentlyDetected:false,reason:'Removing the early provider guard still rejects the mismatch at the provider-specific chain/action and asset/order guards.'},sourceHashes:hashes,scope:'Fixture binding and disposable encrypted browser-service checks. No signed quote authentication, product draft control, financial action or production readiness claim.'};
 await writeFile(new URL('integrations/route-quotes-verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await unlink(join(directory,'mutant.mjs')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
