const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
(async()=>{
 const root=path.join(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-network-guards-')),baseline=new Map();
 const files=['evm-networks.js','evm-wallet.js','evm-transfer.js','evm-markets.js','defi-catalog.js','evm-vendor/address.js'];
 for(const file of files){const bytes=await fs.readFile(path.join(__dirname,'public',file));baseline.set(file,bytes.toString());await fs.mkdir(path.dirname(path.join(dir,'public',file)),{recursive:true});await fs.writeFile(path.join(dir,'public',file),bytes);}
 await fs.copyFile(path.join(__dirname,'evm-networks.test.mjs'),path.join(dir,'evm-networks.test.mjs'));
 const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});assert(!r.error,String(r.error));return {code:r.status,output:r.stdout+r.stderr};};
 const normal=run(['--test','web/evm-networks.test.mjs']);assert.equal(normal.code,0,normal.output);
 const mutations=[
  ['builtin-immutability','evm-networks.js','!Object.hasOwn(WALLET_NETWORKS, chainId)','true','custom metadata canonicalizes'],
  ['https-only','evm-networks.js',"url.protocol === 'https:'",'true','unsafe RPC'],
  ['duplicate-chain','evm-networks.js','!rows.some(row => row.chainId === n.chainId)','true','serialized concurrent'],
  ['custom-consent','evm-wallet.js','!network.custom || addConsent === true','true','custom registration requires'],
  ['custom-precision','evm-wallet.js','nativeAmount(balance, network.decimals)','nativeAmount(balance, 18)','custom registration requires'],
  ['selected-rpc-binding','evm-wallet.js','!expectedNetwork || JSON.stringify(expectedNetwork) === JSON.stringify(network)','true','changed custom settings'],
  ['metadata-change','evm-wallet.js',"const sameNetwork = (id, network) => JSON.stringify(resolve(id)) === JSON.stringify(network);",'const sameNetwork = () => true;','changing native decimals'],
  ['transfer-scope','evm-transfer.js',"check(Object.hasOwn(WALLET_NETWORKS,chainId),'Unsupported sending network.');",'','custom registration requires'],
 ];
 const detected=[];
 for(const [name,file,find,replacement,pattern]of mutations){const source=baseline.get(file);assert(source.includes(find),name+' target missing');await fs.writeFile(path.join(dir,'public',file),source.replace(find,replacement));const result=run(['--test','--test-name-pattern='+pattern,path.join(dir,'evm-networks.test.mjs')]);await fs.writeFile(path.join(dir,'public',file),source);assert.notEqual(result.code,0,name+' survived');assert.match(result.output,/AssertionError|ERR_ASSERTION/);detected.push(name);}
 const ui=await fs.readFile(path.join(__dirname,'public/evm-network-ui.js'),'utf8'),changed=ui.replace("dialog.addEventListener('cancel', cancel);",'');assert.notEqual(changed,ui);
 const mutationPath=path.join(dir,'ui-mutation.json');await fs.writeFile(mutationPath,JSON.stringify({file:'evm-network-ui.js',source:changed}));
 const mutated=run(['web/evm-networks-browser.test.cjs'],{...process.env,LENZ_NETWORK_MUTATION:mutationPath});assert.notEqual(mutated.code,0,'synchronous-cancel survived');assert.match(mutated.output,/AssertionError|ERR_ASSERTION/);detected.push('synchronous-cancel');
 const browser=run(['web/evm-networks-browser.test.cjs']);assert.equal(browser.code,0,browser.output);
 for(const [file,source]of baseline)assert.equal(await fs.readFile(path.join(__dirname,'public',file),'utf8'),source);assert.equal(await fs.readFile(path.join(__dirname,'public/evm-network-ui.js'),'utf8'),ui);
 const sources={};for(const file of [...files.map(f=>'web/public/'+f),'web/public/evm-network-ui.js','web/public/evm-wallet-ui.js','web/public/evm-transfer-ui.js','web/public/workspace-layout.css','web/public/money.css','web/public/chat-sw.js','web/evm-networks.test.mjs','web/evm-networks-browser.test.cjs','web/verify-evm-networks.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
 const nodeTests=Number(normal.output.match(/tests (\d+)/)[1]),browserGroups=JSON.parse(await fs.readFile(path.join(__dirname,'evm-networks-browser-results.json'))).passed;
 await fs.writeFile(path.join(__dirname,'evm-networks-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests,browserGroups,guardAlterations:detected,sources,scope:'Custom metadata, persistence, wallet-selected chain binding, stale reply/consent checks and disposable Edge UI. No actual-network authenticity, installed-wallet compatibility, device or financial operation.'},null,2)+'\n');
 console.log(normal.output.trim());console.log(browser.output.trim());console.log('Detected '+detected.length+' guard alterations: '+detected.join(', '));
})().catch(e=>{console.error(e);process.exitCode=1;});
