import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const groups={
 discovery:['integrations/market-discovery.mjs','integrations/market-discovery.test.mjs','LENZ_DISCOVERY_MODULE'],
 snapshot:['web/public/market-snapshot.js','web/market-snapshot.test.mjs','LENZ_SNAPSHOT_MODULE'],
 match:['web/public/defi-market-match.js','web/defi-market-match.test.mjs','LENZ_MATCH_MODULE'],
 relay:['web/market-relay.mjs','web/market-relay.test.mjs','LENZ_RELAY_MODULE'],
};
const mutations=[
 ['discovery','chain',"await rpc('eth_chainId',[])==='0x2105'","true"],
 ['discovery','canonical tag','requireCanonical:true','requireCanonical:false'],
 ['discovery','finalized age','timestamp>=clock()-(recent?60000:3600000)','true'],
 ['discovery','canonical recheck','current?.hash===block.hash','true'],
 ['discovery','token precision',"Number((await call(token.id,'decimals'))[0])===token.decimals",'true'],
 ['discovery','pool identity','fee[0]===500n','true'],
 ['discovery','reserve membership','reserves.includes(token.id)','true'],
 ['discovery','reserve precision','Number((bits>>48n)&255n)===token.decimals','true'],
 ['discovery','reserve pause flag','paused:flag(60)','paused:false'],
 ['discovery','context alignment','contexts.length===universe.length','true'],
 ['discovery','read-only envelope','expiresAt:observedAt+60000,executable:false','expiresAt:observedAt+60000,executable:true'],
 ['discovery','approved destination','[MARKET_READS.baseRpc,MARKET_READS.hyperliquid].includes(url)','true'],
 ['snapshot','envelope authority',"value.kind==='market-observation'&&value.executable===false","value.kind==='market-observation'"],
 ['snapshot','maximum observation age','value.expiresAt<=value.observedAt+60000','true'],
 ['snapshot','saved-data label',"if(saved||!online)return 'Saved data';",''],
 ['match','exact asset precision','&&a.decimals===b.decimals',''],
 ['match','venue leverage','||objective.destination.order.maxLeverage>row.maxLeverage',''],
 ['match','borrow asset',"row.marketId==='aave'&&['borrow','withdraw'].includes(objective.destination.action)",'false'],
 ['match','borrow enabled',"if(row.marketId==='aave'&&objective.destination.action==='borrow'&&!row.borrowingEnabled)continue;",''],
 ['relay','same origin',"||req.headers.origin!==origin",''],
];
const directory=await mkdtemp(join(tmpdir(),'lenz-market-guards-'));
const sources=new Map(),results=[],hashes={};
const run=(test,env={})=>spawnSync(process.execPath,['--test',fileURLToPath(new URL(test,root))],{cwd:fileURLToPath(root),env:{...process.env,...env},encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});
let tests=0;
try{
 for(const [group,[file,test]] of Object.entries(groups)){
  const source=await readFile(new URL(file,root),'utf8');sources.set(group,source);
  for(const path of [file,test])hashes[path]=createHash('sha256').update(await readFile(new URL(path,root))).digest('hex');
  const baseline=run(test);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
  const count=Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)?.[1]);assert(count>0);tests+=count;
 }
 for(const [group,guard,from,to] of mutations){
  const [file,test,variable]=groups[group],source=sources.get(group);assert.equal(source.split(from).length,2,`Guard must match once: ${guard}`);
  const mutated=source.replace(from,to).replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(path,new URL(file,root)).href}${quote}`);
  const module=join(directory,'mutant.mjs');await writeFile(module,mutated);
  const result=run(test,{[variable]:module});assert.notEqual(result.status,0,`Undetected guard: ${guard}`);
  assert.match(result.stdout+result.stderr,/AssertionError/,`Non-assertion failure: ${guard}\n${result.stdout}${result.stderr}`);
  results.push({group,guard,detected:true});
 }
 for(const [file,digest] of Object.entries(hashes))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),digest,`Changed during verification: ${file}`);
 const report={checkedAt:new Date().toISOString(),tests,passed:tests,failed:0,guardAlterations:results.length,results,sourceHashes:hashes,scope:'Local fixture/HTTP-boundary checks; deliberate mutations run in temporary modules. Separate live-read and browser evidence.'};
 await writeFile(new URL('integrations/market-discovery-verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await unlink(join(directory,'mutant.mjs')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
