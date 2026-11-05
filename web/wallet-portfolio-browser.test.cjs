const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],requests=[];
 const screenshots=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-wallet-portfolio-review');await fs.mkdir(screenshots,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  await context.addInitScript(()=>{
   const handlers=new Map();window.walletFixture={calls:[],emit:event=>handlers.get(event)?.()};
   const provider={on:(event,fn)=>handlers.set(event,fn),removeListener:event=>handlers.delete(event),request:async request=>{
    walletFixture.calls.push(request.method);return {eth_requestAccounts:['0x'+'12'.repeat(20)],eth_accounts:['0x'+'12'.repeat(20)],eth_chainId:'0x1',eth_blockNumber:'0x2a',eth_getBalance:'0xde0b6b3a7640000'}[request.method];
   }};
   addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Fixture wallet'},provider}})));
  });
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
  const ready=()=>page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  await page.goto('http://127.0.0.1:4173/money.html');await ready();assert(await page.locator('#evm-connect').isVisible());
  await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  const state=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const before=await state(),reads=requests.length;
  assert(await page.locator('#wallet-panel-tokens #evm-connect').isVisible());
  await page.locator('#wallet-receive').click();await page.locator('#wallet-asset-dialog').waitFor();
  assert.match(await page.locator('#wallet-asset-options').innerText(),/tUSD\nLenz ID/);assert.deepEqual(await page.evaluate(()=>walletFixture.calls),[]);
  await page.locator('#wallet-asset-options button').filter({hasText:'tUSD'}).click();await page.locator('#near-receive-dialog').waitFor();
  assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Offline tUSD only/);assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Settlement is public on NEAR testnet/);assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Not an ETH or SOL address/);await page.keyboard.press('Escape');
  await page.locator('#wallet-receive').click();await page.getByRole('button',{name:'Connect an external wallet',exact:true}).click();await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();
  await page.locator('#wallet-asset-dialog').waitFor();await page.locator('#wallet-asset-options button').filter({hasText:'ETH'}).click();await page.locator('#evm-receive-dialog').waitFor();
  assert.equal(await page.locator('#evm-receive-address').innerText(),'0x'+'12'.repeat(20));assert.match(await page.locator('#evm-receive-network').innerText(),/Ethereum/);await page.keyboard.press('Escape');
  await page.locator('#wallet-receive').click();await page.evaluate(()=>walletFixture.emit('accountsChanged'));await page.getByRole('button',{name:'Connect an external wallet',exact:true}).waitFor();assert(!await page.locator('#wallet-asset-options').getByText('ETH',{exact:true}).count());await page.keyboard.press('Escape');
  checks.push('Receive chooses tUSD/Lenz ID or the connected asset/network before showing a destination; account changes remove the stale asset option');
  assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');
  await page.getByRole('tab',{name:'Tokens',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'DeFi');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-tab-defi');
  assert(await page.locator('#wallet-panel-tokens').isHidden());assert(await page.locator('#wallet-send').isVisible());
  await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'NFTs');
  assert.match(await page.locator('#wallet-panel-nfts').innerText(),/NFT ownership isn.{1}t connected yet/);assert(!/\$0|No NFTs|Connect to load/.test(await page.locator('#wallet-panel-nfts').innerText()));
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-panel-nfts');
  await page.getByRole('tab',{name:'NFTs',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');
  await page.keyboard.press('End');await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');
  checks.push('Tokens, DeFi and NFTs use one keyboard tab stop, arrows/Home/End, labelled panels and persistent payment actions');
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();
  const links=await page.locator('.wallet-markets a').evaluateAll(nodes=>nodes.map(n=>[n.innerText,n.getAttribute('href')]));
  for(const view of ['perpetuals','credit','liquidity','degen'])assert(links.some(([,href])=>href==='/markets.html?view='+view));
  assert(links.some(([label])=>label.includes('Hyperliquid')));assert(links.some(([,href])=>href==='/markets.html'));
  await page.locator('#wallet-defi-positions > summary').click();await page.locator('#rhea-open').click();await page.locator('#rhea-dialog').waitFor();
  assert.equal(await page.locator('#rhea-privacy').inputValue(),'private');assert(await page.locator('#rhea-quote').isDisabled());await page.keyboard.press('Escape');
  checks.push('DeFi links to the existing market categories; offline approval opens with its private-execution guard intact');
  await page.getByRole('tab',{name:'NFTs',exact:true}).click();await page.reload();await ready();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'NFTs');
  await page.getByRole('tab',{name:'Tokens',exact:true}).click();await page.goBack();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'NFTs');await page.goForward();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');
  for(const [hash,fold,tab] of [['rhea-wallet','wallet-defi-positions','DeFi'],['wallet-payments','wallet-payment-history','Tokens'],['wallet-people-section','wallet-contacts','Tokens']]){
   await page.goto('http://127.0.0.1:4173/money.html#'+hash);await ready();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),tab);assert(await page.locator('#'+fold).evaluate(n=>n.open));
  }
  for(const hash of ['__proto__','constructor','%3Cimg%3E']){await page.goto('http://127.0.0.1:4173/money.html#'+hash);await ready();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');}
  if(!await page.locator('#wallet-contacts').evaluate(n=>n.open))await page.locator('#wallet-contacts > summary').click();
  checks.push('reload and browser Back/Forward retain the selected view; earlier payment, people and DeFi links still open their content');
  await page.locator('#show-card').click();await page.locator('#share-contact').waitFor();await page.keyboard.press('Escape');
  assert.equal(await state(),before);assert.equal(requests.length,reads);
  checks.push('view changes, NFT availability and Lenz ID access preserve the entire stored account and make no API requests');
  await page.goto('http://127.0.0.1:4173/money.html');await ready();
  for(const theme of ['light','dark'])for(const viewport of [{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1280,height:900}]){
   await page.setViewportSize(viewport);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const tab of ['Tokens','DeFi','NFTs']){
    await page.getByRole('tab',{name:tab,exact:true}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const sizes=await page.getByRole('tab').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height];}));assert(sizes.every(([w,h])=>w>=44&&h>=44),JSON.stringify(sizes));
    if([390,1280].includes(viewport.width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(screenshots,`portfolio-${tab.toLowerCase()}-${theme}-${viewport.width}.png`),fullPage:true});}
   }
  }
  await page.setViewportSize({width:320,height:800});await page.addStyleTag({content:'html{font-size:200%}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  checks.push('all three panels fit phone, landscape, tablet and desktop in both themes; tab targets are at least 44px');
  await page.setViewportSize({width:390,height:844});await page.locator('#wallet-receive').click();
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(screenshots,`receive-asset-${theme}.png`)});}
  await page.keyboard.press('Escape');await page.locator('#wallet-send').click();await page.locator('#wallet-asset-options button').filter({hasText:'tUSD'}).click();await page.locator('#near-send-dialog').waitFor();await page.keyboard.press('Escape');
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  await context.setOffline(true);await page.reload();await ready();
  for(const tab of ['Tokens','DeFi','NFTs']){await page.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),tab);}
  assert.equal(await state(),before);assert.deepEqual(errors,[]);
  checks.push('the new modules load and tabs work after an actual offline service-worker reload without changing stored account data');
  const sourceFiles={};for(const file of ['money.html','money.js','wallet-portfolio.js','wallet-portfolio.css','wallet-tokens.js','wallet-actions.js','evm-wallet-ui.js','near-wallet.js','chat-sw.js'])sourceFiles['web/public/'+file]=require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(__dirname,'public',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'wallet-portfolio-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sourceFiles,scope:'Disposable Edge account, blocked APIs, reduced motion, offline worker. No user wallet, funds, signatures, NFT reads or physical devices.'},null,2)+'\n');
  console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
