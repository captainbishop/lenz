const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

test('Nostr delivers a request to a new recipient and returns acceptance without reciprocal manual adding',async()=>{
  const {testRelay}=await import('./nostr-tools/test-relay.mjs'),relay=await testRelay();
  const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));
      res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
      res.end(name==='/nostr-config.json'?JSON.stringify({version:1,relays:[]}):name==='/carrier-config.json'?JSON.stringify({version:1,carriers:[]}):await fs.readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const pages=[],errors=[];
    for(const name of ['Amina','Bola']){
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage();
      await context.route('**/*',route=>route.request().url().startsWith(base+'/')||route.request().url().startsWith(relay.origin)?route.continue():route.abort());
      page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/chat.html');
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
      await page.evaluate(async({name,origin})=>{
        const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js'),nostr=await import('/nostr-client.js');
        await store.updateState(async s=>{s.identity=await peer.createIdentity(name);});await nostr.setNostrEnabled(true);
        window.requestFailures=[];window.requestClient=nostr.createNostrClient({config:{version:1,relays:[origin]},onError:e=>window.requestFailures.push(e.message)});
      },{name,origin:relay.origin});pages.push(page);
    }
    const [sender,recipient]=pages;
    const profile=await recipient.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile);
    await sender.evaluate(async()=>{await(await import('/nostr-client.js')).setNostrEnabled(false);});
    const requestId=await sender.evaluate(async profile=>{
      const store=await import('/chat-store.js'),s=await store.readState();
      return(await(await import('/contact-requests.js')).addContactRequest(profile,{owner:s.identity.profile.id})).packet.id;
    },profile);
    const tick=page=>page.evaluate(async()=>{window.requestClient.wake();await window.requestClient.tick();});
    await tick(sender);assert.equal(relay.received.length,0,'explicit Off must retain the new request locally');
    await sender.evaluate(async()=>{
      const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');
      await store.updateState(async s=>{const packet=await peer.sealMessage(s.identity,s.contacts[0],{kind:'chat',text:'Unrequested earlier history'});s.messages.push({packet});});
      await(await import('/nostr-client.js')).setNostrEnabled(true);
    });
    await tick(sender);await tick(recipient);
    const incoming=await recipient.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {contacts:s.contacts.length,requests:s.contactRequests,receipt:!!s.messages[0]?.receiptToShare};});
    assert.equal(incoming.contacts,0);assert.equal(incoming.requests.length,1);assert.equal(incoming.requests[0].status,'pending');assert.equal(incoming.requests[0].profile.name,'Amina');assert(incoming.receipt);
    assert.equal(await recipient.evaluate(async()=>(await(await import('/chat-store.js')).readState()).messages.length),1,'Enable sends only explicitly requested history');
    assert(relay.received.some(e=>e.kind===30078));assert(relay.received.every(e=>!JSON.stringify(e).includes('Amina')));
    await tick(recipient);await tick(sender);
    assert(await sender.evaluate(async id=>!!(await(await import('/chat-store.js')).readState()).messages.find(r=>r.packet.id===id)?.receivedReceipt,requestId));
    await recipient.evaluate(async requestId=>{const store=await import('/chat-store.js'),s=await store.readState();await(await import('/contact-requests.js')).resolveContactRequest(requestId,'accepted',{owner:s.identity.profile.id});},requestId);
    await tick(recipient);await tick(sender);
    const result=await sender.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {status:s.contactRequests[0].status,failures:window.requestFailures};});
    assert.equal(result.status,'accepted');assert.deepEqual(result.failures,[]);
    assert.equal(await recipient.evaluate(async()=>(await(await import('/chat-store.js')).readState()).contacts.length),1);
    assert.deepEqual(await recipient.evaluate(()=>window.requestFailures),[]);assert.deepEqual(errors,[]);
    const chatId=await sender.evaluate(async profile=>{
      const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');
      return store.updateState(async s=>{const packet=await peer.sealMessage(s.identity,profile,{kind:'chat',text:'Established chat survives request spam.'});s.messages.push({packet,deliveryRequested:true});return packet.id;});
    },profile);
    await tick(sender);
    await recipient.evaluate(async origin=>{
      const nostr=await import('/nostr-client.js'),socket=await import('/nostr-socket.js');window.requestClient.close();window.requestFailures=[];
      window.requestClient=nostr.createNostrClient({config:{version:1,relays:[origin]},onError:e=>window.requestFailures.push(e.message),connect:async(origin,options)=>{
        const live=await socket.openRelay(origin,options);
        return {...live,read:filter=>filter.kinds[0]===30078?Promise.resolve(Array.from({length:filter.limit},(_,i)=>({id:String(i),created_at:filter.until}))):live.read(filter)};
      }});
    },relay.origin);
    await tick(recipient);
    assert(await recipient.evaluate(async id=>(await(await import('/chat-store.js')).readState()).messages.some(r=>r.packet.id===id),chatId),'saturated public request inbox must not suppress established conversations');
    await sender.evaluate(async profile=>{
      const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');
      await store.updateState(async s=>{s.identity=await peer.createIdentity('Chidi');s.contacts=[];s.messages=[];s.contactRequests=[];s.nostr={enabled:true,outbox:[],excluded:[]};});
      const s=await store.readState();await(await import('/contact-requests.js')).addContactRequest(profile,{owner:s.identity.profile.id});
    },profile);
    await tick(sender);
    await recipient.evaluate(async origin=>{
      const nostr=await import('/nostr-client.js'),socket=await import('/nostr-socket.js'),store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');window.requestClient.close();window.requestFailures=[];
      let replaced=false;window.requestClient=nostr.createNostrClient({config:{version:1,relays:[origin]},onError:e=>window.requestFailures.push(e.message),connect:async(origin,options)=>{
        const live=await socket.openRelay(origin,options);
        return {...live,read:async filter=>{const events=await live.read(filter);if(filter.kinds[0]===30078&&!replaced){replaced=true;await store.updateState(async s=>{s.identity=await peer.createIdentity('Replacement');s.contacts=[];s.messages=[];s.contactRequests=[];s.nostr={enabled:true,outbox:[],excluded:[]};});}return events;}};
      }});
    },relay.origin);
    await tick(recipient);
    const replacement=await recipient.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {name:s.identity.profile.name,contacts:s.contacts.length,messages:s.messages.length,requests:s.contactRequests.length,failures:window.requestFailures};});
    assert.deepEqual(replacement,{name:'Replacement',contacts:0,messages:0,requests:0,failures:[]},'a late inbox must not mutate the replacement account');
    for(const page of pages)await page.evaluate(()=>window.requestClient.close());
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await relay.close();}
});
