const {walletClick}=require('./wallet-test-ui.cjs');
const {openWalletSection}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const reportDirectory=process.env.LENZ_WALLET_ACTIONS_REPORT_DIR??__dirname;await fs.mkdir(path.join(reportDirectory,'evidence'),{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  let reads=0,delay=false;
  await page.route('**/api/**',async route=>{
   if(route.request().url().endsWith('/api/tokens/metadata')){const request=route.request().postDataJSON();return route.fulfill({json:{request,matches:[{network:'ethereum',contract:request.contract,name:'Fixture token',symbol:'LZT',decimals:6,observedAt:Date.now()}],unavailable:[]}});}
   if(!route.request().url().endsWith('/api/tokens/read'))return route.abort();
   reads++;const request=route.request().postDataJSON();assert.equal(request.publicConsent,true);
   if(delay)await new Promise(r=>setTimeout(r,400));
   const result={kind:'token-watch',request,name:'Fixture token',symbol:'LZT',decimals:6,balance:request.account?'1234500':null,price:null,blockHash:'0x'+'33'.repeat(32),blockNumber:'42',observedAt:Date.now(),executable:false};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#wallet-content').hidden&&document.querySelector('main').getAttribute('aria-busy')!=='true');
  await page.goto('http://127.0.0.1:4173/account.html?next=wallet');await page.locator('#account-create-name').fill('Amina');await page.locator('#account-local').click();await page.waitForURL('**/money.html');await page.locator('#wallet-content').waitFor();await ready();
  const contact=await page.evaluate(async()=>{const p=await(await import('/peer-crypto.js')).createIdentity('Bola');await(await import('/chat-store.js')).updateState(s=>s.contacts.push(p.profile));return p.profile;});
  await page.reload();await ready();
  for(const width of [320,390,768,900,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const tops=await page.locator('.wallet-primary-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top+n.getBoundingClientRect().height/2));assert(tops.length>0&&tops.every(y=>Math.abs(y-tops[0])<=1),'Action icons must stay in one row');}
  const before=await page.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {id:s.identity.profile.id,nearBox:s.nearBox,messages:s.messages,contacts:s.contacts};});
  for(const [id,label]of[['near-send','Send'],['near-receive','Receive'],['near-fund','Add tUSD']]){assert.equal(await page.locator('#'+id).getAttribute('aria-label'),label);}
  await walletClick(page,'near-send');await page.locator('#near-recipient').waitFor({state:'hidden'});await page.locator('#wallet-scan-recipient').waitFor();await page.locator('#near-send-amount').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Bola',exact:true}).filter({has:page.locator('.avatar')}).last().click();await page.locator('#near-send-amount').fill('2.5');
  assert((await page.locator('#near-send-dialog').innerText()).includes('public on NEAR testnet'));assert.equal(await page.locator('#near-send-dialog .wallet-close').innerText(),'');
  await page.locator('#wallet-recipient-selected').click();await page.locator('#wallet-recipient-picker').waitFor();
  await page.locator('#wallet-paste-recipient').click();await page.locator('#contact-card').fill('0x'+'11'.repeat(20));await page.locator('#review-contact').click();assert((await page.locator('#contact-feedback').innerText()).includes('EVM address'));
  await page.locator('#contact-card').fill(JSON.stringify(contact));await page.locator('#review-contact').click();await page.locator('#near-send-amount').waitFor();assert((await page.locator('#wallet-recipient-selected').innerText()).includes('Bola'));
  await page.locator('#near-send-dialog .wallet-close').click();
  checks.push('payment actions use icons with accessible names; recipient selection preserves contact verification');
  await walletClick(page,'near-send');await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Fixture camera declined');};});await page.locator('#wallet-scan-recipient').click();
  await page.waitForFunction(()=>document.querySelector('#contact-feedback').textContent.includes('Camera unavailable'));await page.locator('[data-close="add-contact"]').click();await page.locator('#wallet-recipient-picker').waitFor();await page.keyboard.press('Escape');
  checks.push('scan opens camera flow; denied camera falls back to ID/image and closing returns to Send');
  await walletClick(page,'near-receive');await page.waitForFunction(()=>document.querySelector('#wallet-receive-qr').width>300);
  const qr=await page.evaluate(async()=>{const m=await import('/contact-card.js'),c=document.querySelector('#wallet-receive-qr');return (await m.decodeContact(m.scanPixels(c,c.width,c.height))).id;});assert.equal(qr,before.id);
  await page.locator('#near-payment-file').waitFor({state:'hidden'});await page.locator('#wallet-receive-copy').click();await page.waitForFunction(()=>document.querySelector('#wallet-receive-feedback').textContent.includes('copied'));
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(reportDirectory,`evidence/wallet-receive-${theme}-${width}.png`),fullPage:false});}
  await page.keyboard.press('Escape');checks.push('Receive displays a locally decodable QR first, copy works and incoming payment import stays collapsed in both themes');
  await page.locator('#wallet-add-token').click();await page.locator('#wallet-token-contract').fill('0x'+'11'.repeat(20));await page.waitForFunction(()=>!document.querySelector('#wallet-token-save').disabled);assert(await page.locator('#wallet-token-consent').isHidden());assert.equal(await page.locator('#wallet-token-account').count(),0);assert.equal(await page.locator('#wallet-token-symbol').inputValue(),'LZT');assert.equal(reads,0);await page.keyboard.press('Escape');
  checks.push('token metadata autofills without wallet access; owned-balance consent and imported-token Send are covered by wallet-holdings-browser');
  await walletClick(page,'near-send');await page.locator('.wallet-person').click();await page.locator('#near-send-amount').fill('2.5');
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(reportDirectory,`evidence/wallet-send-${theme}-${width}.png`),fullPage:false});}
  await page.keyboard.press('Escape');for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(reportDirectory,'evidence/wallet-current-'+theme+'.png'),fullPage:false});}await page.waitForFunction(()=>document.querySelector('#money-cache-status').dataset.offlineState==='ready',null,{timeout:120000});await context.setOffline(true);await page.reload();await ready();assert.equal(await page.locator('.wallet-token-row').count(),0);assert.equal(reads,0);
  await openWalletSection(page,'defi');
  assert(!((await page.locator('#rhea-queue').innerText()).includes('execute when connected')));assert.deepEqual(errors,[]);
  for(const [name,url]of [['Supply','/markets.html?view=credit&action=supply'],['Borrow','/markets.html?view=credit&action=borrow'],['Liquidity','/markets.html?view=liquidity&action=liquidity']]){
    await page.locator('.defi-tabs').getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('.position-browse').getAttribute('href'),url);assert.equal(await page.locator('.position-track').count(),0);assert.equal(await page.locator('.position-unavailable strong').innerText(),({Supply:'Deposits unavailable',Borrow:'Borrowing unavailable',Liquidity:'Liquidity deposits unavailable'})[name]);assert.equal(await page.locator('#rhea-open').isVisible(),false);
  }
  checks.push('Supply, Borrow and Liquidity explain unavailable execution and link to the matching market action without changing funds');
  checks.push('offline reload preserves wallet state without network requests; wallet and payment dialogs fit phone and desktop');
  await fs.writeFile(path.join(reportDirectory,'wallet-actions-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,scope:'Disposable Edge account; real local QR/cryptography, fixture token reads, declined-camera simulation. No physical camera, wallet signature, funding or financial submission.'},null,2)+'\n');console.log(checks.map(s=>'PASS '+s).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
