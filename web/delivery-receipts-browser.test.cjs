const {selectRecipient,openIncoming}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const contract='receipt-fixture.lenz.testnet',checks=[],errors=[],requests=[];
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;for(const[k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file.startsWith('/api/')){requests.push(file);throw Error('No financial request allowed');}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  res.end(file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify({network:'testnet',reserve:contract,ready:false}):await fs.readFile(path.join(__dirname,'public',file)));
}catch{res.writeHead(404);res.end('Unavailable');}});
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const state=p=>p.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
const input=packet=>({name:'encrypted-file.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});
async function receive(p,packet){await p.locator('#receive-message').click();await p.locator('#incoming-file').setInputFiles(input(packet));await idle(p);await p.locator('#open-message').click();await idle(p);}
async function receipt(p,financial=false){await p.locator(financial?'.bubble.financial':'.bubble:not(.financial)').getByRole('button',{name:'Share receipt',exact:true}).click();await idle(p);const out=JSON.parse(await p.locator('#outgoing').inputValue());assert.equal(await p.locator('#handover-label').innerText(),'Receipt ready to share');await p.locator('[data-close="handover"]').click();return out;}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
    const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));for(const p of[a,b])p.on('pageerror',e=>errors.push(e.message));
    const profiles=[];
    for(const[p,name]of[[a,'Amina'],[b,'Bola']]){await p.goto(base+'/money.html');await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill(name);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);profiles.push(JSON.parse(await p.locator('#my-card').inputValue()));}
    for(const[p,peer]of[[a,profiles[1]],[b,profiles[0]]])await p.evaluate(async peer=>{await(await import('/chat-store.js')).updateState(s=>s.contacts.push(peer));},peer);
    // Fixture backing only; receipt behavior must not call any funding or settlement API.
    await a.evaluate(async c=>{const n=await import('/near-protocol.js');await(await import('/chat-store.js')).updateState(async s=>{const request=await n.fundingRequest(s.identity,c,'10'),v=n.emptyNearVault(c);v.roots.push({id:request.id,owner:request.owner,amount:request.amount});await n.saveNearVault(s,v);});},contract);
    await check('two existing identities cache and reload offline without network or wallet actions',async()=>{
      for(const p of[a,b]){await p.goto(base+'/chat.html');await p.locator('#prepare-offline').click();await idle(p);assert((await p.locator('#status').innerText()).includes('files saved'));await p.context().setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#status').textContent==='Private chat is ready.');assert(await p.evaluate(async()=>{try{await fetch('/not-cached');return false;}catch{return true;}}));}
      assert.deepEqual(requests,[]);
    });
    let message,chatReceipt,payment,paymentReceipt;
    await check('failed receipt storage exposes no shareable receipt and preserves saved history',async()=>{
      await a.locator('#message').fill('Meet by the bookshop');await a.locator('#prepare-message').click();await idle(a);message=JSON.parse(await a.locator('#outgoing').inputValue());await a.locator('[data-close="handover"]').click();await receive(b,message);
      const before=await state(b);await b.evaluate(()=>{window.oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Receipt storage failed');};});
      await b.getByRole('button',{name:'Share receipt',exact:true}).click();await idle(b);assert(!(await b.locator('#handover').isVisible()));assert.equal(await state(b),before);assert((await b.locator('#status').innerText()).includes('Receipt storage failed'));
      await b.evaluate(()=>{IDBObjectStore.prototype.put=window.oldPut;});
    });
    await check('offline message receipt returns to the sender and survives reload without another message',async()=>{
      chatReceipt=await receipt(b);assert(!JSON.stringify(chatReceipt).includes(message.id));await b.reload();await idle(b);assert.deepEqual(await receipt(b),chatReceipt);
      await receive(a,chatReceipt);assert((await a.locator('#messages').innerText()).includes('Receipt received'));await a.reload();await idle(a);assert((await a.locator('#messages').innerText()).includes('Receipt received'));
      assert.equal(await a.locator('.bubble').count(),1);assert.equal(await b.locator('.bubble').count(),1);
    });
    await check('duplicate and forged receipts cannot change history or create a receipt loop',async()=>{
      const before=await state(a);await receive(a,chatReceipt);assert.equal(await state(a),before);assert((await a.locator('#status').innerText()).includes('already saved'));
      await receive(a,{...chatReceipt,signature:'0'.repeat(128)});assert.equal(await state(a),before);assert(await a.locator('#handover').isVisible());await a.locator('[data-close="handover"]').click();assert.equal(await a.getByRole('button',{name:'Share receipt',exact:true}).count(),0);
    });
    await check('an offline tUSD receipt updates the standalone wallet without confirmation or extra credit',async()=>{
      await a.locator('#pay-tusd').click();await idle(a);await a.locator('#chat-pay-amount').fill('4');await a.locator('#chat-pay-submit').click();await idle(a);payment=JSON.parse(await a.locator('#outgoing').inputValue());await a.locator('[data-close="handover"]').click();await receive(b,payment);
      const vault=p=>p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState();return {box:s.nearBox,vault:await(await import('/near-protocol.js')).readNearVault(s,c)};},contract);
      const beforeA=await vault(a),beforeB=await vault(b);paymentReceipt=await receipt(b,true);
      await a.goto(base+'/money.html');await idle(a);await a.locator('#near-receive').click();await openIncoming(a);await a.locator('#near-payment-file').setInputFiles(input(paymentReceipt));await idle(a);await a.locator('#near-import').click();await idle(a);
      assert((await a.locator('#near-payments').innerText()).includes('File received'));assert.equal(await a.locator('#near-total').innerText(),'6');assert.deepEqual(await vault(a),beforeA);assert.deepEqual(await vault(b),beforeB);assert.deepEqual(beforeB.vault.receipts,{});
    });
    await check('wallet can resend the same receipt without starting a conversation or modifying money',async()=>{
      await b.goto(base+'/money.html');await idle(b);await b.locator('#near-received-files summary').click();const before=await state(b);
      const download=b.waitForEvent('download');await b.getByRole('button',{name:'Save receipt to share',exact:true}).click();await idle(b);const file=await(await download).path();assert.deepEqual(JSON.parse(await fs.readFile(file)),paymentReceipt);assert.equal(await state(b),before);assert.equal(await b.locator('#near-total').innerText(),'4');
    });
    await check('a delivery receipt never replaces a conflicting-payment warning',async()=>{
      await a.evaluate(async c=>{const n=await import('/near-protocol.js');await(await import('/chat-store.js')).updateState(async s=>{const v=await n.readNearVault(s,c);v.chainConsumed={[v.roots[0].id]:'a'.repeat(64)};await n.saveNearVault(s,v);});},contract);
      await a.reload();await idle(a);const card=a.locator('.near-payment').filter({hasText:'tUSD → Bola'});assert((await card.innerText()).includes('Payment could not be confirmed'));assert((await card.innerText()).includes('Receipt received'));assert.equal(await card.getByRole('button',{name:'Save payment file'}).count(),0);
      await a.goto(base+'/chat.html');await idle(a);const bubble=a.locator('.bubble.financial');assert((await bubble.innerText()).includes('Payment could not be confirmed'));assert.equal(await bubble.getByRole('button',{name:'Save payment file'}).count(),0);
    });
    await check('receipt states fit both themes and small screens while identities remain unchanged',async()=>{
      await a.goto(base+'/chat.html');await idle(a);
      for(const theme of['light','dark']){await a.evaluate(t=>{localStorage.setItem('lenz-home-theme',t);dispatchEvent(new StorageEvent('storage',{key:'lenz-home-theme',newValue:t}));},theme);
        for(const[width,height]of[[375,812],[812,375],[1280,900]]){await a.setViewportSize({width,height});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
        await a.setViewportSize({width:375,height:812});await a.locator('.bubble.financial').screenshot({path:path.join(__dirname,'evidence/delivery-receipt-'+theme+'.png')});
      }
      await a.addStyleTag({content:'html{font-size:125%}'});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      for(const[p,profile]of[[a,profiles[0]],[b,profiles[1]]])assert.equal(JSON.parse(await state(p)).identity.profile.id,profile.id);
      assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    });
    await fs.writeFile(path.join(__dirname,'delivery-receipts-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,apiRequests:requests,scope:'Two disposable Windows Edge profiles with actual WebCrypto, IndexedDB, file import/download and offline cache. tUSD backing/conflict are fixtures; no chain transaction, funding, deployment or existing profile access.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
