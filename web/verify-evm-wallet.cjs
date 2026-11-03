// Deliberate guard changes run in temporary copies; the working source is untouched.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
(async()=>{
 const root=path.join(__dirname,'..'),sourcePath=path.join(__dirname,'public/evm-wallet.js'),testPath=path.join(__dirname,'evm-wallet.test.mjs');
 const source=await fs.readFile(sourcePath,'utf8'),test=await fs.readFile(testPath,'utf8'),ui=await fs.readFile(path.join(__dirname,'public/evm-wallet-ui.js'),'utf8');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-wallet-guards-'));await fs.mkdir(path.join(dir,'public'));await fs.writeFile(path.join(dir,'evm-wallet.test.mjs'),test);
 await fs.copyFile(path.join(__dirname,'public/evm-networks.js'),path.join(dir,'public/evm-networks.js'));
 const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});assert(!r.error,String(r.error));return {code:r.status,output:r.stdout+r.stderr};};
 const normal=run(['--test','web/evm-wallet.test.mjs']);assert.equal(normal.code,0,normal.output);
 const changes=[
  ['late-provider',s=>s.replaceAll('ticket === generation && current === provider','true'),'disconnect while permission'],
  ['account-network-recheck',s=>s.replace("assert(chain(await request('eth_chainId', null, current, ticket), resolve) === chainId && account(await request('eth_accounts', null, current, ticket)) === address, 'Account or network changed. Reconnect.');",''),'silent account or network'],
  ['provider-events',s=>s.replace("disconnect('Account or network changed. Reconnect to continue.');",''),'provider events clear'],
  ['receive-chain',s=>s.replace('@${network.id}','@1'),'all supported networks'],
  ['balance-precision',s=>s.replace("whole.toString() + (fraction ? '.' + fraction : '')","String(Number(units) / 1e18)"),'exact native amount'],
 ];
 const detected=[];
 for(const [name,mutate,pattern]of changes){const changed=mutate(source);assert.notEqual(changed,source,name+' did not change source');await fs.writeFile(path.join(dir,'public/evm-wallet.js'),changed);const result=run(['--test','--test-name-pattern='+pattern,path.join(dir,'evm-wallet.test.mjs')]);assert.notEqual(result.code,0,name+' survived');assert.match(result.output,/AssertionError|ERR_ASSERTION/);detected.push(name);}
 const uiPath=path.join(dir,'ui.js'),mutated=ui.replace("dialog.addEventListener('cancel', cancelConnection);",'');assert.notEqual(mutated,ui);await fs.writeFile(uiPath,mutated);
 const cancelled=run(['web/evm-wallet-browser.test.cjs'],{...process.env,LENZ_WALLET_UI_SOURCE:uiPath});assert.notEqual(cancelled.code,0,'deferred cancellation survived');assert.match(cancelled.output,/AssertionError|ERR_ASSERTION/);detected.push('deferred-dialog-cancellation');
 const browser=run(['web/evm-wallet-browser.test.cjs']);assert.equal(browser.code,0,browser.output);
 assert.equal(await fs.readFile(sourcePath,'utf8'),source);assert.equal(await fs.readFile(testPath,'utf8'),test);assert.equal(await fs.readFile(path.join(__dirname,'public/evm-wallet-ui.js'),'utf8'),ui);
 const sources={};for(const file of ['web/public/evm-wallet.js','web/public/evm-wallet-ui.js','web/evm-wallet.test.mjs','web/evm-wallet-browser.test.cjs','web/verify-evm-wallet.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
 const nodeTests=Number(normal.output.match(/tests (\d+)/)[1]);
 await fs.writeFile(path.join(__dirname,'evm-wallet-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests,browserGroups:7,guardAlterations:detected,sources,scope:'Local EIP-1193 session and injected-provider Edge UI; no live wallet compatibility, cryptographic ownership proof, signing, transaction, recovery or DeFi execution.'},null,2)+'\n');console.log(normal.output.trim());console.log(browser.output.trim());console.log('Detected '+detected.length+' guard alterations: '+detected.join(', '));
})().catch(error=>{console.error(error);process.exitCode=1;});
