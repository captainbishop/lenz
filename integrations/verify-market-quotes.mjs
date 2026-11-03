import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),groups={
 quotes:['integrations/market-quotes.mjs','integrations/market-quotes.test.mjs','LENZ_QUOTES_MODULE'],
 view:['web/public/market-quote.js','integrations/market-quotes.test.mjs','LENZ_QUOTE_VIEW_MODULE'],
 relay:['web/market-relay.mjs','web/market-relay.test.mjs','LENZ_RELAY_MODULE'],
};
const mutations=[
 ['quotes','quoter identity','factory[0].toLowerCase()===MARKET_READS.factory','true'],
 ['quotes','pool identity','`uniswap:${pool}`===request.marketId','true'],
 ['quotes','pool availability','liquidity[0]>0n','true'],
 ['quotes','complete swap fill','after>4295128740n','true'],
 ['quotes','book ordering',"rows.every((row,i)=>i===0||(side===0?row.px<rows[i-1].px:row.px>rows[i-1].px))",'true'],
 ['quotes','book spread','sides[0][0].px<sides[1][0].px','true'],
 ['quotes','complete book fill','remaining===0n,','true,'],
 ['quotes','buy side',"sides[request.side==='buy'?1:0]",'sides[0]'],
 ['view','public consent',"value.privacy==='public'",'true'],
 ['view','unknown fields','Object.keys(value).length===keys.length','true'],
 ['view','decimal precision','fraction.length<=decimals','true'],
 ['view','execution authority',"&&value.executable===false",''],
 ['view','exact quote terms','JSON.stringify(marketQuoteRequest(value.request))===JSON.stringify(request)','true'],
 ['view','expiry','value.expiresAt>now&&value.expiresAt>value.observedAt','true'],
 ['view','source-time age','value.expiresAt<=value.sourceTime+(swap?60000:30000)','true'],
 ['view','received asset',"r.outputSymbol===output",'true'],
 ['view','minimum received','BigInt(r.minOutputUnits)===BigInt(r.outputUnits)*BigInt(10000-request.slippageBps)/10000n','true'],
 ['view','full depth','r.fullDepth===true','true'],
 ['relay','concurrency bound','quotePending.size>=4','false'],
];
const directory=await mkdtemp(join(tmpdir(),'lenz-quote-guards-')),sources=new Map(),hashes={},results=[],checked=new Set();let tests=0;
const run=(test,env={})=>spawnSync(process.execPath,['--test',fileURLToPath(new URL(test,root))],{cwd:fileURLToPath(root),env:{...process.env,...env},encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024,timeout:15000});
try{
 for(const [group,[file,test]]of Object.entries(groups)){
  sources.set(group,await readFile(new URL(file,root),'utf8'));
  if(!checked.has(test)){const baseline=run(test);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);const count=Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)?.[1]);assert(count>0);tests+=count;checked.add(test);}
 }
 for(const file of [...new Set([...Object.values(groups).flatMap(([file,test])=>[file,test]),'aurora/market-read-codec.mjs','integrations/market-discovery.mjs','integrations/market-quote-fixtures.mjs','web/public/market-quote-ui.js','web/market-quote-browser.test.cjs'])])hashes[file]=createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');
 for(const [group,guard,from,to]of mutations){
  const [file,test,variable]=groups[group],source=sources.get(group);assert.equal(source.split(from).length,2,`Unique guard: ${guard}`);
  const mutant=source.replace(from,to).replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(path,new URL(file,root)).href}${quote}`),module=join(directory,'mutant.mjs');await writeFile(module,mutant);
  const result=run(test,{[variable]:module});assert.notEqual(result.status,0,`Undetected guard: ${guard}`);assert.match(result.stdout+result.stderr,/AssertionError/,`No failing assertion: ${guard}\n${result.stdout}${result.stderr}`);results.push({group,guard,detected:true});
 }
 for(const [file,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),hash,`Changed during checks: ${file}`);
 const report={checkedAt:new Date().toISOString(),tests,passed:tests,failed:0,guardAlterations:results.length,results,sourceHashes:hashes,scope:'Fixture quote/read-boundary tests and deliberate changes; separate browser and public live-read evidence'};
 await writeFile(new URL('integrations/market-quotes-verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await unlink(join(directory,'mutant.mjs')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
