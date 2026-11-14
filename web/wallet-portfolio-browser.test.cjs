const {walletClick}=require('./wallet-test-ui.cjs');
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
  await page.goto('http://127.0.0.1:4173/money.html');await ready();assert(await page.locator('#wallet-account').isVisible());assert(await page.locator('#wallet-hero-summary').isHidden());
  await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  await page.locator('#wallet-hero-summary').waitFor();
  for(const id of ['wallet-holdings-total','wallet-send','wallet-receive','toggle-balances'])assert.equal(await page.locator('.wallet-heading #'+id).count(),1);
  checks.push('portfolio value and actions share the wallet hero and remain hidden until the wallet is opened');
  const state=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const before=await state();
  await page.locator('.wallet-native-row').nth(2).waitFor();assert.equal(await page.locator('.wallet-native-row').count(),3);
  await page.locator('#wallet-receive').click();await page.locator('#wallet-asset-dialog').waitFor();
  assert.match(await page.locator('#wallet-asset-options').innerText(),/tUSD\nLenz ID/);assert.deepEqual(await page.evaluate(()=>walletFixture.calls),[]);
  await page.locator('#wallet-asset-options button').filter({hasText:'tUSD'}).click();await page.locator('#near-receive-dialog').waitFor();
  assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Offline tUSD only/);assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Settlement is public on NEAR testnet/);assert.match(await page.locator('.wallet-receiving>.quiet:not([role])').innerText(),/Not an ETH or SOL address/);await page.keyboard.press('Escape');
  await page.locator('#wallet-receive').click();await page.getByRole('button',{name:'Connect an external wallet',exact:true}).click();await page.getByRole('button',{name:'Fixture wallet',exact:true}).click();
  await page.locator('#wallet-asset-dialog').waitFor();await page.locator('#wallet-asset-options button').filter({has:page.getByText('ETH',{exact:true})}).click();await page.locator('#evm-receive-dialog').waitFor();
  assert.equal(await page.locator('#evm-receive-address').innerText(),'0x'+'12'.repeat(20));assert.match(await page.locator('#evm-receive-network').innerText(),/Ethereum/);await page.keyboard.press('Escape');
  const choose=async(action,symbol)=>{await page.locator('#wallet-'+action).click();await page.locator('#wallet-asset-options button').filter({has:page.getByText(symbol,{exact:true})}).click();};
  const callsBefore=await page.evaluate(()=>walletFixture.calls.length);
  for(const [symbol,asset]of [['ETH','native'],['USDC','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],['WETH','0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']]){
   await choose('receive',symbol);await page.locator('#evm-receive-dialog').waitFor();
   assert.equal(await page.locator('#evm-receiving-asset').inputValue(),asset);
   assert.equal(await page.locator('#evm-receive-address').innerText(),'0x'+'12'.repeat(20));
   const qr=await page.evaluate(async()=>{const canvas=document.querySelector('#evm-receive-qr');return(await import('/contact-card.js')).scanPixels(canvas,canvas.width,canvas.height);});
   assert.equal(qr,asset==='native'?'ethereum:0x'+'12'.repeat(20)+'@1':`ethereum:${asset}@1/transfer?address=0x${'12'.repeat(20)}`);
   assert.equal(await page.locator('#evm-receiving-link').evaluate(n=>n.open),false);
   await page.keyboard.press('Escape');await page.locator('#wallet-send').click();await page.locator('#evm-send-dialog').waitFor();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'evm-send-recipient');await page.locator('#evm-send-asset-toggle').click();await page.locator('#evm-send-assets').getByRole('button',{name:symbol,exact:true}).click();
   assert.equal(await page.locator('#evm-send-assets [aria-pressed=true]').getAttribute('aria-label'),symbol);assert.equal(await page.locator('#evm-send-symbol').innerText(),symbol);
   assert(await page.locator('#evm-send-review').isDisabled());assert(!await page.locator('#evm-send-approve').isVisible());await page.keyboard.press('Escape');
  }
  assert.equal(await page.evaluate(()=>walletFixture.calls.length),callsBefore);
  checks.push('Send opens recipient entry directly; ETH, USDC and WETH use exact QR contracts and send assets without extra wallet requests');
  await page.locator('#wallet-send').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-send');
  assert(await page.locator('#wallet-offline-amount').isVisible());assert(await page.locator('.wallet-primary-actions #toggle-balances').isVisible());
  assert.equal(await page.locator('.wallet-primary-actions #near-fund').count(),0);
  checks.push('test funds and funding controls remain in their labelled balance section; primary actions and balance masking stay visible');
  for(const theme of ['light','dark'])for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.screenshot({path:path.join(screenshots,`wallet-connected-${theme}-${width}.png`),fullPage:true});
   await page.locator('#wallet-receive').click();await page.screenshot({path:path.join(screenshots,`asset-connected-${theme}-${width}.png`)});await page.keyboard.press('Escape');
  }
  await page.locator('#wallet-receive').click();await page.evaluate(()=>walletFixture.emit('accountsChanged'));await page.getByRole('button',{name:'Connect an external wallet',exact:true}).waitFor();assert(!await page.locator('#wallet-asset-options').getByText('ETH',{exact:true}).count());await page.keyboard.press('Escape');
  const accountRequests=()=>requests.filter(url=>!url.endsWith('/api/markets/assets'));const reads=accountRequests().length;
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
  for(const [hash,fold,tab] of [['rhea-wallet','wallet-defi-positions','DeFi'],['wallet-payments','wallet-activity-dialog','Tokens'],['wallet-people-section','wallet-contacts','Tokens']]){
   await page.goto('http://127.0.0.1:4173/money.html#'+hash);await ready();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),tab);assert(await page.locator('#'+fold).evaluate(n=>n.open));
  }
  for(const hash of ['__proto__','constructor','%3Cimg%3E']){await page.goto('http://127.0.0.1:4173/money.html#'+hash);await ready();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Tokens');}
  checks.push('reload and browser Back/Forward retain the selected view; earlier payment, people and DeFi links still open their content');
  await walletClick(page,'show-card');await page.locator('#share-contact').waitFor();await page.keyboard.press('Escape');
  assert.equal(await state(),before);assert.equal(accountRequests().length,reads,JSON.stringify(accountRequests()));
  checks.push('view changes, NFT availability and Lenz ID access preserve the entire stored account and make no additional account API requests');
  await page.goto('http://127.0.0.1:4173/money.html');await ready();
  for(const theme of ['light','dark'])for(const viewport of [{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1280,height:900}]){
   await page.setViewportSize(viewport);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const tab of ['Tokens','DeFi','NFTs']){
    await page.getByRole('tab',{name:tab,exact:true}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const inset=await page.evaluate(()=>{const hero=document.querySelector('.wallet-heading').getBoundingClientRect(),summary=document.querySelector('#wallet-holdings-total').getBoundingClientRect();return {left:summary.left-hero.left,right:hero.right-summary.right};});assert(inset.left>=16&&inset.right>=16,JSON.stringify(inset));
    const sizes=await page.getByRole('tab').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height];}));assert(sizes.every(([w,h])=>w>=44&&h>=44),JSON.stringify(sizes));
    if([390,1280].includes(viewport.width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(screenshots,`portfolio-${tab.toLowerCase()}-${theme}-${viewport.width}.png`),fullPage:true});}
   }
  }
  await page.setViewportSize({width:320,height:800});await page.addStyleTag({content:'html{font-size:200%}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  checks.push('all three panels fit phone, landscape, tablet and desktop in both themes; tab targets are at least 44px');
  await page.setViewportSize({width:390,height:844});await page.locator('#wallet-receive').click();
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(screenshots,`receive-asset-${theme}.png`)});}
  await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Tokens',exact:true}).click();await walletClick(page,'near-send');await page.locator('#near-send-dialog').waitFor();await page.keyboard.press('Escape');
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  await context.setOffline(true);await page.reload();await ready();
  for(const tab of ['Tokens','DeFi','NFTs']){await page.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await page.getByRole('tab',{selected:true}).innerText(),tab);}
  assert.equal(await state(),before);assert.deepEqual(errors,[]);
  checks.push('the new modules load and tabs work after an actual offline service-worker reload without changing stored account data');
  const sourceFiles={};for(const file of ['money.html','money.js','wallet-portfolio.js','wallet-portfolio.css','wallet-tokens.js','wallet-actions.js','evm-wallet-ui.js','evm-transfer-ui.js','receiving-link-ui.js','near-wallet.js','chat-sw.js'])sourceFiles['web/public/'+file]=require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(__dirname,'public',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'wallet-portfolio-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sourceFiles,scope:'Disposable Edge account, blocked APIs, reduced motion, offline worker. No user wallet, funds, signatures, NFT reads or physical devices.'},null,2)+'\n');
  console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
