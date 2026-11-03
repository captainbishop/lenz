import assert from 'node:assert/strict';import {readFile,writeFile,mkdtemp,rm,rmdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),sourcePath=new URL('web/public/market-tape.js',root),source=await readFile(sourcePath,'utf8'),directory=await mkdtemp(join(tmpdir(),'lenz-market-tape-')),module=join(directory,'mutant.mjs'),results=[];
const run=env=>spawnSync(process.execPath,['--test',fileURLToPath(new URL('integrations/market-tape.test.mjs',root)),fileURLToPath(new URL('web/market-relay.test.mjs',root))],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,...env}});
try{
 const baseline=run({});assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
 for(const [guard,from,to]of [
  ['public consent',"value.privacy==='public'",'true'],
  ['source identity',"value.source==='https://api.hyperliquid.xyz/info'",'true'],
  ['crossed book','Number(levels[0][0].price)<Number(levels[1][0].price)','true'],
  ['expiry','value.expiresAt>now','true'],
  ['candle identity','c.coin===coin','true'],
  ['OHLC bounds','Number(low)<=Math.min(Number(open),Number(close))&&Number(high)>=Math.max(Number(open),Number(close))','true'],
 ]){assert.equal(source.split(from).length,2,guard);const changed=source.replace(from,to).replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,sourcePath).href}${q}`);await writeFile(module,changed);const r=run({LENZ_TAPE_MODULE:module});assert.notEqual(r.status,0,guard+' survived');assert.match(r.stdout+r.stderr,/AssertionError/);results.push({guard,detected:true});}
 const sourceFiles={};for(const f of ['web/public/market-tape.js','integrations/market-tape.mjs','integrations/market-http.mjs','integrations/market-http.test.mjs','integrations/market-tape-fixtures.mjs','integrations/market-tape.test.mjs','web/market-relay.mjs','web/market-relay.test.mjs','integrations/verify-market-tape.mjs'])sourceFiles[f]=createHash('sha256').update(await readFile(new URL(f,root))).digest('hex');
 const report={checkedAt:new Date().toISOString(),tests:Number(baseline.stdout.match(/(?:ℹ|#) tests (\d+)/)[1]),guardAlterations:results.length,results,sourceFiles,scope:'Synthetic public market data, bounded parsing and relay checks. No account access or execution authority.'};await writeFile(new URL('integrations/market-tape-verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:report.tests,guardAlterations:results.length}));
}finally{await rm(module,{force:true});await rmdir(directory);}
