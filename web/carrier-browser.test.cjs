const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {securityHeaders}=require('./security-policy.mjs');
const checks=[],errors=[],api=[],contract='carrier-fixture.lenz.testnet';
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true'&&!document.querySelector('#status').textContent.startsWith('Opening'));
const unused=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return 'http://127.0.0.1:'+p;};
const read=p=>p.evaluate(async()=>await(await import('/chat-store.js')).readState());
const waitState=async(p,predicate)=>{const start=Date.now();while(Date.now()-start<40000){if(predicate(await read(p)))return;await new Promise(r=>setTimeout(r,150));}throw Error('Expected saved carrier state was not reached: '+await p.locator('#carrier-status').innerText());};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
  const {createCarrier}=await import('../carrier/server.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-carrier-browser-')),origins=await Promise.all([unused(),unused(),unused()]);
  const nodes=[];let browser,base;
  const server=http.createServer(async(req,res)=>{try{
    const file=new URL(req.url,'http://localhost').pathname;
    for(const[k,v]of Object.entries(securityHeaders(file,origins)))res.setHeader(k,v);
    if(file.startsWith('/api/')){api.push(file);throw Error('Financial requests forbidden');}
    res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
    res.end(file==='/carrier-config.json'?JSON.stringify({version:1,carriers:origins}):file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify({ready:false,network:'testnet',reserve:contract}):await fs.readFile(path.join(__dirname,'public',file)));
  }catch{res.writeHead(404);res.end('Unavailable');}});
  const options=i=>({origin:origins[i],directory:path.join(directory,String(i)),peers:i<2?[origins[i+1]]:[origins[0]],allowedOrigins:[base],interval:50});
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    for(let i=0;i<3;i++){nodes[i]=createCarrier(options(i));await nodes[i].listen();}
    browser=await chromium.launch({channel:'msedge',headless:true});
    const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
    const pages=await Promise.all(contexts.map(c=>c.newPage())),[a,b,c]=pages,profiles=[];
    for(const [i,p]of pages.entries()){
      p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/money.html');await p.locator('#wallet-name').fill(['Amina','Bola','Chidi'][i]);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);profiles.push((await read(p)).identity.profile);
    }
    for(const p of pages)await p.evaluate(async peers=>{await(await import('/chat-store.js')).updateState(s=>{s.contacts=peers.filter(p=>p.id!==s.identity.profile.id);});},profiles);
    await a.evaluate(async({contract,to})=>{const n=await import('/near-protocol.js'),crypto=await import('/peer-crypto.js');await(await import('/chat-store.js')).updateState(async s=>{
      const root=await n.fundingRequest(s.identity,contract,'10'),v=n.emptyNearVault(contract);v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);
      s.messages.push({packet:await crypto.sealMessage(s.identity,s.contacts.find(p=>p.id===to),{kind:'chat',text:'Old private history must stay local'})});
    });},{contract,to:profiles[1].id});
    await check('opt-in leaves old history, identity and wallet ciphertext intact',async()=>{
      const before=await Promise.all(pages.map(async p=>{const s=await read(p);return{profile:s.identity.profile,vault:s.nearBox,messages:s.messages};}));
      for(const p of pages){await p.reload();await idle(p);await p.locator('#carrier-open').click();await p.locator('#carrier-options summary').click();await p.locator('#carrier-enabled').check();await p.waitForFunction(()=>document.querySelector('#carrier-status').textContent.includes('Automatic delivery is on'));await p.locator('#carrier-close').click();}
      for(const [i,p]of pages.entries()){const s=await read(p);assert.deepEqual({profile:s.identity.profile,vault:s.nearBox,messages:s.messages},before[i]);}
      assert.equal((await read(a)).carrier.excluded.length,1);assert.equal((await read(b)).messages.length,0);
      for(const node of nodes)assert.equal(node.store.all().length,0);
    });
    await check('offline payment survives reload and delivers automatically across three carriers',async()=>{
      await a.locator('#prepare-money-offline').click();await idle(a);
      await contexts[0].setOffline(true);
      await a.evaluate(async({contract,to})=>{await(await import('/chat-store.js')).updateState(s=>(import('/near-payment-service.js')).then(m=>m.prepareNearPayment(s,contract,to,'4')));},{contract,to:profiles[1].id});
      await a.reload();await idle(a);assert.equal((await read(a)).messages.length,2);
      // Sender can only reach carrier A; recipient can only reach carrier C.
      await contexts[0].route(origins[1]+'/**',r=>r.abort());await contexts[0].route(origins[2]+'/**',r=>r.abort());
      await contexts[1].route(origins[0]+'/**',r=>r.abort());await contexts[1].route(origins[1]+'/**',r=>r.abort());
      await nodes[1].close();nodes[1]=null;await contexts[0].setOffline(false);
      await waitState(a,s=>s.carrier.outbox.some(e=>e.storedBy.length));
      assert.equal((await read(b)).messages.length,0);
      nodes[1]=createCarrier(options(1));await nodes[1].listen();
      await waitState(b,s=>s.messages.length===1);
      await waitState(a,s=>!!s.messages.find(r=>r.receivedReceipt));
      assert.equal((await read(a)).messages.length,2);assert.equal((await read(b)).messages.length,1);
      assert.equal(await b.locator('#near-total').innerText(),'4');assert.equal(await a.locator('#near-total').innerText(),'6');
      assert.deepEqual(api,[]);
    });
    await check('received money can be passed onward offline without carrier approval or settlement',async()=>{
      await b.locator('#prepare-money-offline').click();await idle(b);await contexts[1].setOffline(true);
      await b.evaluate(async({contract,to})=>{await(await import('/chat-store.js')).updateState(s=>(import('/near-payment-service.js')).then(m=>m.prepareNearPayment(s,contract,to,'1')));},{contract,to:profiles[2].id});
      await b.reload();await idle(b);assert.equal(await b.locator('#near-total').innerText(),'3');
      await contexts[1].setOffline(false);await waitState(c,s=>s.messages.length===1);
      assert.equal(await c.locator('#near-total').innerText(),'1');assert.deepEqual(api,[]);
    });
    await check('invalid carrier mail cannot change money and valid duplicated mail credits once',async()=>{
      const before=await b.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.nearBox;});
      const envelope=nodes[0].store.all().find(e=>e.packet.to===profiles[1].id),bad=structuredClone(envelope);bad.packet.signature='0'.repeat(128);
      const result=await fetch(origins[0]+'/v1/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bad)});assert.equal(result.status,400);
      for(const origin of origins){const r=await fetch(origin+'/v1/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope)});assert.equal(r.status,200);}
      await b.reload();await idle(b);assert.deepEqual((await read(b)).nearBox,before);
      assert.equal((await read(b)).messages.filter(r=>r.packet.id===envelope.packet.id).length,1);
    });
    await check('failed browser persistence prevents any carrier request',async()=>{
      // Pause the automatic worker, then exercise its production client with a failing commit.
      await c.locator('#carrier-open').click();await c.locator('#carrier-options').evaluate(n=>n.open=true);await c.locator('#carrier-enabled').uncheck();await c.locator('#carrier-close').click();
      const count=await c.evaluate(async({origin,contract})=>{
        const {createCarrierClient,setCarrierEnabled}=await import('/carrier-client.js');await setCarrierEnabled(true);let count=0;
        const client=createCarrierClient({config:{version:1,carriers:[origin]},contract,post:async()=>{count++;throw Error('unexpected network');}});
        const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('storage unavailable');};
        let failed=false;try{await client.tick();}catch{failed=true;}finally{IDBObjectStore.prototype.put=old;client.close();await setCarrierEnabled(false);}
        if(!failed)throw Error('Expected persistence failure');return count;
      },{origin:origins[0],contract});assert.equal(count,0);
    });
    await check('hostile inbox contents are isolated and forged custody cannot acknowledge a recipient',async()=>{
      const envelope=await a.evaluate(async to=>{
        const s=await(await import('/chat-store.js')).readState(),p=await(await import('/peer-crypto.js')).sealMessage(s.identity,s.contacts.find(c=>c.id===to),{kind:'chat',text:'Verified carrier delivery'});
        return(await import('/carrier-protocol.js')).wrapForCarrier(s.identity,p);
      },profiles[2].id);
      const report=await c.evaluate(async({origin,contract,envelope})=>{
        const {createCarrierClient,setCarrierEnabled}=await import('/carrier-client.js'),{readState,updateState}=await import('/chat-store.js');
        const before=(await readState()).nearBox;await setCarrierEnabled(true);
        await updateState(async s=>{const packet=await(await import('/peer-crypto.js')).sealMessage(s.identity,s.contacts[0],{kind:'chat',text:'Never trust a storage badge'});s.messages.push({packet});});
        const broken=structuredClone(envelope);broken.id='0'.repeat(64);broken.packet.signature='0'.repeat(128);
        const errors=[];
        const client=createCarrierClient({config:{version:1,carriers:[origin]},contract,onError:e=>errors.push(e.message),post:async(_,route,body)=>route==='/v1/store'?{type:'lenz/carrier/v1',id:body.id,status:'delivered',expiresAt:body.expiresAt}:{type:'lenz/carrier/v1',envelopes:[broken,envelope],next:''}});
        try{await client.tick();const s=await readState();return{errors,vaultUnchanged:JSON.stringify(s.nearBox)===JSON.stringify(before),received:s.messages.filter(r=>r.packet.id===envelope.packet.id).length,receipt:!!s.messages.find(r=>r.packet.id===envelope.packet.id)?.receiptToShare,forgedAcknowledgement:s.messages.some(r=>r.packet.from===s.identity.profile.id&&r.receivedReceipt),stored:s.carrier.outbox.some(e=>e.storedBy.length)};}
        finally{client.close();await setCarrierEnabled(false);}
      },{origin:origins[0],contract,envelope});
      assert(report.errors.length>=2);assert(report.vaultUnchanged);assert.equal(report.received,1);assert(report.receipt);assert.equal(report.forgedAcknowledgement,false);assert.equal(report.stored,false);
    });
    await check('delivery controls fit both themes and mobile widths; keys and finality stay unchanged',async()=>{
      await b.locator('#carrier-open').click();
      for(const theme of ['light','dark']){
        await b.evaluate(t=>{localStorage.setItem('lenz-home-theme',t);dispatchEvent(new StorageEvent('storage',{key:'lenz-home-theme',newValue:t}));},theme);
        for(const [width,height]of [[375,812],[812,375],[1280,900]]){await b.setViewportSize({width,height});assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
        await b.setViewportSize({width:375,height:812});await b.locator('#carrier-settings').screenshot({path:path.join(__dirname,'evidence/carrier-delivery-'+theme+'.png')});
      }
      for(const [i,p]of pages.entries()){
        const state=await read(p);assert.equal(state.identity.profile.id,profiles[i].id);
        const receipts=await p.evaluate(async contract=>{const s=await(await import('/chat-store.js')).readState();return(await(await import('/near-protocol.js')).readNearVault(s,contract)).receipts;},contract);assert.deepEqual(receipts,{});
      }
      assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
    });
    await check('wallet send queues offline without a file dialog and delivers once after reload',async()=>{
      const before=(await read(b)).messages.length;
      await a.locator('#near-send').click();await a.locator('#near-recipient').selectOption(profiles[1].id);
      await a.locator('#near-send-amount').fill('0.5');await contexts[0].setOffline(true);
      await a.locator('#near-send-form button[type=submit]').click();await idle(a);
      assert.equal(await a.locator('#near-handover').evaluate(n=>n.open),false);
      assert.match(await a.locator('#near-feedback').innerText(),/saved for delivery/i);
      const id=(await read(a)).messages.at(-1).packet.id;
      await a.reload();await idle(a);await contexts[0].setOffline(false);
      await waitState(b,s=>s.messages.some(r=>r.packet.id===id));await waitState(a,s=>!!s.messages.find(r=>r.packet.id===id)?.receivedReceipt);
      assert.equal((await read(b)).messages.length,before+1);assert.deepEqual(api,[]);
    });
    await check('chat Send survives offline reload, delivers automatically and receives a signed receipt',async()=>{
      await a.goto(base+'/chat.html');await idle(a);await a.waitForFunction(()=>document.querySelector('#prepare-message').textContent==='Send');
      await a.locator('#prepare-offline').click();await idle(a);await contexts[0].setOffline(true);
      await a.locator('#message').fill('Meet me after the market');await a.locator('#prepare-message').click();await idle(a);
      assert.equal(await a.locator('#handover').evaluate(n=>n.open),false);assert.match(await a.locator('#status').innerText(),/saved for delivery/i);
      const id=(await read(a)).messages.at(-1).packet.id;
      await a.reload();await idle(a);assert.match(await a.locator('#messages').innerText(),/Meet me after the market/);
      await contexts[0].setOffline(false);await waitState(b,s=>s.messages.some(r=>r.packet.id===id));
      await waitState(a,s=>!!s.messages.find(r=>r.packet.id===id)?.receivedReceipt);
      assert.equal((await read(b)).messages.filter(r=>r.packet.id===id).length,1);assert.deepEqual(api,[]);
    });
    await check('chat Pay queues an offline payment without opening file sharing',async()=>{
      await contexts[0].setOffline(true);await a.locator('#pay-tusd').click();await idle(a);
      await a.locator('#chat-pay-amount').fill('0.25');await a.locator('#chat-pay-submit').click();await idle(a);
      assert.equal(await a.locator('#handover').evaluate(n=>n.open),false);assert.match(await a.locator('#status').innerText(),/saved for delivery/i);
      const id=(await read(a)).messages.at(-1).packet.id;await contexts[0].setOffline(false);
      await waitState(b,s=>s.messages.some(r=>r.packet.id===id));await waitState(a,s=>!!s.messages.find(r=>r.packet.id===id)?.receivedReceipt);
      assert.deepEqual(api,[]);
    });
    await check('a cross-tab opt-out restores manual sharing even before the composer label refreshes',async()=>{
      const second=await contexts[0].newPage();await second.goto(base+'/chat.html');await idle(second);
      await second.evaluate(async()=>{await(await import('/carrier-client.js')).setCarrierEnabled(false);});
      await a.locator('#message').fill('Keep this file local');await a.locator('#prepare-message').click();await idle(a);
      assert.equal(await a.locator('#handover').evaluate(n=>n.open),true);
      const id=(await read(a)).messages.at(-1).packet.id;
      for(const node of nodes)assert(!node.store.all().some(e=>e.packet.id===id));
      assert(!(await read(a)).carrier.outbox.some(e=>e.envelope.packet.id===id));await second.close();
      assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
    });
    await fs.writeFile(path.join(__dirname,'carrier-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,apiRequests:api,scope:'Three disposable Windows Edge profiles with real WebCrypto, IndexedDB, service-worker offline reloads and three real loopback HTTP/SQLite carriers. tUSD backing is a fixture. No chain request, funding, deployment, physical device, BLE or independent remote operator was used.'},null,2)+'\n');
  }finally{await browser?.close();for(const node of nodes)await node?.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
