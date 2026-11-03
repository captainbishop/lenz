const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{run}=require('./terminal-browser.test.cjs');
(async()=>{
 const baseline=await run(),source=await fs.readFile(path.join(__dirname,'public/perp-terminal.js'),'utf8'),guard='if(ticket!==generation||!navigator.onLine||document.hidden||!panel.isConnected)return;';assert.equal(source.split(guard).length,2);let failed;
 try{await run({override:source.replace(guard,'if(false)return;'),record:false});}catch(e){failed=e;}
 assert.equal(failed?.code,'ERR_ASSERTION','Stale market reply guard not detected: '+failed?.message);
 const report={...baseline,guardAlterations:[{guard:'stale or revoked market reply',detected:true}]};await fs.writeFile(path.join(__dirname,'terminal-verification.json'),JSON.stringify(report,null,2)+'\n');console.log('DETECTED stale market reply');
})().catch(e=>{console.error(e);process.exitCode=1;});
