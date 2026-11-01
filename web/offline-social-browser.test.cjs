const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const config={network:'testnet',contract:'social-fixture.lenz.testnet',ready:true};
const rhea={network:'testnet',adapter:'social-adapter.lenz.testnet',reserve:config.contract,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',ready:true,recoverRedemption:true};
const checks=[],errors=[],requests=[];let base;
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [k,v] of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file.startsWith('/api/')){requests.push(file);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture refuses unrequested chain actions'}));return;}
  const type=({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream';res.setHeader('Content-Type',type);
  res.end(file==='/near-config.json'?JSON.stringify(config):file==='/rhea-config.json'?JSON.stringify(rhea):await fs.readFile(path.join(__dirname,'public',file)));
}catch{res.writeHead(404);res.end('missing');}});
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
async function status(p,text){await p.waitForFunction(t=>document.querySelector('#status').textContent.includes(t),text);await idle(p);}
async function wallet(p){await p.goto(base+'/money.html');await status(p,'Your wallet is ready');}
async function chat(p){await p.goto(base+'/chat.html');await status(p,'Private chat is ready');}
async function create(p,name){await wallet(p);await p.locator('#wallet-name').fill(name);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);return JSON.parse(await p.locator('#my-card').inputValue());}
async function add(p,profile){await p.locator('#show-add-contact').click();await p.locator('#contact-file').setInputFiles({name:'contact.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(profile))});await p.locator('#contact-review').waitFor({state:'visible'});await p.locator('#verified').check();await p.locator('#confirm-contact').click();await idle(p);}
async function receive(p,packet){await p.locator('#receive-message').click();await p.locator('#incoming-file').setInputFiles({name:'message.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await status(p,'File loaded');await p.locator('#open-message').click();await idle(p);}
async function pay(p,name,amount){await p.locator('#contact-list button').filter({hasText:name}).click();await idle(p);await p.locator('#pay-tusd').click();await idle(p);await p.locator('#chat-pay-amount').fill(amount);await p.locator('#chat-pay-submit').click();await status(p,'Payment saved');const packet=JSON.parse(await p.locator('#outgoing').inputValue());await p.locator('[data-close="handover"]').click();return packet;}
async function state(p){return p.evaluate(async contract=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,contract);return {id:s.identity.profile.id,signing:s.identity.profile.signingPublic,contacts:s.contacts.map(c=>c.id),messages:s.messages,v,encrypted:!!s.nearBox?.ciphertext,extractable:s.identity.signingPrivate.extractable};},config.contract);}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
    const [a,b,c]=await Promise.all(contexts.map(x=>x.newPage()));for(const p of [a,b,c])p.on('pageerror',e=>errors.push(e.message));
    const pa=await create(a,'Amina'),pb=await create(b,'Bola'),pc=await create(c,'Chidi');
    await add(a,pb);await add(b,pa);await add(b,pc);await add(c,pb);
    await check('tUSD starts at zero; chat and wallet use the same profile and confirmed contacts',async()=>{
      for(const [p,profile] of [[a,pa],[b,pb],[c,pc]]){assert.equal(await p.locator('#near-total').innerText(),'0');await chat(p);assert.equal(await p.locator('#chat-balance').innerText(),'0 tUSD');assert.equal((await state(p)).id,profile.id);assert.equal(await p.locator('#enable-demo').isVisible(),false);assert(await p.locator('#pay-tusd').isEnabled());}
      assert.deepEqual(requests,[]);
    });
    // Synthetic backing is deliberately confined to this test's disposable browser.
    await a.evaluate(async contract=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js');await updateState(async s=>{const v=n.emptyNearVault(contract),r=await n.fundingRequest(s.identity,contract,'10');v.roots.push({id:r.id,amount:r.amount,owner:r.owner});await n.saveNearVault(s,v);});},config.contract);
    await check('all three profiles cache and reload chat fully offline before exchanging messages or money',async()=>{
      for(const p of [a,b,c]){await p.locator('#prepare-offline').click();await status(p,'Conversation files saved');await p.context().setOffline(true);await p.reload();await status(p,'Private chat is ready');assert(await p.evaluate(async()=>{try{await fetch('/uncached-offline-probe');return false;}catch{return true;}}));assert((await p.locator('#chat-connection').innerText()).includes('You’re offline'));}
      assert.equal(await a.locator('#chat-balance').innerText(),'10 tUSD');
    });
    await check('private chat remains usable offline without a financial action',async()=>{
      await a.locator('#message').fill('Meet by the gate after lunch.');await a.locator('#prepare-message').click();await status(a,'Message saved and encrypted');const packet=JSON.parse(await a.locator('#outgoing').inputValue());await a.locator('[data-close="handover"]').click();await receive(b,packet);await status(b,'Message opened');assert(await b.locator('#messages').getByText('Meet by the gate after lunch.',{exact:false}).isVisible());assert.equal(await b.locator('#chat-balance').innerText(),'0 tUSD');assert(!JSON.stringify((await state(b)).messages).includes('Meet by the gate'));
    });
    await check('failed chat payment commit exposes no packet, history entry or balance change',async()=>{
      const before=await state(a);await a.locator('#pay-tusd').click();await idle(a);await a.locator('#chat-pay-amount').fill('6');
      await a.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Payment commit failed');};});
      await a.locator('#chat-pay-submit').click();await idle(a);assert((await a.locator('#chat-pay-feedback').innerText()).includes('could not save'));assert.equal(await a.locator('#handover').isVisible(),false);assert.deepEqual(await state(a),before);
      await a.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});await a.locator('#chat-pay-close').click();
    });
    let first,second;
    await check('chat payment A → B → C works offline with shared wallet balances and no settlement call',async()=>{
      first=await pay(a,'Bola','6');await receive(b,first);await status(b,'Payment received');second=await pay(b,'Chidi','2');await receive(c,second);await status(c,'Payment received');
      assert.deepEqual(await Promise.all([a,b,c].map(p=>p.locator('#chat-balance').innerText())),['4 tUSD','4 tUSD','2 tUSD']);
      assert(await c.getByText('Received on this device · awaiting online confirmation',{exact:true}).isVisible());assert.deepEqual(requests,[]);
      for(const [p,amount] of [[a,'4'],[b,'4'],[c,'2']]){await wallet(p);assert.equal(await p.locator('#near-total').innerText(),amount);await chat(p);}
    });
    await check('duplicate and forged payment messages cannot add money or erase history',async()=>{
      const before=await state(c);await receive(c,second);await status(c,'already opened');assert.deepEqual(await state(c),before);
      await receive(c,{...second,signature:'0'.repeat(128)});assert.equal((await state(c)).messages.length,before.messages.length);assert.equal(await c.locator('#chat-balance').innerText(),'2 tUSD');await c.locator('[data-close="handover"]').click();
    });
    await check('a swap saved offline stays reserved across chat, reload and reconnection without automatic execution',async()=>{
      await wallet(b);await b.locator('#rhea-open').click();assert(await b.locator('#rhea-quote').isDisabled());await b.locator('#rhea-amount').fill('1');await b.locator('#rhea-minimum').fill('0.0001');await b.locator('#rhea-receiver').fill('receiver.testnet');await b.locator('#rhea-form button[type=submit]').click();await idle(b);
      assert.equal(await b.locator('#near-total').innerText(),'3');assert(await b.getByRole('button',{name:'Start swap',exact:true}).isDisabled());assert((await b.locator('#rhea-queue').innerText()).includes('Reconnect to execute'));
      await chat(b);assert.equal(await b.locator('#chat-balance').innerText(),'3 tUSD');await wallet(b);await b.reload();await status(b,'Your wallet is ready');assert.equal(await b.locator('#near-total').innerText(),'3');
      const before=await state(b);await b.context().setOffline(false);await b.getByRole('button',{name:'Start swap',exact:true}).waitFor();await b.waitForFunction(()=>!Array.from(document.querySelectorAll('#rhea-orders button')).find(b=>b.textContent==='Start swap').disabled);
      assert((await b.locator('#rhea-queue').innerText()).includes('Nothing is sent automatically'));assert.deepEqual(await state(b),before);assert.deepEqual(requests,[]);await b.context().setOffline(true);
    });
    await check('wallet-originated payment appears in chat and can be received through the same conversation',async()=>{
      await b.locator('#near-send').click();await b.locator('#near-recipient').selectOption(pc.id);await b.locator('#near-send-amount').fill('1');await b.locator('#near-send-form button[type=submit]').click();await idle(b);
      const download=b.waitForEvent('download');await b.locator('#near-download').click();const packet=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));await b.locator('[data-close="near-handover"]').click();
      await chat(b);await b.locator('#contact-list button').filter({hasText:'Chidi'}).click();await idle(b);assert.equal(await b.locator('.near-chat-card').count(),2);await receive(c,packet);await status(c,'Payment received');assert.equal(await c.locator('#chat-balance').innerText(),'3 tUSD');assert.equal(await b.locator('#chat-balance').innerText(),'2 tUSD');
    });
    await check('identity, encrypted history and reservations survive offline reload; cards fit narrow and landscape screens',async()=>{
      for(const [p,profile] of [[a,pa],[b,pb],[c,pc]]){await p.reload();await status(p,'Private chat is ready');const s=await state(p);assert.equal(s.id,profile.id);assert.equal(s.signing,profile.signingPublic);assert.equal(s.extractable,false);assert(s.encrypted);assert(await p.evaluate(async()=>{try{await fetch('/uncached-final-probe');return false;}catch{return true;}}));}
      await b.locator('#contact-list button').filter({hasText:'Chidi'}).click();await idle(b);
      for(const [w,h] of [[1280,900],[375,812],[812,375]]){await b.setViewportSize({width:w,height:h});assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      await b.setViewportSize({width:375,height:812});await b.screenshot({path:path.join(__dirname,'evidence/offline-social-chat.png'),fullPage:true});
      await b.locator('#pay-tusd').click();await idle(b);await b.addStyleTag({content:'html{font-size:125%}'});assert(await b.evaluate(()=>document.querySelector('#chat-pay-dialog').scrollWidth<=document.querySelector('#chat-pay-dialog').clientWidth));
      assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    });
    await fs.writeFile(path.join(__dirname,'offline-social-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,apiRequests:requests,scope:'Three disposable Windows Edge profiles; fixture initial backing and config, actual signatures/encryption/storage and offline network emulation. No live funding, swap or settlement; no physical phone/BLE/Safari test.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(async e=>{console.error(e);await fs.writeFile(path.join(__dirname,'offline-social-browser-failure.json'),JSON.stringify({at:new Date().toISOString(),passed:checks.length,checks,error:e.stack,errors,apiRequests:requests},null,2)+'\n');server.close();process.exitCode=1;});
