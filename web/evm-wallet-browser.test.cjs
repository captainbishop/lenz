const {walletClick}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
 const screenshots=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(require('node:os').tmpdir(),'lenz-wallet-review');await fs.mkdir(screenshots,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.abort());
  if(process.env.LENZ_WALLET_UI_SOURCE)await page.route('**/evm-wallet-ui.js',async route=>route.fulfill({contentType:'text/javascript',body:await fs.readFile(process.env.LENZ_WALLET_UI_SOURCE,'utf8')}));
  await context.addInitScript(()=>{
   const handlers=new Map();
   window.walletFixture={calls:[],address:'0x'+'12'.repeat(20),chain:'0x1',delay:false,reject:false,resolve:null,
    emit(event){handlers.get(event)?.();},listenerCount(){return handlers.size;}};
   const f=window.walletFixture;
   const provider={on(event,fn){handlers.set(event,fn);},removeListener(event,fn){if(handlers.get(event)===fn)handlers.delete(event);},async request(value){
    f.calls.push(value);
    if(value.method==='eth_requestAccounts'&&f.reject)throw Object.assign(Error('Declined'),{code:4001});
    if(value.method==='eth_requestAccounts'&&f.delay)return new Promise(r=>{f.resolve=()=>r([f.address]);});
    return ({eth_requestAccounts:[f.address],eth_accounts:[f.address],eth_chainId:f.chain,eth_blockNumber:'0x2a',eth_getBalance:'0xde0b6b3a7640001'})[value.method];
   }};
   addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Fixture wallet',icon:'https://invalid.example/tracker.svg'},provider}})));
  });
  await page.goto('http://127.0.0.1:4173/money.html');await page.locator('#wallet-account').waitFor();
  assert.equal(await page.evaluate(()=>walletFixture.calls.length),0);
  const state=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const empty=await state();assert.equal(JSON.parse(empty).identity,null);
  const connect=async()=>{await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);};
  await connect();assert.equal(await state(),empty);assert.equal(await page.locator('#evm-balance').innerText(),'1.000000000000000001');
  assert.equal(await page.locator('#evm-providers button').count(),1);assert.equal(await page.locator('#evm-providers img').count(),0);
  checks.push('explicit provider selection connects without creating or replacing a Lenz profile; no eager account reads or remote wallet icons');
  await walletClick(page,'evm-receive');
  assert.equal(await page.evaluate(async()=>{const c=document.querySelector('#evm-receive-qr');return (await import('/contact-card.js')).scanPixels(c,c.width,c.height);}), 'ethereum:0x'+'12'.repeat(20)+'@1');
  await page.locator('#evm-copy').click();await page.waitForFunction(()=>document.querySelector('#evm-receive-status').textContent.includes('copied'));
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'0x'+'12'.repeat(20));
  for(const theme of ['light','dark'])for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(200);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(screenshots,`receive-${theme}-${width}.png`)});
  }
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>{const n=document.activeElement;if(n===document.body)return true;const r=n.getBoundingClientRect();return !!n.closest('#evm-receive-dialog')&&r.top>=0&&r.bottom<=innerHeight;}));}
  await page.keyboard.press('Escape');
  checks.push('Receive QR decodes to the exact chain and address; clipboard, Escape, keyboard focus and both themes fit 320–1280px');
  await page.locator('#wallet-account-dialog .wallet-close').click();await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();const before=await state();
  await page.locator('#toggle-balances').click();assert.equal(await page.locator('#evm-balance').getAttribute('aria-label'),'Amount hidden');await page.locator('#toggle-balances').click();
  await walletClick(page,'evm-refresh');await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);assert.equal(await state(),before);
  assert.equal(await page.evaluate(()=>walletFixture.calls.filter(c=>c.method==='eth_requestAccounts').length),1);
  await walletClick(page,'evm-receive');await page.evaluate(()=>walletFixture.emit('accountsChanged'));
  await page.locator('#evm-account').waitFor({state:'hidden'});await page.locator('#evm-receive-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#evm-receive-address').innerText(),'');assert.equal(await page.locator('#evm-receive-qr').evaluate(c=>c.width),0);assert.equal(await page.evaluate(()=>walletFixture.listenerCount()),0);
  assert.equal(await state(),before);checks.push('refresh preserves Lenz state and amount masking; account changes clear the balance, receive address, QR and event listeners');
  for(const [chain,name,id]of[['0xa4b1','Arbitrum','42161'],['0x2105','Base','8453']]){
   await page.evaluate(c=>walletFixture.chain=c,chain);await connect();assert((await page.locator('#evm-network').innerText()).startsWith(name));
   await walletClick(page,'evm-receive');assert.equal(await page.evaluate(async()=>{const c=document.querySelector('#evm-receive-qr');return (await import('/contact-card.js')).scanPixels(c,c.width,c.height);}),'ethereum:0x'+'12'.repeat(20)+'@'+id);
   await page.keyboard.press('Escape');await walletClick(page,'evm-disconnect');
  }
  await page.evaluate(()=>walletFixture.chain='0x89');await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#evm-connect-status').textContent.includes('Choose Ethereum'));
  await page.locator('#evm-account').waitFor({state:'hidden'});await page.keyboard.press('Escape');
  checks.push('Arbitrum and Base produce their own receive network; unsupported chains never show a usable account');
  await page.evaluate(()=>{walletFixture.chain='0x1';walletFixture.reject=true;});
  await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#evm-connect-status').textContent.includes('declined'));await page.keyboard.press('Escape');
  await page.evaluate(()=>{walletFixture.reject=false;walletFixture.delay=true;});await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();
  await page.waitForFunction(()=>!!walletFixture.resolve);
  await page.evaluate(()=>document.querySelector('#evm-connect-dialog').addEventListener('cancel',()=>{walletFixture.resolve();walletFixture.delay=false;},{once:true}));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);assert.equal(await page.locator('#evm-account').isVisible(),false);assert.equal(await state(),before);
  await page.evaluate(()=>{walletFixture.delay=true;walletFixture.resolve=null;});await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();await page.waitForFunction(()=>!!walletFixture.resolve);
  await page.evaluate(()=>document.querySelector('#evm-connect-close').addEventListener('click',()=>{walletFixture.resolve();walletFixture.delay=false;},{once:true}));await page.locator('#evm-connect-close').click();
  await page.waitForTimeout(100);assert.equal(await page.locator('#evm-account').isVisible(),false);
  checks.push('declined connection and a cancelled pending wallet prompt cannot activate a late session or change Lenz storage');
  await connect();
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screenshots,`connected-${theme}-${width}.png`)});}
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>document.documentElement.style.fontSize='');
  const calls=await page.evaluate(()=>walletFixture.calls);assert(calls.every(c=>['eth_requestAccounts','eth_accounts','eth_chainId','eth_blockNumber','eth_getBalance'].includes(c.method)));
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  await context.setOffline(true);await page.locator('#evm-account').waitFor({state:'hidden'});assert(await page.locator('#evm-connect').isDisabled());
  await page.reload();await page.locator('#wallet-account').waitFor();assert(await page.locator('#evm-connect').isDisabled());assert.equal(await page.evaluate(()=>walletFixture.calls.length),0);assert.equal(await state(),before);
  await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('#evm-connect').disabled);assert.equal(await page.evaluate(()=>walletFixture.calls.length),0);
  checks.push('offline reload caches connection controls but never restores account permission; reconnect stays explicit and all calls are read-only');
  const bare=await browser.newContext(),barePage=await bare.newPage();await barePage.route('**/api/**',r=>r.abort());await barePage.goto('http://127.0.0.1:4173/money.html');await walletClick(barePage,'evm-connect');await barePage.locator('#evm-provider-empty').waitFor();assert.equal(await barePage.locator('#evm-providers button').count(),0);await bare.close();
  checks.push('a browser without a wallet shows an actionable unavailable state');assert.deepEqual(errors,[]);
  const {createHash}=require('node:crypto');const sources={};for(const file of ['web/public/evm-wallet.js','web/public/evm-wallet-ui.js','web/public/money.js','web/public/workspace-layout.css','web/public/money.css','web/public/chat-sw.js','web/evm-wallet-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'evm-wallet-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sources,scope:'Disposable desktop Edge, injected EIP-1193/EIP-6963 fixtures and real local QR/cache/IndexedDB. No installed-wallet compatibility, physical phone, mainnet balance verification, signature or financial transaction.'},null,2)+'\n');console.log(checks.map(s=>'PASS '+s).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
