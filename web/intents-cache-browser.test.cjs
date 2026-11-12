const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

for(const worker of ['chat-sw.js','sw.js'])test(worker+' retains private outcome services after a full offline restart',async()=>{
 const {fixture,managerKey,wallet,now,owner,signQuote}=await import('./intents-spend-fixture.mjs');
 const {fundingRequest}=await import('./public/private-funding.js');
 const fundingTerms={owner,chainId:'0x1',amount:'10000000000000000',refundDeadline:new Date(now+3600000).toISOString()};
 const fundingOffer={terms:fundingTerms,quote:signQuote({quoteRequest:fundingRequest(fundingTerms,{now}),quote:{amountIn:fundingTerms.amount,minAmountIn:fundingTerms.amount,amountOut:'9900000000000000',minAmountOut:'9900000000000000',depositAddress:'0x'+'34'.repeat(20),deadline:fundingTerms.refundDeadline,refundFee:'0',withdrawFee:'0'},timestamp:new Date(now).toISOString()})};
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-private-cache-'));let context,serving=true;const missing=[];
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/install'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache fixture</title>');return;}
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(pathname==='/intents-vendor/quote.js'){res.setHeader('Content-Type','text/javascript');const source=await fs.readFile(path.join(__dirname,'public/intents-vendor/quote.js'),'utf8');res.end(source.replace('ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc',managerKey));return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[pathname==='/'?'.html':path.extname(pathname)]??'application/octet-stream');
  try{res.end(await fs.readFile(path.join(__dirname,'public',pathname==='/'?'index.html':pathname)));}catch{missing.push(pathname);res.writeHead(404);res.end();}
 });
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'allow'});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];await page.goto(base+'/install');
  await page.evaluate(async worker=>{
   const registration=await navigator.serviceWorker.register('/'+worker,{scope:worker==='sw.js'?'/':'/money.html'});
   const active=registration.installing??registration.waiting??registration.active;
   if(active.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(active.state==='activated')resolve();if(active.state==='redundant')reject(Error('Cache installation failed'));};active.addEventListener('statechange',changed);changed();});
  },worker);
  await page.evaluate(async({offer,now,fundingOffer})=>{
   Date.now=()=>now;const store=await import('/chat-store.js'),p=await import('/peer-crypto.js');
   await store.updateState(async s=>{s.identity=await p.createIdentity('Offline owner');s.contacts=[(await p.createIdentity('Offline executor')).profile];});
   const s=await store.readState();await(await import('/private-spend-review.js')).savePrivateReview(offer,s.contacts[0],s.identity.profile.id,{token:{assetId:'nep141:eth.omft.near',blockchain:'eth',symbol:'ETH',decimals:18}});
   const transfer=await import('/evm-transfer.js'),lease={identity:{address:fundingOffer.terms.owner,chainId:'0x1'},assertCurrent(){},async request(method){return {eth_accounts:[fundingOffer.terms.owner],eth_chainId:'0x1',eth_getTransactionCount:'0x0',eth_gasPrice:'0x3b9aca00',eth_estimateGas:'0x5208',eth_getBalance:'0x56bc75e2d63100000'}[method];}};
   const baseReview=await transfer.prepareTransfer(lease,{asset:'native',recipient:fundingOffer.quote.quote.depositAddress,amount:'0.01',publicConsent:true});
   const fundingReview=transfer.validateReview({...baseReview,version:3,funding:fundingOffer});
   await(await import('/evm-transfer-store.js')).updateTransfers(rows=>rows.push({id:crypto.randomUUID(),review:fundingReview,state:'unknown',hash:null,createdAt:now,updatedAt:now,observation:null,error:'Wallet reply lost',fundingObservation:{type:'lenz/private-funding-status/v1',quoteSignature:fundingOffer.quote.signature,owner:fundingOffer.terms.owner,chainId:'0x1',asset:'nep141:eth.omft.near',depositAddress:fundingOffer.quote.quote.depositAddress,status:'REFUNDED',updatedAt:new Date(now-1000).toISOString(),observedAt:now,amountIn:'10000000000000000',amountOut:null,refundedAmount:'9999999999999000',withdrawFee:'0',settlementVerified:false,providerReportSigned:false}}));
  },{offer:fixture(),now,fundingOffer});
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  context=await open();await context.setOffline(true);page=context.pages()[0];
  await page.exposeFunction('offlinePrivateSignature',hex=>wallet.signMessage(Buffer.from(hex.slice(2),'hex')));
  await context.addInitScript(({owner,now})=>{
   Date.now=()=>now;const handlers=new Map();window.offlineMethods=[];
   window.ethereum={on:(e,h)=>handlers.set(e,h),removeListener:e=>handlers.delete(e),async request(v){offlineMethods.push(v.method);if(v.method==='personal_sign')return offlinePrivateSignature(v.params[0]);if(['eth_accounts','eth_requestAccounts'].includes(v.method))return [owner];if(v.method==='eth_chainId')return '0x1';throw Error('Unexpected offline wallet read');}};
  },{owner:wallet.address.toLowerCase(),now});
  const response=await page.goto(base+(worker==='sw.js'?'/':'/money.html'));assert(response.fromServiceWorker());
  const imports=await page.evaluate(async()=>{
   const [inbox,outbox,spend,status,funding,transfer]=await Promise.all([import('/intents-courier.js'),import('/intents-spend-outbox.js'),import('/intents-spend.js'),import('/intents-status.js'),import('/private-funding.js'),import('/evm-transfer-service.js')]);
   await import('/private-funding-ui.js');await import('/evm-transfer-store.js');const account=await import('/market-account-overview.js');
   return [inbox.observeConfidentialRequest,inbox.submitConfidentialRequest,outbox.confidentialSpendOutbox.acceptReport,spend.checkConfidentialSpend,status.checkConfidentialObservation,funding.checkPrivateFunding,transfer.createTransferService,account.marketAccountOverview].map(value=>typeof value);
  });
  assert.deepEqual(imports,Array(8).fill('function'));
  const accountStyles=await page.evaluate(async()=>{const response=await fetch('/account-overview.css');return {ok:response.ok,text:await response.text()};});assert.equal(accountStyles.ok,true);assert.match(accountStyles.text,/\.account-overview\{display:grid/);
  const fundingRows=await page.evaluate(async()=>(await import('/evm-transfer-store.js')).readTransfers());assert.equal(fundingRows[0].review.funding.terms.owner,owner);assert.equal(fundingRows[0].state,'unknown');assert.equal(fundingRows[0].review.funding.quote.signature,fundingOffer.quote.signature);assert.equal(fundingRows[0].fundingObservation.status,'REFUNDED');assert.equal(fundingRows[0].fundingObservation.observedAt,now);assert.equal(fundingRows[0].fundingObservation.refundedAmount,'9999999999999000');assert.equal(fundingRows[0].fundingObservation.settlementVerified,false);
  const review=await page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview());assert.equal(review.assets[0].decimals,18);
  await page.evaluate(()=>import('/private-spend-ui.js'));assert(await page.evaluate(async()=>(await fetch('/private-spend.css')).ok));
  assert.equal(await page.evaluate(async()=>typeof(await import('/private-executor-ui.js')).mountPrivateExecutor),'function');
  if(worker==='sw.js')return;
  await page.locator('#private-executor-open').click();await page.waitForFunction(()=>document.querySelector('#private-executor-dialog').getAttribute('aria-busy')==='false');assert.match(await page.locator('#private-executor-connection').innerText(),/Offline/);assert(await page.locator('#private-executor-submit').isDisabled());await page.locator('#private-executor-close').click();
  await page.locator('#private-funding-open').click();await page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Wallet response lost · check before trying again'));assert(await page.locator('#private-funding-prepare').isDisabled());assert.match(await page.locator('#private-funding-history').innerText(),/Reported refund · unverified/);assert.match(await page.locator('#private-funding-history').innerText(),/Checked/);assert(await page.getByRole('button',{name:'Check funding',exact:true}).isDisabled());await page.locator('#private-funding-close').click();
  await page.locator('#private-spend-open').click();await page.locator('#private-spend-approve').waitFor({state:'visible'});
  assert.match(await page.locator('#private-spend-review').innerText(),/0\.01 ETH/);assert.match(await page.locator('#private-spend-review').innerText(),/Ethereum/);
  await page.locator('#private-spend-approve').click();await page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
  assert(!(await page.evaluate(()=>offlineMethods)).includes('eth_getBalance'));
 }finally{
  if(missing.length)console.log('Unavailable cache fixture resources:',JSON.stringify([...new Set(missing)]));
  await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
 }
});
