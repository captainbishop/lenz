const {selectRecipient,openIncoming,walletClick}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const contract='nearby-fixture.lenz.testnet', checks=[], errors=[], requests=[];
const reportDirectory=process.env.LENZ_NEARBY_REPORT_DIR??__dirname;
const read=p=>p.evaluate(async()=>await(await import('/chat-store.js')).readState());
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
async function openNearby(page){
  if(await page.locator('#nearby-dialog').evaluate(d=>d.open))return;
  if(!await page.locator('#nearby-open').isVisible()){
    if(await page.locator('.wallet-settings').count())await page.locator('.wallet-settings summary').click();
    else await page.locator('#chat-options').click();
  }
  await page.locator('#nearby-open').click();
}
const wait=async(p,fn)=>{for(let i=0;i<150;i++){if(fn(await read(p)))return;await p.waitForTimeout(100);}throw Error('Nearby state timeout: '+await p.locator('#nearby-status').textContent());};
(async()=>{
  let browser,offline=false;
  const server=http.createServer(async(req,res)=>{try{
    const file=new URL(req.url,'http://localhost').pathname;
    if(file.startsWith('/api/')||offline){requests.push(file);res.writeHead(503);res.end('No network');return;}
    for(const [k,v] of Object.entries(securityHeaders(file)))res.setHeader(k,v);
    res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
    const filename=path.resolve(__dirname,'public','.'+(file==='/'?'/index.html':file));assert(filename.startsWith(path.resolve(__dirname,'public')+path.sep));
    res.end(file==='/carrier-config.json'?JSON.stringify({version:1,carriers:[]}):file==='/nostr-config.json'?JSON.stringify({version:1,relays:[]}):file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify({ready:false,network:'testnet',reserve:contract}):await fs.readFile(filename));
  }catch(error){res.writeHead(404);res.end('Unavailable');}});
  try{
    await fs.mkdir(path.join(reportDirectory,'evidence'),{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
    for(const context of contexts)await context.addInitScript(()=>{const RTC=RTCPeerConnection;globalThis.testPeers=[];globalThis.RTCPeerConnection=class extends RTC{constructor(config){super(config);testPeers.push(this);}};});
    const pages=await Promise.all(contexts.map(c=>c.newPage())),[a,b,c]=pages,profiles=[];
    for(const [i,p]of pages.entries()){
      p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/money.html');await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill(['Amina','Bola','Chidi'][i]);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);profiles.push((await read(p)).identity.profile);
    }
    for(const p of pages)await p.evaluate(async profiles=>{await(await import('/chat-store.js')).updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});},profiles);
    await a.evaluate(async({contract,to})=>{
      const n=await import('/near-protocol.js'),crypto=await import('/peer-crypto.js');
      await(await import('/chat-store.js')).updateState(async s=>{const root=await n.fundingRequest(s.identity,contract,'10'),v=n.emptyNearVault(contract);v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);s.messages.push({packet:await crypto.sealMessage(s.identity,s.contacts.find(p=>p.id===to),{kind:'chat',text:'Earlier history stays local until selected'})});});
    },{contract,to:profiles[1].id});
    await a.goto(base+'/chat.html');for(const p of [b,c])await p.reload();
    for(const p of pages){await idle(p);await p.waitForFunction(()=>document.querySelector('#chat-cache-status,#money-cache-status').dataset.offlineState==='ready',null,{timeout:120000});}
    requests.length=0;offline=true;
    // All HTTP requests now fail; WebRTC retains the local interface.
    for(const context of contexts){
      await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
      await context.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
    }
    for(const p of pages){await p.reload();await idle(p);}
    const pair=async(from,to,fromProfile,toProfile)=>{
      for(const p of [from,to]){if(!await p.locator('#nearby-dialog').evaluate(d=>d.open))await openNearby(p);if(await p.locator('#nearby-disconnect').isVisible())await p.locator('#nearby-disconnect').click();}
      await from.locator('#nearby-person').selectOption(toProfile.id);await from.locator('#nearby-create').click();
      await from.waitForFunction(()=>document.querySelector('#nearby-output').value.startsWith('lenz-nearby1_'));
      const offer=await from.locator('#nearby-output').inputValue();
      assert(await from.locator('#nearby-qr').evaluate(canvas=>!canvas.hidden&&canvas.width>0));
      const scanned=await from.locator('#nearby-qr').evaluate(async canvas=>(await import('/contact-card.js')).scanPixels(canvas,canvas.width,canvas.height));assert.equal(scanned,offer,'Rendered QR must decode to the exact signed code');
      await to.locator('#nearby-person').selectOption(fromProfile.id);await to.locator('#nearby-paste summary').click();await to.locator('#nearby-input').fill(offer);await to.locator('#nearby-use').click();
      await to.waitForFunction(()=>document.querySelector('#nearby-output').value.startsWith('lenz-nearby1_'));
      await from.locator('#nearby-paste summary').click();await from.locator('#nearby-input').fill(await to.locator('#nearby-output').inputValue());await from.locator('#nearby-use').click();
      for(const p of [from,to])await p.waitForFunction(()=>!document.querySelector('#nearby-connected').hidden);
      return offer;
    };
    let offer;
    await check('signed QR pairing establishes a real local data channel with no web or relay access',async()=>{
      offer=await pair(a,b,profiles[0],profiles[1]);
      const stats=await a.evaluate(async()=>{const pc=testPeers.at(-1),all=[...await pc.getStats()].map(([,s])=>s);const transport=all.find(s=>s.type==='transport'),pair=all.find(s=>s.id===transport.selectedCandidatePairId);return {iceServers:pc.getConfiguration().iceServers,local:all.find(s=>s.id===pair.localCandidateId).candidateType,remote:all.find(s=>s.id===pair.remoteCandidateId).candidateType};});
      assert.deepEqual(stats,{iceServers:[],local:'host',remote:'host'});assert.equal((await read(b)).messages.length,0);assert(requests.every(r=>/\/(?:chat-sw|sw)\.js$/.test(r)),'Unexpected HTTP requests: '+JSON.stringify(requests));
    });
    await check('new fragmented chat messages arrive with signed receipts; old history stays local',async()=>{
      await a.locator('#nearby-close').click();await b.locator('#nearby-close').click();
      await a.locator('#message').fill('Meet me by the bookshop. '.repeat(100));await a.locator('#prepare-message').click();await idle(a);
      const id=(await read(a)).messages.at(-1).packet.id;
      await wait(b,s=>s.messages.some(r=>r.packet.id===id));await wait(a,s=>s.messages.some(r=>r.packet.id===id&&r.receivedReceipt));
      assert.equal((await read(b)).messages.length,1);assert.equal(await a.locator('#handover').count(),0);
    });
    await check('offline payment follows the same channel and keeps settlement separate',async()=>{
      await a.locator('#pay-tusd').click();await a.locator('#chat-pay-amount').fill('4');await a.locator('#chat-pay-form button[type=submit]').click();await idle(a);
      const id=(await read(a)).messages.at(-1).packet.id;await wait(b,s=>s.messages.some(r=>r.packet.id===id));await wait(a,s=>s.messages.some(r=>r.packet.id===id&&r.receivedReceipt));
      assert.equal(await b.locator('#near-total').textContent(),'4');assert(requests.every(r=>/\/(?:chat-sw|sw)\.js$/.test(r)),'Unexpected HTTP requests: '+JSON.stringify(requests));
      const vault=await b.evaluate(async contract=>await(await import('/near-protocol.js')).readNearVault(await(await import('/chat-store.js')).readState(),contract),contract);assert.deepEqual(vault.receipts,{});
    });
    await check('delivery indicators follow the selected recipient and clear after disconnect',async()=>{
      for(const p of [a,b])if(await p.locator('#nearby-dialog').evaluate(d=>d.open))await p.locator('#nearby-close').click();
      await a.locator('#contact-list button').filter({hasText:'Chidi'}).click();await idle(a);
      assert.equal(await a.locator('#prepare-message').textContent(),'Send','An unpaired contact keeps the same Send action');
      await a.locator('#pay-tusd').click();
      assert.equal(await a.locator('#chat-pay-submit').textContent(),'Send payment');
      await a.locator('#chat-pay-close').click();
      await a.locator('#contact-list button').filter({hasText:'Bola'}).click();await idle(a);
      assert.equal(await a.locator('#prepare-message').textContent(),'Send');
      assert.match(await a.locator('#chat-connection').textContent(),/Nearby.*Bola/);
      await a.locator('#pay-tusd').click();assert.match(await a.locator('#chat-pay-delivery').textContent(),/nearby/i);await a.locator('#chat-pay-close').click();
      await walletClick(b,'near-send');
      await selectRecipient(b,profiles[2].id);
      assert.equal(await b.locator('#near-send-form button[type=submit]').textContent(),'Send payment');
      assert.doesNotMatch(await b.locator('#near-send-delivery').textContent(),/nearby/i);
      await selectRecipient(b,profiles[0].id);
      assert.equal(await b.locator('#near-send-form button[type=submit]').textContent(),'Send payment');
      assert.match(await b.locator('#near-send-delivery').textContent(),/nearby/i);
      await b.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();await(await import('/near-wallet.js')).renderNearWallet(s);});
      assert.equal(await b.locator('#near-recipient').inputValue(),profiles[0].id,'A wallet refresh must preserve the chosen recipient');
      assert.match(await b.locator('#near-send-delivery').textContent(),/nearby/i);
      // Exercise the browser's offline indication without disabling its local network interface.
      for(const p of [a,b])await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline'));});
      assert.match(await a.locator('#chat-connection').textContent(),/Nearby.*Bola/);
      assert.match(await b.locator('#near-send-delivery').textContent(),/nearby/i);
      await openNearby(a);await a.locator('#nearby-disconnect').click();
      await b.waitForFunction(()=>document.querySelector('#nearby-status').textContent.startsWith('Disconnected'));
      assert.equal(await a.locator('#prepare-message').textContent(),'Send');
      assert.equal(await b.locator('#near-send-form button[type=submit]').textContent(),'Send payment');
      assert.doesNotMatch(await a.locator('#chat-connection').textContent(),/Nearby/);
      // Configured internet delivery remains available for an unpaired recipient.
      await a.evaluate(async()=>{const d=await import('/delivery-mode.js'),s=await(await import('/chat-store.js')).readState();d.updateDeliveryMode(false,{...s,nostr:{enabled:true}},true);});
      assert.equal(await a.locator('#prepare-message').textContent(),'Send');
      assert.match(await a.locator('#chat-connection').textContent(),/Offline.*send when connected/);
      await a.evaluate(async()=>{(await import('/delivery-mode.js')).updateDeliveryMode(false,{},false);});
      for(const p of [a,b])await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline'));});
      await b.locator('[data-close="near-send-dialog"]').click();
      await pair(a,b,profiles[0],profiles[1]);
    });
    await check('saved history needs an explicit action and duplicate resend cannot credit twice',async()=>{
      await openNearby(a);await a.locator('#nearby-send-saved').click();await wait(b,s=>s.messages.length===3);
      await a.locator('#nearby-close').click();
      await a.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value?.messages?.length>3&&value.messages.at(-1).receivedReceipt){IDBObjectStore.prototype.put=put;this.transaction.abort();throw Error('Injected receipt storage failure');}return put.call(this,value,...args);};});
      await a.locator('#pay-tusd').click();await a.locator('#chat-pay-amount').fill('1');await a.locator('#chat-pay-form button[type=submit]').click();await idle(a);
      const id=(await read(a)).messages.at(-1).packet.id;
      await wait(b,s=>s.messages.some(r=>r.packet.id===id));await a.waitForFunction(()=>document.querySelector('#nearby-status').textContent.startsWith('Disconnected'));
      assert(!(await read(a)).messages.find(r=>r.packet.id===id).receivedReceipt);
      const before=await read(b),packet=JSON.stringify((await read(a)).messages.at(-1).packet);
      await pair(a,b,profiles[0],profiles[1]);await a.locator('#nearby-send-saved').click();
      await wait(a,s=>s.messages.some(r=>r.packet.id===id&&r.receivedReceipt));
      assert.equal(JSON.stringify((await read(a)).messages.at(-1).packet),packet);
      assert.deepEqual((await read(b)).nearBox,before.nearBox);assert.equal((await read(b)).messages.length,4);
    });
    await check('recipient can pass received value onward while the server is unreachable',async()=>{
      for(const p of [a,b]){if(!await p.locator('#nearby-dialog').evaluate(d=>d.open))await openNearby(p);await p.locator('#nearby-disconnect').click();await p.locator('#nearby-close').click();}
      await pair(b,c,profiles[1],profiles[2]);await b.locator('#nearby-close').click();await c.locator('#nearby-close').click();
      await walletClick(b,'near-send');await selectRecipient(b,profiles[2].id);await b.locator('#near-send-amount').fill('1');await b.locator('#near-send-form button[type=submit]').click();await idle(b);
      await wait(c,s=>s.messages.length===1);assert.equal(await c.locator('#near-total').textContent(),'1');assert.equal(await b.locator('#near-total').textContent(),'4');assert(requests.every(r=>/\/(?:chat-sw|sw)\.js$/.test(r)),'Unexpected HTTP requests: '+JSON.stringify(requests));
    });
    await check('a pairing code for another recipient is rejected before connection',async()=>{
      await openNearby(a);await a.locator('#nearby-person').selectOption(profiles[2].id);await a.locator('#nearby-create').click();await a.waitForFunction(()=>!!document.querySelector('#nearby-output').value);
      const wrong=await a.locator('#nearby-output').inputValue();await openNearby(b);await b.locator('#nearby-disconnect').click();await b.locator('#nearby-person').selectOption(profiles[0].id);await b.locator('#nearby-paste').evaluate(d=>d.open=true);await b.locator('#nearby-input').fill(wrong);await b.locator('#nearby-use').click();await b.waitForFunction(()=>document.querySelector('#nearby-status').textContent.includes('different contact'));
      assert(await b.locator('#nearby-connected').isHidden());
    });
    await check('pairing fits both themes on a narrow screen and retains account keys',async()=>{
      for(const theme of ['light','dark']){await a.evaluate(t=>document.documentElement.dataset.theme=t,theme);await a.setViewportSize({width:390,height:844});await a.locator('#nearby-dialog').evaluate(d=>d.scrollTop=0);assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await a.locator('#nearby-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));await a.locator('#nearby-dialog').screenshot({path:path.join(reportDirectory,`evidence/nearby-pairing-${theme}.png`)});}
      for(const [i,p]of pages.entries())assert.deepEqual((await read(p)).identity.profile,profiles[i]);assert.deepEqual(errors,[]);assert(requests.every(r=>/\/(?:chat-sw|sw)\.js$/.test(r)),'Unexpected HTTP requests: '+JSON.stringify(requests));
    });
    await fs.writeFile(path.join(reportDirectory,'nearby-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),checks,errors,blockedRequests:requests,scope:'Three disposable Edge profiles, real WebCrypto/IndexedDB and WebRTC host data channels. HTTP is blocked after automatic cache preparation. Payment backing is a fixture. No chain call, funding, deployment, physical phone or Bluetooth test.'},null,2)+'\n');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1});
