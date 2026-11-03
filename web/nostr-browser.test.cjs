const {selectRecipient,openIncoming}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const checks=[],errors=[],api=[],contract='nostr-fixture.lenz.testnet';
const read=p=>p.evaluate(async()=>await(await import('/chat-store.js')).readState());
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true'&&!document.querySelector('#status').textContent.startsWith('Opening'));
const wait=async(p,predicate)=>{const start=Date.now();while(Date.now()-start<60000){if(predicate(await read(p)))return;await new Promise(r=>setTimeout(r,200));}throw Error('Expected relay state: '+await p.locator('#nostr-status').innerText());};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
  const {testRelay}=await import('./nostr-tools/test-relay.mjs'),relays=await Promise.all([testRelay(),testRelay()]);
  relays[1].controls.refuse=true;
  let browser;
  const server=http.createServer(async(req,res)=>{try{
    const file=new URL(req.url,'http://localhost').pathname;
    for(const[k,v]of Object.entries(securityHeaders(file,[],relays.map(r=>r.origin))))res.setHeader(k,v);
    if(file.startsWith('/api/')){api.push(file);throw Error('Financial API forbidden');}
    res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
    res.end(file==='/nostr-config.json'?JSON.stringify({version:1,relays:relays.map(r=>r.origin)}):file==='/carrier-config.json'?JSON.stringify({version:1,carriers:[]}):file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify({ready:false,network:'testnet',reserve:contract}):await fs.readFile(path.join(__dirname,'public',file)));
  }catch{res.writeHead(404);res.end('Unavailable');}});
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
    const pages=await Promise.all(contexts.map(c=>c.newPage())),[a,b,c]=pages,profiles=[];
    for(const [i,p]of pages.entries()){p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/money.html');await p.locator('#wallet-name').fill(['Amina','Bola','Chidi'][i]);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);profiles.push((await read(p)).identity.profile);}
    for(const p of pages)await p.evaluate(async peers=>{await(await import('/chat-store.js')).updateState(s=>{s.contacts=peers.filter(p=>p.id!==s.identity.profile.id);});},profiles);
    await a.evaluate(async({contract,to})=>{
      const n=await import('/near-protocol.js'),crypto=await import('/peer-crypto.js');
      await(await import('/chat-store.js')).updateState(async s=>{
        const root=await n.fundingRequest(s.identity,contract,'10'),v=n.emptyNearVault(contract);v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);
        s.messages.push({packet:await crypto.sealMessage(s.identity,s.contacts.find(p=>p.id===to),{kind:'chat',text:'Old history stays local'})});
      });
    },{contract,to:profiles[1].id});
    await check('public delivery requires separate consent and excludes existing history',async()=>{
      assert.equal(relays[0].received.length,0);assert.equal(relays[0].connections.size,0);
      const before=await read(a);await a.reload();await idle(a);
      await a.locator('#carrier-open').click();await a.locator('#nostr-enabled').check();await a.locator('#carrier-close').click();
      const after=await read(a);assert.deepEqual(after.identity.profile,before.identity.profile);assert.deepEqual(after.nearBox,before.nearBox);assert.equal(after.nostr.excluded.length,1);assert.equal(relays[0].received.length,0);
    });
    await check('offline wallet send persists exact ciphertext, survives reload, and relay OK does not mean delivery',async()=>{
      await a.locator('#prepare-money-offline').click();await idle(a);
      await contexts[0].setOffline(true);await a.locator('#near-send').click();await selectRecipient(a,profiles[1].id);await a.locator('#near-send-amount').fill('4');await a.locator('#near-send-form button[type=submit]').click();await idle(a);
      assert.equal(await a.locator('#near-handover').evaluate(n=>n.open),false);
      const id=(await read(a)).messages.at(-1).packet.id;
      await a.reload();await idle(a);await contexts[0].setOffline(false);
      await wait(a,s=>s.nostr.outbox.some(e=>e.packetId===id&&e.storedBy.length));
      const queued=(await read(a)).nostr.outbox.find(e=>e.packetId===id);assert(queued.events.length);assert.equal((await read(b)).messages.length,0);assert(!(await read(a)).messages.find(r=>r.packet.id===id).receivedReceipt);
      for(const event of relays[0].events.values())assert(queued.events.some(e=>JSON.stringify(e)===JSON.stringify(event)));
      await a.reload();await idle(a);
      assert.deepEqual((await read(a)).nostr.outbox.find(e=>e.packetId===id).events,queued.events);
    });
    await check('recipient catches up later, accepts a payment once and sends an authenticated receipt',async()=>{
      await b.locator('#carrier-open').click();await b.locator('#nostr-enabled').check();await b.locator('#carrier-close').click();
      await wait(b,s=>s.messages.length===1);await wait(a,s=>s.messages.some(r=>r.receivedReceipt));
      assert.equal(await b.locator('#near-total').innerText(),'4');assert.equal(await a.locator('#near-total').innerText(),'6');
      await b.reload();await idle(b);assert.equal((await read(b)).messages.length,1);assert.deepEqual(api,[]);
    });
    await check('received value can pass onward offline through the wallet send button',async()=>{
      await c.locator('#carrier-open').click();await c.locator('#nostr-enabled').check();await c.locator('#carrier-close').click();
      await b.locator('#prepare-money-offline').click();await idle(b);await contexts[1].setOffline(true);
      await b.locator('#near-send').click();await selectRecipient(b,profiles[2].id);await b.locator('#near-send-amount').fill('1');await b.locator('#near-send-form button[type=submit]').click();await idle(b);
      assert.equal(await b.locator('#near-handover').evaluate(n=>n.open),false);
      await b.reload();await idle(b);assert.equal(await b.locator('#near-total').innerText(),'3');
      await contexts[1].setOffline(false);await wait(c,s=>s.messages.length===1);assert.equal(await c.locator('#near-total').innerText(),'1');assert.deepEqual(api,[]);
    });
    await check('chat Send delivers a fragmented encrypted message after reconnect',async()=>{
      await a.goto(base+'/chat.html');await idle(a);await a.waitForFunction(()=>document.querySelector('#prepare-message').textContent==='Send');
      await a.locator('#prepare-offline').click();await idle(a);await contexts[0].setOffline(true);
      await a.locator('#message').fill('Meet me after the market. '.repeat(156));await a.locator('#prepare-message').click();await idle(a);
      assert.equal(await a.locator('#handover').evaluate(n=>n.open),false);const id=(await read(a)).messages.at(-1).packet.id;
      await a.reload();await idle(a);await contexts[0].setOffline(false);
      await wait(b,s=>s.messages.some(r=>r.packet.id===id));await wait(a,s=>s.messages.some(r=>r.packet.id===id&&r.receivedReceipt));
      assert((await read(a)).nostr.outbox.find(e=>e.packetId===id).storedBy.some(r=>r.ids.length>1));
    });
    await check('authenticated fragments from different relays complete one message',async()=>{
      await c.locator('#carrier-open').click();await c.locator('#nostr-enabled').uncheck();await c.locator('#carrier-close').click();
      const packed=await a.evaluate(async to=>{
        const s=await(await import('/chat-store.js')).readState(),contact=s.contacts.find(p=>p.id===to);
        const packet=await(await import('/peer-crypto.js')).sealMessage(s.identity,contact,{kind:'chat',text:'Fragments arrive by different routes. '.repeat(100)});
        return(await import('/nostr-protocol.js')).packEnvelope(s.identity,contact,packet);
      },profiles[2].id);
      assert(packed.events.length>1);
      const report=await c.evaluate(async({packed,origins,contract})=>{
        const m=await import('/nostr-client.js'),store=await import('/chat-store.js');await m.setNostrEnabled(true);
        const failures=[];
        const client=m.createNostrClient({config:{version:1,relays:origins},contract,onError:e=>failures.push(e.message),connect:async origin=>({
          publish:async()=>true,close(){},
          read:async filter=>packed.events.filter((e,i)=>i%2===origins.indexOf(origin)&&filter['#p'].includes(e.tags[0][1])&&e.created_at<=filter.until),
        })});
        try{await client.tick();const s=await store.readState();return {count:s.messages.filter(r=>r.packet.id===packed.packetId).length,receipt:!!s.messages.find(r=>r.packet.id===packed.packetId)?.receiptToShare,failures};}
        finally{client.close();await m.setNostrEnabled(false);}
      },{packed,origins:relays.map(r=>r.origin),contract});
      assert.equal(report.count,1);assert(report.receipt);assert.deepEqual(report.failures,[]);
    });
    await check('failed IndexedDB commit opens zero relay connections',async()=>{
      await c.locator('#carrier-open').click();await c.locator('#nostr-enabled').uncheck();await c.locator('#carrier-close').click();
      const count=await c.evaluate(async({origin,contract})=>{
        const m=await import('/nostr-client.js');await m.setNostrEnabled(true);let count=0;
        const client=m.createNostrClient({config:{version:1,relays:[origin]},contract,connect:async()=>{count++;throw Error('unexpected');}});
        const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('storage unavailable');};
        let failed=false;try{await client.tick();}catch{failed=true;}finally{IDBObjectStore.prototype.put=old;client.close();await m.setNostrEnabled(false);}
        if(!failed)throw Error('Expected failed persistence');return count;
      },{origin:relays[0].origin,contract});assert.equal(count,0);
    });
    await check('cross-tab opt-out restores file handover and never queues the new message',async()=>{
      const second=await contexts[0].newPage();await second.goto(base+'/chat.html');await idle(second);
      await second.evaluate(async()=>{await(await import('/nostr-client.js')).setNostrEnabled(false);});
      await a.locator('#message').fill('Keep this file local');await a.locator('#prepare-message').click();await idle(a);
      assert.equal(await a.locator('#handover').evaluate(n=>n.open),true);
      const s=await read(a);assert(!s.nostr.outbox.some(e=>e.packetId===s.messages.at(-1).packet.id));await second.close();
    });
    await check('a recovered relay clears its unavailable status',async()=>{
      relays[1].controls.refuse=false;await b.reload();await idle(b);
      await b.waitForFunction(()=>document.querySelector('#nostr-status').textContent.startsWith('Internet delivery is on.'));
    });
    await check('delivery settings fit light, dark and mobile layouts; identities and chain state are unchanged',async()=>{
      await b.locator('#carrier-open').click();
      for(const theme of ['light','dark']){
        await b.evaluate(t=>{localStorage.setItem('lenz-home-theme',t);dispatchEvent(new StorageEvent('storage',{key:'lenz-home-theme',newValue:t}));},theme);
        for(const [width,height] of [[375,812],[812,375],[1280,900]]){await b.setViewportSize({width,height});assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
        await b.setViewportSize({width:375,height:812});await b.locator('#carrier-settings').screenshot({path:path.join(__dirname,'evidence/internet-delivery-'+theme+'.png')});
      }
      for(const [i,p]of pages.entries()){assert.deepEqual((await read(p)).identity.profile,profiles[i]);assert.deepEqual(await p.evaluate(async contract=>{const s=await(await import('/chat-store.js')).readState();return(await(await import('/near-protocol.js')).readNearVault(s,contract)).receipts;},contract),{});}
      assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
    });
    await fs.writeFile(path.join(__dirname,'nostr-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,apiRequests:api,scope:'Three disposable Edge profiles, actual WebCrypto and IndexedDB, offline service-worker reloads and two real loopback WebSocket relays, one refusing writes. Payment backing is a fixture. No chain call, funding, deployment, physical devices or native Bluetooth.'},null,2)+'\n');
  }finally{await browser?.close();for(const r of relays)await r.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
