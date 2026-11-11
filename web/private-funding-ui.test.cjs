const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function fundingUI(run){
 const {managerKey,owner,now,signQuote}=await import('./intents-spend-fixture.mjs');
 const api={mode:'ready',calls:0,release:null,quoteAge:0};let origin;
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/json');
  if(file==='/intents-vendor/quote.js'){res.end(`import {verifyQuoteSignature as verify} from '/fixture-quote.js';export const verifyQuoteSignature=q=>verify(q,${JSON.stringify(managerKey)});`);return;}
  if(file==='/api/private-spend/fund-prepare'){
   let body='';for await(const c of req)body+=c;const terms=JSON.parse(body);api.calls++;
   if(api.mode==='delay')await new Promise(r=>api.release=r);
   if(api.mode==='unavailable'){res.writeHead(503);res.end('{}');return;}
   const {fundingRequest}=await import('./public/private-funding.js');
   const quote=signQuote({quoteRequest:fundingRequest(terms,{now}),quote:{amountIn:terms.amount,minAmountIn:terms.amount,amountOut:'9900000000000000',minAmountOut:'9900000000000000',depositAddress:'0x'+'34'.repeat(20),deadline:terms.refundDeadline,refundFee:'1000',withdrawFee:'0'},timestamp:new Date(now-api.quoteAge).toISOString()});
   if(api.mode==='changed'){terms.owner='0x'+'22'.repeat(20);quote.quoteRequest.recipient=terms.owner;quote.quoteRequest.refundTo=terms.owner;signQuote(quote);}
   res.end(JSON.stringify({state:'awaiting-funding-review',offer:{terms,quote}}));return;
  }
  if(file.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({owner,now})=>{
   window.fundingTime=now;Date.now=()=>fundingTime;const handlers=new Map();window.fundingWallet={owner,chain:'0x1',calls:[],mode:'ready',release:null,transaction:null,emit:(e,v)=>{for(const h of handlers.get(e)??[])h(v);}};
   window.ethereum={on:(e,h)=>{if(!handlers.has(e))handlers.set(e,new Set());handlers.get(e).add(h);},removeListener:(e,h)=>handlers.get(e)?.delete(h),async request(v){
    fundingWallet.calls.push(v);
    if(v.method==='eth_sendTransaction'){
     const rows=await(await import('/evm-transfer-store.js')).readTransfers();if(rows.length!==1||rows[0].review.version!==3||rows[0].state!=='awaiting_wallet')throw Error('Attempt not durably saved');
     fundingWallet.transaction=v.params[0];if(fundingWallet.mode==='delay')await new Promise(r=>fundingWallet.release=r);if(fundingWallet.mode==='lost')throw Error('Reply lost');return '0x'+'ab'.repeat(32);
    }
    if(v.method==='eth_getTransactionByHash')return fundingWallet.transaction?{...fundingWallet.transaction,hash:'0x'+'ab'.repeat(32),input:'0x',blockNumber:'0x2a',blockHash:'0x'+'cd'.repeat(32),transactionIndex:'0x0'}:null;
    if(v.method==='eth_getTransactionReceipt')return fundingWallet.transaction?{transactionHash:'0x'+'ab'.repeat(32),from:fundingWallet.owner,to:'0x'+'34'.repeat(20),blockNumber:'0x2a',blockHash:'0x'+'cd'.repeat(32),transactionIndex:'0x0',status:'0x1',gasUsed:'0x5208',effectiveGasPrice:'0x3b9aca00',logs:[]}:null;
    if(v.method==='eth_getBlockByNumber')return v.params[0]==='finalized'?{number:'0x2b',hash:'0x'+'ee'.repeat(32)}:{number:'0x2a',hash:'0x'+'cd'.repeat(32),transactions:['0x'+'ab'.repeat(32)]};
    return {eth_accounts:[fundingWallet.owner],eth_requestAccounts:[fundingWallet.owner],eth_chainId:fundingWallet.chain,eth_blockNumber:'0x1',eth_getBalance:'0x56bc75e2d63100000',eth_getCode:'0x',eth_getTransactionCount:'0x0',eth_gasPrice:'0x3b9aca00',eth_estimateGas:'0x5208'}[v.method];
   }};
  },{owner,now});
  await page.goto(origin+'/money.html');
  await page.evaluate(async()=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Owner');});});
  const connect=async()=>{if(await page.locator('#wallet-account-dialog').count())await page.locator('#wallet-account').click();await page.locator('#evm-connect').click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);if(await page.locator('#wallet-account-dialog').count())await page.locator('#wallet-account-dialog').evaluate(n=>n.close());};
  await connect();const open=()=>page.locator('#private-funding-open').click();
  const prepare=async()=>{await open();await page.locator('#private-funding-amount').fill('0.01');await page.locator('#private-funding-consent').check();await page.locator('#private-funding-prepare').click();};
  const reviewed=()=>page.waitForFunction(()=>!document.querySelector('#private-funding-review').hidden&&document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='false');
  const rows=()=>page.evaluate(async()=>(await import('/evm-transfer-store.js')).readTransfers());
  const sends=()=>page.evaluate(()=>fundingWallet.calls.filter(c=>c.method==='eth_sendTransaction').length);
  await run({page,context,api,owner,now,connect,open,prepare,reviewed,rows,sends});assert.deepEqual(errors,[]);
 }finally{api.release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}

test('Wallet funding reviews the exact deposit and persists its signed quote before sending',()=>fundingUI(async f=>{
 await f.prepare();await f.reviewed();assert.equal(await f.sends(),0);assert.match(await f.page.locator('#private-funding-review').innerText(),/0\.0099 ETH/);
 assert.match(await f.page.locator('#private-funding-terms').innerText(),/Network fee estimate/);assert.match(await f.page.locator('#private-funding-review').innerText(),/Privacy and refunds are not yet verified/);
 assert.match(await f.page.locator('#private-funding-terms').innerText(),/Send before/);assert.match(await f.page.locator('#private-funding-terms').innerText(),/Refund can begin after/);
 await f.page.locator('#private-funding-review summary').click();assert.match(await f.page.locator('#private-funding-exact').innerText(),new RegExp(f.owner));
 await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));
 assert.equal(await f.sends(),1);const rows=await f.rows();assert.equal(rows[0].review.funding.terms.owner,f.owner);assert.equal(rows[0].review.transaction.to,'0x'+'34'.repeat(20));
 await f.page.reload();await f.connect();await f.open();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));assert.equal((await f.rows()).length,1);
}));

test('funding requires public consent and preserves entries when the partner is unavailable',()=>fundingUI(async f=>{
 await f.open();await f.page.locator('#private-funding-amount').fill('0.01');assert(await f.page.locator('#private-funding-prepare').isDisabled());f.api.mode='unavailable';await f.page.locator('#private-funding-consent').check();await f.page.locator('#private-funding-prepare').click();
 await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='false');assert.equal(await f.page.locator('#private-funding-amount').inputValue(),'0.01');assert.match(await f.page.locator('#private-funding-feedback').innerText(),/unavailable/);assert.equal(await f.sends(),0);
}));
test('cancelled or substituted funding quotes cannot create a deposit attempt',()=>fundingUI(async f=>{
 f.api.mode='delay';await f.prepare();await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='true');await f.page.locator('#private-funding-close').click();f.api.release?.();await f.open();assert(await f.page.locator('#private-funding-review').isHidden());assert.deepEqual(await f.rows(),[]);
 f.api.mode='changed';await f.page.locator('#private-funding-prepare').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='false');assert.match(await f.page.locator('#private-funding-feedback').innerText(),/transfer details changed/);assert.equal(await f.sends(),0);
}));
test('wallet changes and chat-only recovery block funding before a prompt',()=>fundingUI(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>{fundingWallet.chain='0x2105';fundingWallet.emit('chainChanged','0x2105');});assert(await f.page.locator('#private-funding-approve').isDisabled());assert.equal(await f.sends(),0);assert.deepEqual(await f.rows(),[]);
 await f.page.locator('#private-funding-close').click();await f.page.evaluate(()=>fundingWallet.chain='0x1');await f.connect();await f.prepare();await f.reviewed();await f.page.evaluate(async()=>{const store=await import('/chat-store.js');await store.updateState(s=>{s.identity.access='lenz/recovered-chat/v1';});});
 await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='false');assert.equal(await f.sends(),0);assert.deepEqual(await f.rows(),[]);
}));
test('lost funding reply blocks repeats and matching finalized deposit never claims private credit',()=>fundingUI(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>fundingWallet.mode='lost');await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Wallet response lost · check before trying again'));assert.equal(await f.sends(),1);assert(await f.page.locator('#private-funding-prepare').isDisabled());
 await f.page.locator('#private-funding-history input').fill('0x'+'ab'.repeat(32));await f.page.getByRole('button',{name:'Check transfer',exact:true}).click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Transfer confirmed · arrival in Lenz not yet verified'));assert.equal(await f.sends(),1);
 const row=(await f.rows())[0];assert.equal(row.state,'confirmed');assert.equal(row.review.funding.terms.owner,f.owner);
}));
test('closing during a wallet prompt preserves the late hash in the same saved attempt',()=>fundingUI(async f=>{
 await f.prepare();await f.reviewed();await f.page.evaluate(()=>fundingWallet.mode='delay');await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>!!fundingWallet.release);await f.page.locator('#private-funding-close').click();await f.open();assert(await f.page.locator('#private-funding-prepare').isDisabled());
 await f.page.evaluate(()=>fundingWallet.release());await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));assert.equal(await f.sends(),1);assert.equal((await f.rows()).length,1);
}));

test('a funding quote becoming stale after durable storage prevents a wallet prompt',()=>fundingUI(async f=>{
 f.api.quoteAge=299900;await f.prepare();await f.reviewed();await f.page.evaluate(()=>{
  const request=navigator.locks.request.bind(navigator.locks);let changed=false;
  navigator.locks.request=(name,...args)=>{const callback=args.pop();return request(name,...args,async lock=>{const result=await callback(lock);if(name==='lenz-evm-transfers-v1'&&!changed){changed=true;fundingTime+=200;}return result;});};
 });
 await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').getAttribute('aria-busy')==='false');assert.equal(await f.sends(),0);assert.equal((await f.rows())[0].state,'not_sent');
}));
test('funding storage cannot overwrite readable history with an oversized encrypted journal',()=>fundingUI(async f=>{
 await f.prepare();await f.reviewed();await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));
 const result=await f.page.evaluate(async()=>{
  const store=await import('/evm-transfer-store.js');let message='';
  try{await store.updateTransfers(rows=>{const original=rows[0];for(let i=0;i<34;i++){const copy=structuredClone(original);copy.id=crypto.randomUUID();copy.review.funding.quote.metadata='x'.repeat(62000);rows.push(copy);}});}catch(error){message=error.message;}
  let count=null,readError='';try{count=(await store.readTransfers()).length;}catch(error){readError=error.message;}return {message,count,readError};
 });assert.match(result.message,/storage is full/);assert.equal(result.count,1);assert.equal(await f.sends(),1);
}));

test('choosing source funds returns to the same amount and follows Base without a network switch',()=>fundingUI(async f=>{
 await f.open();await f.page.locator('#private-funding-amount').fill('0.01');await f.page.locator('#private-funding-consent').check();await f.page.locator('#private-funding-source').click();await f.page.evaluate(()=>fundingWallet.chain='0x2105');await f.page.getByRole('button',{name:'Browser wallet',exact:true}).click();
 await f.page.waitForFunction(()=>document.querySelector('#private-funding-dialog').open&&document.querySelector('#private-funding-source-label').textContent.includes('Base'));assert.equal(await f.page.locator('#private-funding-amount').inputValue(),'0.01');assert(await f.page.locator('#private-funding-consent').isChecked());
 await f.page.locator('#private-funding-prepare').click();await f.reviewed();assert.match(await f.page.locator('#private-funding-review').innerText(),/Your Lenz account · ETH/);assert.match(await f.page.locator('#private-funding-review').innerText(),/Base/);
 await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));const row=(await f.rows())[0];assert.equal(row.review.terms.chainId,'0x2105');assert.equal(row.review.funding.quote.quoteRequest.originAsset,'nep141:base.omft.near');assert.equal(row.review.funding.quote.quoteRequest.destinationAsset,'nep141:base.omft.near');
 assert.equal(await f.page.evaluate(()=>fundingWallet.calls.filter(c=>c.method==='wallet_switchEthereumChain'||c.method==='wallet_addEthereumChain').length),0);
}));
test('Arbitrum funding keeps its source chain through review and deposit history',()=>fundingUI(async f=>{
 await f.page.evaluate(()=>{fundingWallet.chain='0xa4b1';fundingWallet.emit('chainChanged','0xa4b1');});await f.connect();await f.prepare();await f.reviewed();assert.match(await f.page.locator('#private-funding-source-label').innerText(),/Arbitrum/);
 await f.page.locator('#private-funding-approve').click();await f.page.waitForFunction(()=>document.querySelector('#private-funding-history').textContent.includes('Sent · waiting for confirmation'));const row=(await f.rows())[0];assert.equal(row.review.terms.chainId,'0xa4b1');assert.equal(row.review.funding.quote.quoteRequest.originAsset,'nep141:arb.omft.near');assert.match(await f.page.locator('#private-funding-history').innerText(),/Arbitrum/);
}));

test('funding route and review reflow across themes, large text and keyboard dismissal',()=>fundingUI(async f=>{
 const output=path.join(require('node:os').tmpdir(),'lenz-native-funding-20261111','screenshots');await fs.mkdir(output,{recursive:true});await f.open();
 for(const theme of ['light','dim','dark'])for(const width of [320,390,844,1280]){
  await f.page.setViewportSize({width,height:width===844?390:844});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  assert(await f.page.locator('#private-funding-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await f.page.screenshot({path:path.join(output,`funding-${theme}-${width}.png`)});
 }
 await f.page.locator('#private-funding-amount').fill('0.01');await f.page.locator('#private-funding-consent').check();await f.page.locator('#private-funding-prepare').click();await f.reviewed();
 await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:path.join(output,'funding-review-dark-390.png')});
 await f.page.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await f.page.locator('#private-funding-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));
 await f.page.keyboard.press('Escape');assert(await f.page.locator('#private-funding-dialog').isHidden());assert(await f.page.locator('#private-funding-open').evaluate(n=>n===document.activeElement));
}));
