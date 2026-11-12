const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

async function uiFixture(run,{swap=false}={}){
 const {fixture,managerKey,wallet,now,signQuote}=await import('./intents-spend-fixture.mjs'),api={prepared:0,mode:'ready',release:null};
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  if(file==='/intents-vendor/quote.js'){res.end(`import {verifyQuoteSignature as verify} from '/fixture-quote.js';export const verifyQuoteSignature=q=>verify(q,${JSON.stringify(managerKey)});`);return;}
  if(file==='/api/receive/assets'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tokens:[{assetId:'nep141:eth.omft.near',symbol:'ETH',blockchain:'eth',decimals:18},...(swap?[{assetId:'nep141:usdc.near',symbol:'USDC',blockchain:'near',decimals:6}]:[])]}));return;}
  if(file==='/api/private-spend/prepare'||file==='/api/private-spend/swap-prepare'){
   let body='';for await(const c of req)body+=c;const chosen=JSON.parse(body),offer=fixture();
   assert.equal(chosen.amount,'10000000000000000');
   if(swap){assert.equal(file,'/api/private-spend/swap-prepare');assert.equal(chosen.destinationAsset,'nep141:usdc.near');assert.equal(chosen.minOutput,'25000000');assert.equal(chosen.recipient,offer.terms.owner);offer.terms.destinationAsset=chosen.destinationAsset;offer.terms.recipient=chosen.recipient;offer.quote.quoteRequest.destinationAsset=chosen.destinationAsset;offer.quote.quoteRequest.recipient=chosen.recipient;offer.quote.quote.amountOut='27000000';offer.quote.quote.minAmountOut='26000000';signQuote(offer.quote);}
   else {assert.equal(chosen.minOutput,chosen.amount);assert.equal(chosen.recipient,offer.terms.recipient);}
   offer.terms.minOutput=chosen.minOutput;api.offer=offer;
   api.prepared++;if(api.mode==='delay')await new Promise(r=>api.release=r);
   if(api.mode==='unavailable'){res.writeHead(503);res.end('{}');return;}
   if(api.mode==='changed'){offer.terms.recipient='0x'+'33'.repeat(20);offer.quote.quoteRequest.recipient=offer.terms.recipient;signQuote(offer.quote);}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:'awaiting-owner-review',offer}));return;
  }
  if(file.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('privateSign',hex=>wallet.signMessage(Buffer.from(hex.slice(2),'hex')));
  await context.addInitScript(({owner,now})=>{
   window.privateTime=now;Date.now=()=>privateTime;const handlers=new Map();window.privateWallet={calls:[],address:owner,chain:'0x1',delay:false,release:null,emit:(e,v)=>{for(const h of [...(handlers.get(e)??[])])h(v);}};
   window.ethereum={on:(e,h)=>{if(!handlers.has(e))handlers.set(e,new Set());handlers.get(e).add(h);},removeListener:(e,h)=>handlers.get(e)?.delete(h),async request(v){
    privateWallet.calls.push(v);if(v.method==='personal_sign'){if(privateWallet.delay)await new Promise(r=>privateWallet.release=r);return privateSign(v.params[0]);}
    return {eth_accounts:[privateWallet.address],eth_requestAccounts:[privateWallet.address],eth_chainId:privateWallet.chain,eth_blockNumber:'0x1',eth_getBalance:'0x0',eth_getCode:'0x'}[v.method];
   }};
  },{owner:wallet.address.toLowerCase(),now});
  await page.goto(base+'/money.html');
  await page.evaluate(async()=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js');window.privateExecutorIdentity=await p.createIdentity('Executor');await store.updateState(async s=>{s.identity=await p.createIdentity('Owner');s.contacts=[privateExecutorIdentity.profile];});});
  if(await page.locator('#wallet-account-dialog').count())await page.locator('#wallet-account').click();
  await page.locator('#evm-connect').click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);
  if(await page.locator('#wallet-account-dialog').count())await page.locator('#wallet-account-dialog').evaluate(n=>n.close());
  const open=async()=>{await page.locator('#private-spend-open').click();await page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false'&&(document.querySelector('#private-spend-prepare').disabled===false||document.querySelector('#private-spend-review').hidden===false));};
  await open();
  const prepare=async()=>{await page.locator('#private-spend-recipient').fill('0x'+'22'.repeat(20));await page.locator('#private-spend-amount').fill('0.01');await page.locator('#private-spend-prepare').click();};
  const reviewed=()=>page.waitForFunction(()=>!document.querySelector('#private-spend-review').hidden&&document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
  const rows=()=>page.evaluate(async()=>(await import('/intents-spend-outbox.js')).confidentialSpendOutbox.list());
  const signed=()=>page.evaluate(()=>privateWallet.calls.filter(c=>c.method==='personal_sign').length);
  await run({page,context,base,api,prepare,reviewed,rows,signed,open,now});assert.deepEqual(errors,[]);
 }finally{api.release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
async function makeReport(f,{status='SUCCESS',offset=0}={}){
 return f.page.evaluate(async({status,offset})=>{
  const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),transport=await import('/carrier-protocol.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;
  const state=await store.readState(),row=(await outbox.list())[0],draft=await(await import('/private-spend-review.js')).readPrivateReview();
  const observation={type:'lenz/private-status/v1',depositAddress:draft.offer.quote.quote.depositAddress,status,updatedAt:new Date(privateTime+offset).toISOString(),observedAt:privateTime,amountIn:status==='SUCCESS'?'10000000000000000':null,amountOut:status==='SUCCESS'?'10000000000000000':null,refundedAmount:null,withdrawFee:'0',settlementVerified:false,providerReportSigned:false};
  const packet=await p.sealMessage(privateExecutorIdentity,state.identity.profile,{type:'lenz/private-spend-report/v1',id:row.id,observation});
  return {type:'lenz/private-update-file/v1',envelope:await transport.wrapForCarrier(privateExecutorIdentity,packet)};
 },{status,offset});
}
test('Wallet reviews, signs once, saves and reopens a private approval',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();assert.equal(f.api.prepared,1);assert.match(await f.page.locator('#private-spend-review').innerText(),/0\.01 ETH/);assert.equal(await f.signed(),0);
 await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 assert.equal(await f.signed(),1);assert.equal((await f.rows()).length,1);assert(await f.page.locator('#private-spend-approve').isDisabled());
 await f.page.reload();await f.open();assert.match(await f.page.locator('#private-spend-history').innerText(),/Waiting for delivery/);assert(await f.page.locator('#private-spend-approve').isDisabled());
}));
test('cancelled preparation and a changed quote cannot save or prompt',()=>uiFixture(async f=>{
 f.api.mode='delay';await f.prepare();await f.page.waitForTimeout(50);await f.page.locator('#private-spend-close').click();f.api.release?.();f.api.mode='ready';
 await f.open();assert.equal(await f.page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview()),null);assert.equal(await f.signed(),0);
 f.api.mode='changed';await f.prepare();await f.page.waitForFunction(()=>document.querySelector('#private-spend-feedback').textContent.includes('Could not'));
 assert(await f.page.locator('#private-spend-review').isHidden());assert.equal(await f.signed(),0);
}));
test('cancelled signing holds the wallet prompt and never queues a late approval',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>privateWallet.delay=true);await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>!!privateWallet.release);
 await f.page.keyboard.press('Escape');await f.open();await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
 assert.equal(await f.signed(),1);await f.page.evaluate(()=>{privateWallet.delay=false;privateWallet.release();});await f.page.waitForTimeout(100);assert.deepEqual(await f.rows(),[]);
}));
test('wallet changes during signing and chat-only recovery prevent financial approvals',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>privateWallet.delay=true);await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>!!privateWallet.release);
 await f.page.evaluate(()=>{privateWallet.address='0x'+'33'.repeat(20);privateWallet.emit('accountsChanged',[privateWallet.address]);privateWallet.delay=false;privateWallet.release();});
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert.deepEqual(await f.rows(),[]);
 await f.page.evaluate(async()=>{const store=await import('/chat-store.js');await store.updateState(s=>{s.identity.access='lenz/recovered-chat/v1';});});
 await f.page.locator('#private-spend-refresh').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-approve').disabled);assert.equal(await f.signed(),1);
}));
test('unavailable new preparation retains the recipient and amount',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.locator('#private-spend-new').click();f.api.mode='unavailable';await f.prepare();
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert(await f.page.locator('#private-spend-form').isVisible());
 assert.equal(await f.page.locator('#private-spend-amount').inputValue(),'0.01');assert.equal(await f.page.locator('#private-spend-recipient').inputValue(),'0x'+'22'.repeat(20));
}));
test('a saved review can be signed and its encrypted request exported offline',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.context.setOffline(true);await f.page.locator('#private-spend-approve').click();
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 const download=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Save request',exact:true}).click();const file=await download,text=await fs.readFile(await file.path(),'utf8');
 assert(!text.includes('intents.far'));assert(!text.includes('secp256k1:'));const value=JSON.parse(text);assert.equal(value.type,'lenz/private-request-file/v1');
 assert.equal(value.envelope.packet.to,(await f.rows())[0].executor);await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Shared · completion unknown'));
}));
test('encrypted executor reports remain explicitly unverified after expiry and restart',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 const report=await makeReport(f);
 await f.page.locator('#private-spend-update').setInputFiles({name:'update.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Provider reports success · completion not yet verified'));
 assert.equal((await f.rows())[0].settlementVerified,false);await f.page.evaluate(()=>privateTime+=4*86400000);
 await f.page.locator('#private-spend-refresh').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert(await f.page.locator('#private-spend-approve').isDisabled());
 await f.page.reload();await f.open();assert.match(await f.page.locator('#private-spend-history').innerText(),/completion not yet verified/);
}));
test('private review reflows in all themes and supports keyboard dismissal',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();const output=path.join(os.tmpdir(),'lenz-private-wallet-ui-20261111');await fs.mkdir(output,{recursive:true});
 for(const theme of ['light','dim','dark'])for(const width of [320,390,844,1280]){
  await f.page.setViewportSize({width,height:width===844?390:844});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  assert(await f.page.locator('#private-spend-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await f.page.screenshot({path:path.join(output,`private-${theme}-${width}.png`)});
 }
 await f.page.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await f.page.locator('#private-spend-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));
 await f.page.keyboard.press('Escape');assert(await f.page.locator('#private-spend-dialog').isHidden());assert(await f.page.locator('#private-spend-open').evaluate(n=>n===document.activeElement));
}));
test('failed approval storage preserves the review and exposes no handoff',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>{
  window.privateOriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value.privateSpendBox)throw new DOMException('Storage quota exhausted','QuotaExceededError');return privateOriginalPut.call(this,value,...args);};
 });
 await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
 await f.page.evaluate(()=>IDBObjectStore.prototype.put=privateOriginalPut);assert.equal(await f.signed(),1);assert.deepEqual(await f.rows(),[]);
 assert.equal(await f.page.getByRole('button',{name:'Save request',exact:true}).count(),0);assert(await f.page.locator('#private-spend-review').isVisible());
}));
test('replacing the Lenz account while a wallet prompt is open cannot queue its late signature',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>privateWallet.delay=true);await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>!!privateWallet.release);
 await f.page.evaluate(async()=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Replacement');delete s.privateReviewKey;delete s.privateReviewBox;});privateWallet.delay=false;privateWallet.release();});
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert.deepEqual(await f.rows(),[]);assert.equal(await f.signed(),1);
}));
test('an unrelated authenticated file cannot claim an executor update was saved',()=>uiFixture(async f=>{
 const value=await f.page.evaluate(async()=>{
  const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),transport=await import('/carrier-protocol.js'),state=await store.readState();
  const packet=await p.sealMessage(privateExecutorIdentity,state.identity.profile,{type:'lenz/unrelated/v1'});
  return {type:'lenz/private-update-file/v1',envelope:await transport.wrapForCarrier(privateExecutorIdentity,packet)};
 });
 await f.page.locator('#private-spend-update').setInputFiles({name:'unrelated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
 assert(!(await f.page.locator('#private-spend-feedback').innerText()).includes('Executor update saved'));assert.deepEqual(await f.rows(),[]);
}));
test('Hide balances masks saved private history while explicit review keeps its amounts',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 await f.page.evaluate(()=>localStorage.setItem('lenz-wallet-balances-hidden','true'));await f.page.reload();await f.open();
 assert(!(await f.page.locator('#private-spend-history').innerText()).includes('0.01'));assert.match(await f.page.locator('#private-spend-review').innerText(),/0\.01 ETH/);
 assert.match(await f.page.locator('#private-spend-review').innerText(),/Ethereum/);assert.equal(await f.page.locator('#private-spend-review img').first().getAttribute('src'),'/asset-icons/eth.svg');
}));
test('stale and forged executor updates preserve the saved report and report intake honestly',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 const input=async value=>{await f.page.locator('#private-spend-update').setInputFiles({name:'report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');};
 await input(await makeReport(f));assert.equal((await f.rows())[0].observation.status,'SUCCESS');
 await input(await makeReport(f,{status:'PENDING_DEPOSIT',offset:-1000}));assert.equal((await f.rows())[0].observation.status,'SUCCESS');assert.match(await f.page.locator('#private-spend-feedback').innerText(),/The newer payment update was kept/);
 const forged=await makeReport(f);forged.envelope.signature=forged.envelope.signature.slice(0,-2)+(forged.envelope.signature.endsWith('00')?'01':'00');
 await input(forged);assert.equal((await f.rows())[0].observation.status,'SUCCESS');assert.match(await f.page.locator('#private-spend-feedback').innerText(),/Could not/);
}));
test('a self-consistent quote cannot replace the chosen recipient',()=>uiFixture(async f=>{
 f.api.mode='changed';await f.prepare();await f.page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
 assert(await f.page.locator('#private-spend-review').isHidden());assert.equal(await f.page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview()),null);assert.equal(await f.signed(),0);
}));
test('asset and signer menus retain exact native values and keyboard cancellation',()=>uiFixture(async f=>{
 const asset=f.page.getByRole('combobox',{name:'Asset',exact:true});await asset.click();assert.equal(await asset.getAttribute('aria-expanded'),'true');assert.equal(await f.page.getByRole('option',{name:'ETH · Ethereum',exact:true}).locator('img').getAttribute('src'),'/asset-icons/eth.svg');
 await asset.press('Enter');assert.equal(await f.page.locator('#private-spend-asset').inputValue(),'nep141:eth.omft.near');
 await f.prepare();await f.reviewed();assert.equal(await f.page.locator('#private-spend-signer').inputValue(),'0');assert.equal(await f.page.getByRole('combobox',{name:'Your wallet',exact:true}).innerText(),'Browser wallet');
 await f.page.evaluate(()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Second wallet'},provider:{...ethereum}}})));
 const signer=f.page.getByRole('combobox',{name:'Your wallet',exact:true});await signer.press('ArrowDown');await signer.press('End');await signer.press('Enter');
 assert.equal(await f.page.locator('#private-spend-signer').inputValue(),'1');assert.equal(await signer.innerText(),'Second wallet');
 await signer.press('Enter');await signer.press('Home');await signer.press('Escape');assert.equal(await f.page.locator('#private-spend-signer').inputValue(),'1');assert.equal(await signer.getAttribute('aria-expanded'),'false');assert(await signer.evaluate(n=>n===document.activeElement));assert.equal(await f.signed(),0);
}));
test('Wallet prepares a private swap, signs offline and retains distinct asset units in saved history',()=>uiFixture(async f=>{
 await f.page.locator('#private-spend-close').click();await f.page.locator('#private-swap-open').click();
 await f.page.waitForFunction(()=>document.querySelector('#private-spend-destination').options.length===2);
 await f.page.locator('#private-spend-destination').selectOption('nep141:usdc.near',{force:true});
 await f.page.locator('#private-spend-amount').fill('0.01');await f.page.locator('#private-spend-minimum').fill('25');await f.page.locator('#private-spend-prepare').click();await f.reviewed();
 assert.equal(f.api.prepared,1);assert.equal(await f.signed(),0);const text=await f.page.locator('#private-spend-review').innerText();assert.match(text,/0\.01 ETH/);assert.match(text,/26 USDC/);assert.match(text,/Swap/);
 assert.match(text,/From network\s+Ethereum/);assert.match(text,/To network\s+NEAR/);assert.equal(await f.page.locator('#private-spend-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
 if(process.env.LENZ_SWAP_EVIDENCE){await fs.mkdir(process.env.LENZ_SWAP_EVIDENCE,{recursive:true});await f.page.locator('#private-spend-dialog').evaluate(n=>n.scrollTop=0);for(const width of [390,1280])for(const theme of ['light','dark']){await f.page.setViewportSize({width,height:900});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await f.page.screenshot({path:path.join(process.env.LENZ_SWAP_EVIDENCE,`swap-${theme}-${width}.png`)});}await f.page.setViewportSize({width:390,height:844});}
 const draft=await f.page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview());assert.equal(draft.assets.length,2);assert.equal(draft.offer.terms.minOutput,'25000000');
 await f.context.setOffline(true);await f.page.locator('#private-spend-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-spend-history').textContent.includes('Waiting for delivery'));
 const row=(await f.rows())[0];assert.equal(row.destinationAsset,'nep141:usdc.near');assert.equal(row.minOutput,'26000000');assert.equal(row.settlementVerified,false);assert.equal(await f.signed(),1);
 const download=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Save request',exact:true}).click();const file=await download,textFile=await fs.readFile(await file.path(),'utf8');assert(!textFile.includes('usdc.near'));assert(!textFile.includes('secp256k1:'));
 await f.context.setOffline(false);await f.page.reload();await f.open();await f.page.locator('#private-spend-history summary').click();assert.match(await f.page.locator('#private-spend-history').innerText(),/26 USDC/);assert(await f.page.locator('#private-spend-approve').isDisabled());
},{swap:true}));

test('cancelling Swap preserves an existing Pay review across both action buttons',()=>uiFixture(async f=>{
 await f.prepare();await f.reviewed();const before=await f.page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview());
 await f.page.locator('#private-spend-close').click();await f.open();assert(await f.page.locator('#private-spend-review').isVisible());
 await f.page.locator('#private-spend-close').click();await f.page.locator('#private-swap-open').click();await f.page.locator('#private-spend-form').waitFor();
 assert(await f.page.locator('#private-spend-review').isHidden());await f.page.locator('#private-spend-close').click();await f.open();
 assert(await f.page.locator('#private-spend-review').isVisible());assert.deepEqual(await f.page.evaluate(async()=>(await import('/private-spend-review.js')).readPrivateReview()),before);assert.equal(f.api.prepared,1);assert.equal(await f.signed(),0);
}));
