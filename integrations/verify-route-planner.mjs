import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=await readFile(new URL('../web/public/defi-route-plan.js',import.meta.url),'utf8');
const directory=await mkdtemp(join(tmpdir(),'lenz-route-guards-'));
const runner=fileURLToPath(new URL('./route-planner.test.mjs',import.meta.url));
const run=module=>spawnSync(process.execPath,['--test',runner],{cwd:root,env:{...process.env,LENZ_ROUTE_MODULE:module},encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
const changes=[
 ['network separation',"if(chain(source.asset.chainId).network!==target.network)","if(false)"],
 ['venue environment',"if(target.family!==market.family)","if(false)"],
 ['explicit privacy',"if(!['private','transparent'].includes(input.privacy))","if(false)"],
 ['unknown fields',"Object.keys(value).some(k=>!keys.includes(k))","false"],
 ['expiry',"input.limits.deadline<=now","false"],
 ['consistent decimals',"decimals.has(key(asset))&&decimals.get(key(asset))!==asset.decimals","false"],
 ['position exit',"if(openingActions.includes(dest.action))","if(false)"],
 ['reduce only',"if(dest.action==='reduce-position'&&!dest.order.reduceOnly)","if(false)"],
 ['minimum received',"&&minReceive==='0'","&&false"],
 ['no execution authority',"executable:false","executable:true"],
 ['no reservation release',"releaseReservation:false","releaseReservation:true"],
];
try {
 await writeFile(join(directory,'package.json'),'{"type":"module"}');
 await writeFile(join(directory,'defi-catalog.js'),await readFile(new URL('../web/public/defi-catalog.js',import.meta.url)));
 const module=join(directory,'defi-route-plan.js');await writeFile(module,source);
 const baseline=run(module);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
 const results=[];
 for(const [name,from,to] of changes){
  assert.equal(source.split(from).length,2,`Guard must match once: ${name}`);
  await writeFile(module,source.replace(from,to));const result=run(module);
  assert.notEqual(result.status,0,`Undetected alteration: ${name}`);
  assert.match(result.stdout+result.stderr,/AssertionError/,`Not an assertion failure: ${name}`);
  results.push({guard:name,detected:true});
 }
 const count=Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)?.[1]);assert(count>0,'Missing test count');
 const report={checkedAt:new Date().toISOString(),tests:count,passed:count,guardAlterations:results.length,results,scope:'Synthetic local route objectives; no wallet, network, live signing or execution'};
 await writeFile(new URL('./route-planner-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} finally {
 for(const name of ['package.json','defi-catalog.js','defi-route-plan.js'])await unlink(join(directory,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await rmdir(directory);
}
