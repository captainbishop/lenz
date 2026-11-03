const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
(async()=>{
 const root=path.join(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-send-guards-')),baseline=new Map();
 const files=['evm-wallet.js','evm-networks.js','evm-transfer.js','evm-transfer-store.js','evm-transfer-service.js','evm-markets.js','defi-catalog.js','evm-vendor/address.js'];
 for(const file of files){const bytes=await fs.readFile(path.join(__dirname,'public',file));baseline.set(file,bytes.toString());await fs.mkdir(path.dirname(path.join(dir,'public',file)),{recursive:true});await fs.writeFile(path.join(dir,'public',file),bytes);}
 for(const file of ['evm-transfer.test.mjs','evm-transfer-fixtures.mjs'])await fs.copyFile(path.join(__dirname,file),path.join(dir,file));
 const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});assert(!r.error,String(r.error));return {code:r.status,output:r.stdout+r.stderr};};
 const normal=run(['--test','web/evm-wallet.test.mjs','web/evm-transfer.test.mjs','aurora/evm-wallet-send.test.mjs']);assert.equal(normal.code,0,normal.output);
 const mutations=[
  ['public-consent','evm-transfer.js','&&input.publicConsent===true','&&true','address checksum'],
  ['nonce-recheck','evm-transfer.js',"q(await lease.request('eth_getTransactionCount',[r.terms.from,'pending']))===q(r.transaction.nonce)",'true','changed balance'],
  ['persist-before-wallet','evm-transfer-service.js','review=validateReview(review);await recheckTransfer(lease,review);','review=validateReview(review);await recheckTransfer(lease,review);await lease.sendTransaction(review.transaction);','storage failure'],
  ['duplicate-barrier','evm-transfer-service.js','check(!rows.some(r=>transferOpen(r)','check(true||rows.some(r=>transferOpen(r)','durable record precedes'],
  ['unknown-retention','evm-transfer-service.js',"if(row.state==='awaiting_wallet'){row.state='unknown'","if(row.state==='awaiting_wallet'){row.state='declined'",'timeout preserves'],
  ['recipient-binding','evm-transfer.js','address(tx.to)===expected.to','true','mismatched transactions'],
  ['finality','evm-transfer.js','const finalized=finalBlock&&','const finalized=true||finalBlock&&','matching canonical'],
  ['token-effect','evm-transfer.js',"if(r.terms.asset!=='native'&&receipt.status==='0x1')",'if(false)','token confirmation'],
 ];
 const detected=[];
 for(const [name,file,find,replacement,pattern]of mutations){const source=baseline.get(file);assert(source.includes(find),name+' target missing');await fs.writeFile(path.join(dir,'public',file),source.replace(find,replacement));const result=run(['--test','--test-name-pattern='+pattern,path.join(dir,'evm-transfer.test.mjs')]);await fs.writeFile(path.join(dir,'public',file),source);assert.notEqual(result.code,0,name+' survived');assert.match(result.output,/AssertionError|ERR_ASSERTION/);detected.push(name);}
 const ui=await fs.readFile(path.join(__dirname,'public/evm-transfer-ui.js'),'utf8'),changed=ui.replace('dialog.open&&ticket===version','true');assert.notEqual(changed,ui);
 const mutationPath=path.join(dir,'ui-mutation.json');await fs.writeFile(mutationPath,JSON.stringify({file:'evm-transfer-ui.js',source:changed}));
 const mutant=run(['web/evm-transfer-browser.test.cjs'],{...process.env,LENZ_TRANSFER_MUTATION:mutationPath});assert.notEqual(mutant.code,0,'closed-review survived');assert.match(mutant.output,/AssertionError|ERR_ASSERTION/);detected.push('closed-review');
 const browser=run(['web/evm-transfer-browser.test.cjs']);assert.equal(browser.code,0,browser.output);
 for(const [file,source]of baseline)assert.equal(await fs.readFile(path.join(__dirname,'public',file),'utf8'),source);assert.equal(await fs.readFile(path.join(__dirname,'public/evm-transfer-ui.js'),'utf8'),ui);
 const sources={};for(const file of [...files.map(f=>'web/public/'+f),'web/public/evm-transfer-ui.js','web/evm-wallet.test.mjs','web/evm-transfer.test.mjs','web/evm-transfer-fixtures.mjs','web/evm-transfer-browser.test.cjs','web/verify-evm-transfer.cjs','aurora/evm-wallet-send.test.mjs','web/build-evm-address.mjs','web/evm-address-build.json'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
 const nodeTests=Number(normal.output.match(/tests (\d+)/)[1]),browserGroups=JSON.parse(await fs.readFile(path.join(__dirname,'evm-transfer-browser-results.json'))).passed;
 await fs.writeFile(path.join(__dirname,'evm-transfer-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests,browserGroups,guardAlterations:detected,sources,scope:'Synthetic provider safety tests, real isolated EthereumJS native/ERC20 execution with ephemeral keys, and disposable Edge UI/storage/cache. No external transaction, installed wallet, actual-chain fee/finality or physical device verification.'},null,2)+'\n');
 console.log(normal.output.trim());console.log(browser.output.trim());console.log('Detected '+detected.length+' guard alterations: '+detected.join(', '));
})().catch(e=>{console.error(e);process.exitCode=1;});
