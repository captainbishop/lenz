const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
(async()=>{
 const root=path.join(__dirname,'..'),file=path.join(__dirname,'public/budget-courier.js'),source=await fs.readFile(file,'utf8'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-budget-courier-guards-'));
 const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,['--test',...args,'web/budget-courier-browser.test.cjs'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});assert(!r.error,String(r.error));return{code:r.status,output:r.stdout+r.stderr};};
 const baseline=run(['--test-skip-pattern=real local connection']);assert.equal(baseline.code,0,baseline.output);
 const variants=[
  ['recipient-opt-in','recipient opt-in',"assert(v.enabled,'This device is not receiving spending requests.');",''],
  ['approved-sender','recipient opt-in','p.sender===sender.id&&p.expected.domain.verifyingContract','p.expected.domain.verifyingContract'],
  ['nonce-conflict','fresh signature',"assert(!v.rows.some(r=>r.slot===slot),'Conflicting budget nonce. The original request remains saved.');",''],
  ['durable-request','failed inbox commit','v.rows.push(row);await save(s,v);','v.rows.push(row);'],
  ['sender-quota','per-sender inbox quota','&&v.rows.filter(r=>r.sender.id===sender.id).length<PER_SENDER',''],
 ];
 const detected=[];
 for(const[name,pattern,from,to]of variants){assert.equal(source.split(from).length,2,'Unique guard: '+name);const altered=path.join(temporary,name+'.js');await fs.writeFile(altered,source.replace(from,to));const r=run(['--test-name-pattern='+pattern],{...process.env,LENZ_BUDGET_COURIER_SOURCE:altered});assert.notEqual(r.code,0,name+' survived');assert.match(r.output,/AssertionError|ERR_ASSERTION/);detected.push(name);console.log('Detected '+name);}
 assert.equal(await fs.readFile(file,'utf8'),source);
 const sources={};for(const name of ['web/public/budget-courier.js','web/public/offline-budget.js','web/public/offline-budget-outbox.js','web/public/nearby-courier.js','web/public/nearby-client.js','web/public/nearby-connection.js','web/public/nearby-courier-ui.js','web/public/chat-store.js','web/public/peer-crypto.js','web/public/carrier-protocol.js','web/public/chat-sw.js','web/public/sw.js','web/budget-courier-browser.test.cjs','web/verify-budget-courier.cjs'])sources[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
 const report=path.join(os.tmpdir(),'lenz-budget-courier-verification.json');await fs.writeFile(report,JSON.stringify({checkedAt:new Date().toISOString(),tests:Number(baseline.output.match(/tests (\d+)/)[1]),guardAlterations:detected,sources,scope:'Disposable browser IndexedDB/WebCrypto/locks and synthetic signed chain-31337 budgets. Admission, conflicts, failed writes, quotas, receipt authentication, expiry, pause and replacement delivery. Real local WebRTC test is separate. No production funding, private settlement, forward secrecy or physical mesh claim.'},null,2)+'\n');console.log('Verified '+detected.length+' guard alterations; report '+report);
})().catch(error=>{console.error(error);process.exitCode=1;});
