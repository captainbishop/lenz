const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],external=[];
 const screens=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-network-review');await fs.mkdir(screens,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){external.push(u.href);return route.abort();}if(u.pathname.startsWith('/api/'))return route.abort();return route.continue();});
  if(process.env.LENZ_NETWORK_MUTATION){const m=JSON.parse(await fs.readFile(process.env.LENZ_NETWORK_MUTATION,'utf8'));await page.route('**/'+m.file,r=>r.fulfill({contentType:'text/javascript',body:m.source}));}
  await context.addInitScript(()=>{
   const handlers=new Map();window.networkFixture={calls:[],chain:'0x89',address:'0x'+'12'.repeat(20),reject:false,delay:false,release:null};const f=networkFixture;
   const p={on(e,fn){handlers.set(e,fn);},removeListener(e,fn){if(handlers.get(e)===fn)handlers.delete(e);},async request(c){
    f.calls.push(c);
    if(c.method==='wallet_addEthereumChain')return null;
    if(c.method==='wallet_switchEthereumChain'){
     if(f.reject)throw Object.assign(Error('Declined'),{code:4001});
     if(f.delay)await new Promise(r=>f.release=r);
     f.chain=c.params[0].chainId;handlers.get('chainChanged')?.(f.chain);return null;
    }
    return {eth_accounts:[f.address],eth_requestAccounts:[f.address],eth_chainId:f.chain,eth_blockNumber:'0x2a',eth_getBalance:f.chain==='0x3039'?'0xf4241':'0xde0b6b3a7640000'}[c.method];
   }};
   addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Network fixture'},provider:p}})));
  });
  await page.goto('http://127.0.0.1:4173/money.html');await page.locator('#evm-networks').waitFor({state:'attached'});assert.equal(await page.locator('#evm-networks').isVisible(),false);
  const lenz=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const initial=await lenz(),calls=()=>page.evaluate(()=>networkFixture.calls);assert.equal((await calls()).length,0);
  const open=async()=>{if(!await page.locator('#evm-networks').isVisible())await page.locator('.wallet-settings summary').click();await page.locator('#evm-networks').click();},choose=id=>page.locator('#evm-network-choices button[data-chain="'+id+'"]').click();
  const fill=async()=>{for(const [id,value]of Object.entries({name:'Example Chain',chainId:'12345',rpcUrl:'https://rpc.example.com/',symbol:'COIN',decimals:'6'}))await page.locator('#evm-custom-'+id).fill(value);};
  await open();await page.locator('#evm-network-new').click();await fill();await page.locator('#evm-custom-rpcUrl').fill('http://rpc.example.com/');await page.locator('#evm-network-save').click();await page.waitForFunction(()=>document.querySelector('#evm-custom-rpcUrl').getAttribute('aria-invalid')==='true');assert.equal((await calls()).length,0);
  await page.locator('#evm-custom-rpcUrl').fill('https://rpc.example.com/');
  await page.evaluate(()=>{window.realNetworkSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='lenz-evm-networks-v1')throw Error('Quota fixture');return realNetworkSet.call(this,k,v);};});
  await page.locator('#evm-network-save').click();await page.waitForFunction(()=>document.querySelector('#evm-network-status').textContent.includes('could not be saved'));assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-evm-networks-v1')),null);
  await page.evaluate(()=>Storage.prototype.setItem=realNetworkSet);await page.locator('#evm-network-save').click();await page.locator('#evm-network-detail').waitFor();
  assert(await page.locator('#evm-network-use').isDisabled());assert.equal((await calls()).length,0);assert.equal(await lenz(),initial);
  const saved=await page.evaluate(()=>localStorage.getItem('lenz-evm-networks-v1'));assert.equal(JSON.parse(saved).networks[0].decimals,6);await page.keyboard.press('Escape');
  checks.push('invalid RPC and failed storage leave settings unchanged; saving custom metadata makes no wallet or endpoint request and preserves Lenz state');
  await open();await choose('0x2105');await page.locator('#evm-network-use').click();await page.getByRole('button',{name:'Network fixture',exact:true}).click();await page.locator('#evm-account').waitFor();assert((await page.locator('#evm-network').innerText()).startsWith('Base'));
  assert.equal((await calls())[0].method,'wallet_switchEthereumChain');
  await open();await choose('0x1');await page.locator('#evm-network-use').click();await page.locator('#evm-network-dialog').waitFor({state:'hidden'});assert((await page.locator('#evm-network').innerText()).startsWith('Ethereum'));
  checks.push('network selection connects from an initially unsupported wallet; built-in switching requires wallet confirmation and shows the checked destination');
  await page.evaluate(async()=>{
   const {transferTerms}=await import('/evm-transfer.js'),{updateTransfers}=await import('/evm-transfer-store.js');const now=Date.now();
   const terms=transferTerms({address:networkFixture.address,chainId:'0x1'},{asset:'native',recipient:'0x'+'34'.repeat(20),amount:'1',publicConsent:true});
   const review={version:1,terms,transaction:{from:terms.from,to:terms.to,value:terms.value,data:terms.data,chainId:terms.chainId,nonce:'0x0',gas:'0x5208',gasPrice:'0x3b9aca00'},createdAt:now,expiresAt:now+60000};
   await updateTransfers(rows=>rows.push({id:crypto.randomUUID(),review,state:'unknown',hash:null,createdAt:now,updatedAt:now,observation:null,error:''}));
  });
  await page.locator('.evm-transfer-row').waitFor();assert(await page.locator('#evm-send').isDisabled());
  const journal=()=>page.evaluate(async()=>JSON.stringify(await(await import('/evm-transfer-store.js')).readTransfers()));const beforeJournal=await journal();
  await open();await choose('0x3039');const count=(await calls()).length;assert(await page.locator('#evm-network-use').isDisabled());assert.equal((await calls()).length,count);
  await page.locator('#evm-network-consent').check();await page.locator('#evm-network-use').click();await page.locator('#evm-network-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#evm-balance').innerText(),'1.000001');assert.equal(await page.locator('#evm-balance + span').innerText(),'COIN');assert.equal(await page.locator('#evm-send').isVisible(),false);
  const rpc=(await calls()).find(c=>c.method==='wallet_addEthereumChain');assert.deepEqual(rpc.params,[{chainId:'0x3039',chainName:'Example Chain',nativeCurrency:{name:'COIN',symbol:'COIN',decimals:6},rpcUrls:['https://rpc.example.com/']}]);
  await page.locator('#evm-receive').click();assert.equal(await page.evaluate(async()=>{const c=document.querySelector('#evm-receive-qr');return(await import('/contact-card.js')).scanPixels(c,c.width,c.height);}), 'ethereum:0x'+'12'.repeat(20)+'@12345');await page.keyboard.press('Escape');
  assert.equal(await journal(),beforeJournal);assert.equal(await lenz(),initial);
  checks.push('custom RPC sharing requires consent; registration and switching are separate; exact custom balance/currency and decoded Receive QR never enable Send or alter prior history');
  await open();await choose('0x3039');
  for(const theme of ['light','dark'])for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(80);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#evm-network-dialog').scrollWidth<=document.querySelector('#evm-network-dialog').clientWidth));
   await page.screenshot({path:path.join(screens,`networks-${theme}-${width}.png`)});
  }
  await page.locator('#evm-network-new').click();await fill();
  for(const theme of ['light','dark'])for(const width of [320,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(screens,`network-form-${theme}-${width}.png`)});}
  await page.setViewportSize({width:667,height:375});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  for(let i=0;i<9;i++){await page.keyboard.press('Tab');const focus=await page.evaluate(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return {id:n.id,tag:n.tagName,inside:!!n.closest('#evm-network-dialog'),top:r.top,bottom:r.bottom,height:innerHeight};});assert(focus.tag==='BODY'||(focus.inside&&focus.top>=0&&focus.bottom<=focus.height),JSON.stringify(focus));}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:1280,height:900});await page.keyboard.press('Escape');
  checks.push('network details and compact configuration fit both themes at 320–1280px, with keyboard containment in landscape, reduced motion and doubled root text');
  await open();await choose('0x1');await page.evaluate(()=>networkFixture.reject=true);await page.locator('#evm-network-use').click();await page.waitForFunction(()=>document.querySelector('#evm-network-status').textContent.includes('declined'));assert.equal(await page.locator('#evm-account').isVisible(),false);await page.keyboard.press('Escape');await page.evaluate(()=>networkFixture.reject=false);
  await open();await choose('0x1');await page.locator('#evm-network-use').click();await page.getByRole('button',{name:'Network fixture',exact:true}).click();await page.locator('#evm-account').waitFor();
  await open();await choose('0x2105');await page.evaluate(()=>networkFixture.delay=true);await page.locator('#evm-network-use').click();await page.waitForFunction(()=>!!networkFixture.release);
  await page.evaluate(()=>document.querySelector('#evm-network-dialog').addEventListener('cancel',()=>{networkFixture.release();networkFixture.delay=false;},{once:true}));await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('#evm-account').isVisible(),false);assert.equal(await journal(),beforeJournal);
  checks.push('declined switches clear stale balances; closing during a delayed switch blocks same-event late replies and preserves the unresolved transfer');
  await open();await choose('0x1');await page.locator('#evm-network-use').click();await page.getByRole('button',{name:'Network fixture',exact:true}).click();await page.locator('#evm-account').waitFor();
  await open();await choose('0x3039');await page.locator('#evm-network-consent').check();await page.evaluate(()=>{networkFixture.delay=true;networkFixture.release=null;});await page.locator('#evm-network-use').click();await page.waitForFunction(()=>!!networkFixture.release);
  const beforeRevoke=(await calls()).length;await page.locator('#evm-network-consent').uncheck();await page.evaluate(()=>{networkFixture.release();networkFixture.delay=false;});await page.waitForTimeout(100);
  assert.equal(await page.locator('#evm-account').isVisible(),false);assert.equal((await calls()).length,beforeRevoke);await page.keyboard.press('Escape');
  checks.push('revoking custom-network consent during a pending switch prevents all subsequent balance reads and session activation');
  await page.reload();await open();await choose('0x3039');assert.equal(await page.locator('#evm-network-consent').isChecked(),false);await page.locator('#evm-network-consent').check();await page.locator('#evm-network-use').click();await page.getByRole('button',{name:'Network fixture',exact:true}).click();await page.locator('#evm-account').waitFor();
  const other=await context.newPage();await other.goto('http://127.0.0.1:4173/money.html');await other.evaluate(()=>localStorage.removeItem('lenz-evm-networks-v1'));await page.locator('#evm-account').waitFor({state:'hidden'});assert.equal(await journal(),beforeJournal);
  await other.evaluate(value=>localStorage.setItem('lenz-evm-networks-v1',value),saved);await other.close();
  await open();await choose('0x3039');await page.locator('#evm-network-remove').click();await page.waitForFunction(()=>!document.querySelector('[data-chain="0x3039"]'));assert.equal(await journal(),beforeJournal);await page.keyboard.press('Escape');
  await page.evaluate(value=>localStorage.setItem('lenz-evm-networks-v1',value),saved);
  await open();await choose('0x1');await page.locator('#evm-network-use').click();await page.getByRole('button',{name:'Network fixture',exact:true}).click();await page.locator('.evm-transfer-row').waitFor();assert(await page.locator('#evm-send').isDisabled());assert.equal(await journal(),beforeJournal);
  checks.push('reload retains custom settings but resets consent; another tab’s settings change disconnects; removal leaves pending transfer history and its send barrier intact');
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  await context.setOffline(true);await page.reload();await page.locator('#evm-networks').waitFor({state:'attached'});await open();await choose('0x3039');assert(await page.locator('#evm-network-use').isDisabled());assert.equal((await calls()).length,0);assert.equal(await journal(),beforeJournal);assert.equal(await lenz(),initial);await page.keyboard.press('Escape');await context.setOffline(false);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);checks.push('offline reload preserves network settings, Lenz state and transfer journal with no eager wallet, custom RPC, signing or financial request');
  const sources={};for(const file of ['web/public/evm-networks.js','web/public/evm-network-ui.js','web/public/evm-wallet.js','web/public/evm-wallet-ui.js','web/public/evm-transfer-ui.js','web/public/workspace-layout.css','web/public/money.css','web/public/chat-sw.js','web/evm-networks-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'evm-networks-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sources,scope:'Disposable Edge with injected wallet, real local persistence, decoded QR and offline cache. No installed wallet, actual network/RPC validation, device or financial operation.'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
