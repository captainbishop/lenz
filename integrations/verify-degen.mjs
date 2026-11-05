import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),test='integrations/degen-discovery.test.mjs';
const files=['web/public/degen-model.js','integrations/degen-discovery.mjs','web/degen-relay.mjs',test,'integrations/degen-fixtures.mjs','integrations/verify-degen.mjs','integrations/chart-intervals.test.mjs','integrations/market-tape.mjs','web/public/market-tape.js','integrations/market-tape-fixtures.mjs','web/degen-history.mjs','web/degen-history.test.mjs','web/public/chart-indicators.js','web/chart-indicators.test.mjs','integrations/chart-analysis.mjs','integrations/chart-analysis.test.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(new URL(file,root))).digest('hex')]))),sourceHashes=await hashes();
const mutations=[
 ['chain identity',files[0],'LENZ_DEGEN_MODEL_MODULE','`${row.chain.id}/${addressKey(row.address)}`','`${addressKey(row.address)}`'],
 ['read-only observations',files[0],'LENZ_DEGEN_MODEL_MODULE','value?.executable===false&&Object.hasOwn','Object.hasOwn'],
 ['request fields',files[0],'LENZ_DEGEN_MODEL_MODULE','Object.keys(value).length===fields.length&&',''],
 ['positive candle prices',files[0],'LENZ_DEGEN_MODEL_MODULE','&&result.low>0',''],
 ['candle token identity',files[1],'LENZ_DEGEN_READER_MODULE','&&addressKey(rows[0].address)===addressKey(request.address)',''],
 ['same-origin access',files[2],'LENZ_DEGEN_RELAY_MODULE','||req.headers.origin!==`http://${req.headers.host}`',''],
 ['trade token',files[1],'LENZ_DEGEN_READER_MODULE','(to===address)!==(from===address)','true'],
 ['trade direction',files[1],'LENZ_DEGEN_READER_MODULE','t.kind===side','true'],
 ['conflicting trade events',files[1],'LENZ_DEGEN_READER_MODULE','JSON.stringify(events.get(row.id))===JSON.stringify(row)','true'],
 ['trade amount',files[0],'LENZ_DEGEN_MODEL_MODULE','amount>0&&usd!==null','usd!==null'],
 ['provider rate budget',files[2],'LENZ_DEGEN_RELAY_MODULE',"request.provider==='geckoterminal'?24:40","request.provider==='geckoterminal'?240:40"],
];
const run=(env={})=>spawnSync(process.execPath,['--test',... [test,'integrations/chart-intervals.test.mjs','web/degen-history.test.mjs','web/chart-indicators.test.mjs','integrations/chart-analysis.test.mjs'].map(f=>new URL(f,root).pathname.replace(/^\/([A-Za-z]:)/,'$1'))],{env:{...process.env,...env},windowsHide:true,encoding:'utf8',timeout:30000});
const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);const count=Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)?.[1]);assert(count>0);
const directory=await mkdtemp(join(tmpdir(),'lenz-degen-guards-')),module=join(directory,'mutant.mjs'),results=[];
try{
 for(const [guard,file,variable,before,after]of mutations){
  const original=await readFile(new URL(file,root),'utf8');assert.equal(original.split(before).length,2,guard);
  const source=original.replace(before,after).replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(path,new URL(file,root)).href}${quote}`);
  await writeFile(module,source);const result=run({[variable]:pathToFileURL(module).href});assert.notEqual(result.status,0,'Undetected guard: '+guard);assert.match(result.stdout+result.stderr,/AssertionError/,'Non-assertion failure: '+guard);results.push({guard,detected:true});
 }
 assert.deepEqual(await hashes(),sourceHashes);
 const report={checkedAt:new Date().toISOString(),tests:count,passed:count,failed:0,guardAlterations:results.length,results,sourceHashes,scope:'Synthetic discovery, intervals, public history in SQLite, indicator math, AI adapter boundaries and real local HTTP. NEAR AI uses an injected SDK fixture; no live inference, financial execution or user account access.'};
 await writeFile(new URL('integrations/degen-verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:count,guardAlterations:results.length}));
}finally{await unlink(module).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}
