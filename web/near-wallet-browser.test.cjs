const {selectRecipient,openIncoming}=require('./wallet-test-ui.cjs');
async function walletSettings(p){if(await p.locator('.wallet-settings').count()&&!await p.locator('.wallet-settings').evaluate(n=>n.open))await p.locator('.wallet-settings summary').click();}
// Disposable Edge contexts only. Live mode uses real NEAR testnet receipts.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const live=process.env.LENZ_LIVE_TESTNET==='1';
const checks=[],errors=[],transactions=[];let apiCalls=0;
const publicRoot=path.join(__dirname,'public');
const server=http.createServer(async(req,res)=>{
  try {
    for(const [name,value] of Object.entries(securityHeaders(new URL(req.url,'http://localhost').pathname)))res.setHeader(name,value);
    if(req.url==='/near-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({network:'testnet',contract:'fixture.lenz.testnet',ready:true}));return;}
    if(req.url==='/api/testnet/fund') {apiCalls++;let chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({root:{id:data.id,owner:data.owner,amount:data.amount},finality:'FINAL',txHash:'fixture-funding-receipt'}));return;}
    const file=path.join(publicRoot,req.url.split('?')[0]);const content=await fs.readFile(file);
    res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(content);
  }catch{res.writeHead(404);res.end('missing');}
});
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');}
async function ready(p){await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');}
async function feedback(p,text){await p.waitForFunction(t=>document.querySelector('#near-feedback').textContent.includes(t),text,{timeout:120000});await idle(p);}
async function create(p,base,name){await p.goto(base+'/money.html');await ready(p);await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill(name);await p.locator('#wallet-identity-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#my-name').textContent.length>0);await idle(p);return JSON.parse(await p.locator('#my-card').inputValue());}
async function add(p,profile){await p.locator('#show-add-contact').click();await p.locator('#contact-file').setInputFiles({name:'card.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(profile))});await p.locator('#contact-review').waitFor({state:'visible'});await idle(p);await p.locator('#verified').check();await p.locator('#confirm-contact').click();await p.locator('#add-contact').waitFor({state:'hidden'});await idle(p);}
async function send(p,person,value){await p.locator('#near-send').click();await selectRecipient(p,person.id);await p.locator('#near-send-amount').fill(value);await p.locator('#near-send-form button[type=submit]').click();await feedback(p,'Payment saved');const download=p.waitForEvent('download');await p.locator('#near-download').click();const packet=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));await p.locator('[data-close="near-handover"]').click();return packet;}
async function receive(p,packet){await p.locator('#near-receive').click();await openIncoming(p);await p.locator('#near-payment-file').setInputFiles({name:'payment.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await p.waitForFunction(()=>!document.querySelector('#near-import').disabled);await idle(p);await p.locator('#near-import').click();await idle(p);}
(async()=>{
  if(!live)await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=live?'http://127.0.0.1:4173':'http://127.0.0.1:'+server.address().port;
  if(live){const config=await(await fetch(base+'/api/testnet/status')).json();assert(config.ready&&config.network==='testnet'&&config.contract.endsWith('.testnet'));}
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const contexts=await Promise.all([1,2,3].map(()=>browser.newContext({viewport:{width:1280,height:900}})));
    const [a,b,c]=await Promise.all(contexts.map(x=>x.newPage()));for(const p of[a,b,c]){p.on('pageerror',e=>errors.push(e.message));if(live)p.on('request',r=>{if(r.url().includes('/api/testnet/'))apiCalls++;});}
    const pa=await create(a,base,'Amina'),pb=await create(b,base,'Bola'),pc=await create(c,base,'Chidi');
    await check('new wallet starts at zero with no synthetic asset grant',async()=>{assert.equal(await a.locator('#near-total').innerText(),'0');assert(!await a.locator('#wallet-balances').isVisible());assert.equal(apiCalls,0);});
    await add(a,pb);await add(b,pa);await add(b,pc);await add(c,pb);
    await check(live?'funding waits for a matching final receipt from NEAR testnet':'funding waits for a matching final receipt from the RPC fixture',async()=>{await a.locator('#near-fund').click();await a.locator('#near-fund-form button[type=submit]').click();await feedback(a,'Test money added');assert.equal(await a.locator('#near-total').innerText(),'100');assert.equal(await a.locator('#near-confirmed').textContent(),'100');assert.equal(await a.locator('#near-pending').textContent(),'0');assert.equal(apiCalls,1);assert(await a.getByText('View confirmation ↗').isVisible());if(live)transactions.push({action:'fund',url:await a.getByText('View confirmation ↗').getAttribute('href')});});
    await check('new wallet survives offline reload and does not need a conversation',async()=>{for(const p of[a,b,c]){await walletSettings(p);await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);await p.context().setOffline(true);await p.reload();await ready(p);assert.equal(new URL(p.url()).pathname,'/money.html');}});
    let first,second;
    await check('encrypted A → B → C handover runs with all three browsers offline',async()=>{first=await send(a,pb,'20');await receive(b,first);await feedback(b,'Payment saved');second=await send(b,pc,'8');await receive(c,second);await feedback(c,'Payment saved');assert.equal(await a.locator('#near-total').innerText(),'80');assert.equal(await b.locator('#near-total').innerText(),'12');assert.equal(await c.locator('#near-total').innerText(),'8');assert.equal(await c.locator('#near-pending').textContent(),'8');assert.equal(await c.locator('#near-confirmed').textContent(),'0');assert(await c.getByText('Awaiting confirmation',{exact:true}).isVisible());assert.equal(apiCalls,1);});
    await check('duplicate and altered payment files cannot add tUSD',async()=>{await receive(c,second);await feedback(c,'already received');assert.equal(await c.locator('#near-total').innerText(),'8');const bad={...second,signature:'0'.repeat(128)};await receive(c,bad);await feedback(c,'could not verify');assert.equal(await c.locator('#near-total').innerText(),'8');await c.locator('[data-close="near-receive-dialog"]').click();});
    if(live)await check('lost settlement response can be retried against real NEAR without duplicating value',async()=>{
      await c.context().setOffline(false);
      await c.route('**/api/testnet/settle',async route=>{const response=await route.fetch({timeout:120000});assert.equal(response.status(),200);const receipt=await response.json();assert.equal(receipt.finality,'FINAL');transactions.push({action:'settle-response-lost',txHash:receipt.txHash,gasBurnt:receipt.gasBurnt});await route.abort('failed');},{times:1});
      await c.getByRole('button',{name:'Confirm payment',exact:true}).click();await feedback(c,'internet connection');assert(await c.getByText('Awaiting confirmation',{exact:true}).isVisible());
      await c.getByRole('button',{name:'Confirm payment',exact:true}).click();await feedback(c,'Payment confirmed.');assert.equal(await c.locator('#near-total').innerText(),'8');assert.equal(await c.locator('#near-pending').textContent(),'0');assert.equal(await c.locator('#near-confirmed').textContent(),'8');assert(await c.getByText('Confirmed',{exact:true}).isVisible());transactions.push({action:'settle-retry',url:await c.getByText('View confirmation ↗').getAttribute('href')});
      await c.locator('#near-refresh').click();await feedback(c,'Payments updated');assert.equal(await c.locator('#near-total').innerText(),'8');
    });
    await check('failed storage commit releases no payment and preserves the balance',async()=>{await a.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw new Error('Near wallet commit failed');};});await a.locator('#near-send').click();await selectRecipient(a,pb.id);await a.locator('#near-send-amount').fill('5');await a.locator('#near-send-form button[type=submit]').click();await feedback(a,'could not save');assert.equal(await a.locator('#near-total').innerText(),'80');assert(!await a.locator('#near-handover').isVisible());await a.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});await a.locator('[data-close="near-send-dialog"]').click();});
    await check('testnet notes stay encrypted at rest and identity survives reload without a demo mode',async()=>{const saved=await a.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return{id:s.identity.profile.id,encrypted:!!s.nearBox.ciphertext,plain:!!s.nearVault,messages:s.messages.length};});assert.equal(saved.id,pa.id);assert(saved.encrypted&&!saved.plain);assert.equal(saved.messages,1);assert.equal(await a.locator('#wallet-mode').count(),0);await a.reload();await ready(a);assert.equal(await a.locator('#near-total').innerText(),'80');});
    await check('tUSD view fits desktop and mobile; the explanation expands by keyboard',async()=>{for(const[width,height]of[[1280,900],[375,812]]){await c.setViewportSize({width,height});assert(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await c.locator('#near-send').isVisible());}await c.locator('#near-explain').focus();await c.keyboard.press('Enter');assert(await c.locator('#near-explanation').isVisible());await c.screenshot({path:path.join(__dirname,'evidence/tusd-wallet-narrow.png'),fullPage:true});});
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(__dirname,live?'near-wallet-live-results.json':'near-wallet-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,transactions,scope:live?'Disposable Edge contexts; real NEAR testnet funding and settlement, actual offline A → B → C file handover, dropped-response retry. Windows Edge only; no physical phone testing.':'Isolated Edge contexts; mocked funding RPC, real browser cryptography and offline file handover. No chain settlement is claimed by this suite.'},null,2)+'\n');
  }finally{await browser.close();if(!live)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
