const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {openIncoming,openWalletSection}=require('./wallet-test-ui.cjs');

(async()=>{
 const root=path.join(__dirname,'public'),contract='first-payment-fixture.lenz.testnet',checks=[],errors=[],funds=[],requests=[];
 const evidence=process.env.LENZ_UI_EVIDENCE_DIR??path.join(os.tmpdir(),'lenz-wallet-first-payment');await fs.mkdir(evidence,{recursive:true});
 let offline=false;
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try{
   if(pathname==='/api/testnet/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({network:'testnet',contract,ready:true}));return;}
   if(pathname==='/api/testnet/fund'){
    assert.equal(offline,false,'Offline handover cannot request another grant');let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);funds.push(request);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({root:{id:request.id,owner:request.owner,amount:request.amount},finality:'FINAL',txHash:'fixture-funding'}));return;
   }
   if(pathname.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'No external service in this isolated test.'}));return;}
   const configs={'/near-config.json':{network:'testnet',contract,ready:true},'/rhea-config.json':{network:'testnet',reserve:contract,ready:false},'/carrier-config.json':{version:1,carriers:[]},'/nostr-config.json':{version:1,relays:[]}};
   if(Object.hasOwn(configs,pathname)){res.setHeader('content-type','application/json');res.end(JSON.stringify(configs[pathname]));return;}
   const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(root+path.sep));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
  }catch(error){res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 const idle=page=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
 const check=async(name,task)=>{await task();checks.push(name);console.log('PASS '+name);};
 const closeDialogs=async page=>{for(let i=0;i<5&&await page.locator('dialog[open]').count();i++)await page.keyboard.press('Escape');};
 async function receive(page,packet){
  await page.locator('#wallet-receive').click();await page.locator('#wallet-asset-options').getByRole('button',{name:/^tUSD/}).click();await openIncoming(page);
  await page.locator('#near-payment-file').setInputFiles({name:'payment.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await idle(page);await page.locator('#near-import').click();await idle(page);
 }
 async function verifyPerson(page,id){
  await page.locator('#contact-card').fill(id);await page.locator('#review-contact').click();await page.locator('#contact-review').waitFor({state:'visible'});assert(await page.locator('#confirm-contact').isDisabled());await page.locator('#verified').check();await page.locator('#confirm-contact').click();await idle(page);
 }
 async function addSender(page,id){await openWalletSection(page,'people');await page.locator('#show-add-contact').click();await verifyPerson(page,id);await closeDialogs(page);}
 async function downloadPayment(page,amount){
  await page.locator('#near-send-amount').fill(amount);await page.locator('#near-send-form button[type=submit]').click();await page.locator('#near-handover').waitFor({state:'visible'});await idle(page);
  const pending=page.waitForEvent('download');await page.locator('#near-download').click();const download=await pending,packet=JSON.parse(await fs.readFile(await download.path(),'utf8'));await closeDialogs(page);return packet;
 }
 try{
  const contexts=await Promise.all([1,2,3].map(()=>browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}))),pages=await Promise.all(contexts.map(context=>context.newPage())),[a,b,c]=pages,ids=[];
  for(const [index,page]of pages.entries()){
   page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(offline)requests.push(request.url());});
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await page.goto(base+'/money.html');await page.locator('#device-profile>summary').click();await page.locator('#wallet-name').fill(['Amina','Bola','Chidi'][index]);await page.locator('#wallet-identity-form button[type=submit]').click();await page.locator('#wallet-content').waitFor({state:'visible'});await idle(page);
   await page.locator('#wallet-receive').click();await page.locator('#wallet-asset-options').getByRole('button',{name:/^tUSD/}).click();await page.locator('#near-share-card').click();await page.locator('#share-contact').waitFor({state:'visible'});await page.locator('.share-details>summary').click();ids.push(await page.locator('#my-lenz-id').inputValue());await closeDialogs(page);
  }
  await check('Three fresh visitors obtain their receiving IDs through Wallet Receive without funds or preconfigured contacts',async()=>{assert.equal(new Set(ids).size,3);assert.deepEqual(funds,[]);for(const page of pages)assert.equal(await page.locator('.wallet-offline-token').isVisible(),false);});
  await check('The wallet faucet reviews and adds one 100 tUSD grant, then opens the actual recipient picker',async()=>{
   await a.locator('#wallet-test-funds').click();await a.locator('#wallet-funding-confirm').waitFor({state:'visible'});await a.waitForFunction(()=>!document.querySelector('#wallet-funding-confirm').disabled);assert.deepEqual(funds,[]);assert.match(await a.locator('#wallet-funding-terms').innerText(),/100 tUSD/);
   await a.locator('#wallet-funding-confirm').click();await a.locator('#wallet-funding-send').waitFor({state:'visible'});assert.equal(funds.length,1);assert.equal(funds[0].amount,'100000000');await a.waitForFunction(()=>document.querySelector('#wallet-offline-amount').textContent==='100');
   await a.locator('#wallet-funding-send').click();await a.locator('#wallet-recipient-picker').waitFor({state:'visible'});assert(await a.locator('#wallet-paste-recipient').isVisible());
  });
  for(const page of pages)await page.waitForFunction(()=>document.querySelector('#money-cache-status').dataset.offlineState==='ready',null,{timeout:120000});
  offline=true;for(const context of contexts)await context.setOffline(true);for(const page of pages)assert.equal(await page.evaluate(()=>navigator.onLine),false);
  let first,second;
  await check('A first sender verifies a new recipient and shares an encrypted payment file while all visitors are offline',async()=>{
   await a.locator('#wallet-paste-recipient').click();await verifyPerson(a,ids[1]);await a.locator('#near-send-dialog').waitFor({state:'visible'});first=await downloadPayment(a,'20');assert.equal(typeof first.ciphertext,'string');assert.equal(Object.hasOwn(first,'amount'),false);await a.waitForFunction(()=>document.querySelector('#wallet-offline-amount').textContent==='80');
   await addSender(b,ids[0]);await receive(b,first);await b.waitForFunction(()=>document.querySelector('#wallet-offline-amount').textContent==='20');assert.match(await b.locator('#near-feedback').textContent(),/Payment saved.*confirm/);
  });
  await check('The recipient passes received funds onward to a third verified visitor before anyone reconnects',async()=>{
   await b.locator('#wallet-send').click();await b.locator('#evm-send-recipient').fill(ids[2]);await b.locator('#evm-send-lenz-continue').waitFor({state:'visible'});await b.locator('#evm-send-lenz-continue').click();await b.locator('#contact-review').waitFor({state:'visible'});assert(await b.locator('#confirm-contact').isDisabled());await b.locator('#verified').check();await b.locator('#confirm-contact').click();await b.locator('#near-send-dialog').waitFor({state:'visible'});second=await downloadPayment(b,'8');
   await addSender(c,ids[1]);await receive(c,second);await c.waitForFunction(()=>document.querySelector('#wallet-offline-amount').textContent==='8');await b.waitForFunction(()=>document.querySelector('#wallet-offline-amount').textContent==='12');
   assert.equal(await a.locator('#wallet-offline-amount').textContent(),'80');assert.equal(await b.locator('#wallet-offline-amount').textContent(),'12');assert.equal(await c.locator('#wallet-offline-amount').textContent(),'8');await openWalletSection(c,'offline');await c.locator('.wallet-balance-details>summary').click();assert.equal(await c.locator('#near-pending').textContent(),'8');assert.equal(await c.locator('#near-confirmed').textContent(),'0');
  });
  await check('Reopening the same received file cannot duplicate value and offline handover makes no funding or settlement request',async()=>{
   await receive(c,second);assert.match(await c.locator('#near-feedback').textContent(),/already received/);assert.equal(await c.locator('#wallet-offline-amount').textContent(),'8');assert.equal(funds.length,1);assert.equal(requests.some(url=>/\/api\/testnet\/(?:fund|settle)/.test(url)),false);assert.deepEqual(errors,[]);
   await c.screenshot({path:path.join(evidence,'third-visitor-offline-received.png'),fullPage:true});
  });
  await fs.writeFile(path.join(evidence,'wallet-first-payment-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,balances:{sender:'80',recipient:'12',onwardRecipient:'8'},fundingRequests:funds.length,offlineFinancialRequests:requests.filter(url=>/\/api\/testnet\/(?:fund|settle)/.test(url)).length,scope:'Three fresh isolated Windows Edge profiles. Actual Wallet faucet, receiving IDs, contact confirmation, browser signatures, encrypted payment-file downloads/imports and onward transfer. Funding receipt is simulated; no live funding, settlement, physical phones or Bluetooth mesh.'},null,2)+'\n');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
