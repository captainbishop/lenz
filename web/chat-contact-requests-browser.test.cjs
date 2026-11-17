const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

test('adding someone delivers a request before acceptance, and decline stops the conversation',async()=>{
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{
  try{
   const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   res.end(name==='/nostr-config.json'?JSON.stringify({version:1,relays:[]}):await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];
  async function profile(name){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage();
   await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/chat.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
   await page.locator('#device-profile>summary').click();await page.locator('#name').fill(name);await page.locator('#identity-form button[type=submit]').click();await idle(page);
   return page;
  }
  const idle=page=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  const refresh=async page=>{await page.evaluate(()=>{const c=new BroadcastChannel('proof-u-chat-refresh');c.postMessage('changed');c.close();});};
  const a=await profile('Alice'),b=await profile('Bob');
  async function add(page,other){
   const card=await other.evaluate(async()=> (await (await import('/chat-store.js')).readState()).identity.profile);
   await page.locator('#back-people').click();await page.locator('#show-add-contact').click();
   await page.locator('#contact-file').setInputFiles({name:'contact.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(card))});
   await page.locator('#contact-review').waitFor({state:'visible'});await page.locator('#verified').check();await page.locator('#confirm-contact').click();await idle(page);
  }
  async function transfer(page,other){
   const recipient=await other.evaluate(async()=> (await (await import('/chat-store.js')).readState()).identity.profile.id);
   const envelopes=await page.evaluate(async recipient=>{
    const state=await (await import('/chat-store.js')).readState(),{wrapForCarrier}=await import('/carrier-protocol.js');
    return Promise.all(state.messages.filter(r=>r.deliveryRequested&&r.packet.from===state.identity.profile.id&&r.packet.to===recipient).map(r=>wrapForCarrier(state.identity,r.packet)));
   },recipient);
   await other.evaluate(async envelopes=>{
    const {updateState}=await import('/chat-store.js'),{receivePacket}=await import('/receive-packet.js'),{validateEnvelope}=await import('/carrier-protocol.js');
    for(const envelope of envelopes){await validateEnvelope(envelope);await updateState(s=>receivePacket(s,envelope.packet,false,null,envelope.sender));}
   },envelopes);await refresh(other);
  }
  await add(a,b);
  assert.match(await a.locator('#conversation-subtitle').innerText(),/Request pending/);
  await transfer(a,b);await b.locator('#back-people').click();await b.locator('#request-list button').waitFor({state:'visible'});
  assert.equal(await b.locator('#people-count').innerText(),'0','request must not silently add a contact');
  await b.locator('#request-list button').click();await idle(b);assert.equal(await b.locator('#conversation-name').innerText(),'Alice');
  assert(await b.locator('#message').isDisabled());assert(await b.locator('#pay-tusd').isDisabled());
  const output=process.env.LENZ_REQUEST_TEST_OUTPUT;
  if(output){await fs.mkdir(output,{recursive:true});for(const theme of ['light','dim','dark']){
   await b.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await b.screenshot({path:path.join(output,'request-'+theme+'.png')});
  }}
  await b.locator('#accept-contact-request').click();await idle(b);
  assert.equal(await b.locator('#people-count').innerText(),'1');assert(await b.locator('#message').isEnabled());
  await transfer(b,a);await a.waitForFunction(()=>document.querySelector('#conversation-subtitle').textContent.startsWith('Encrypted between'));
  await a.locator('#message').fill('Hello after acceptance');await a.locator('#prepare-message').click();await idle(a);await transfer(a,b);
  await b.locator('.bubble').filter({hasText:'Hello after acceptance'}).waitFor({state:'visible'});
  assert.equal(await b.locator('.bubble').count(),1,'request controls should not appear as messages');
  await transfer(a,b);assert.equal(await b.locator('.bubble').count(),1,'retry should retain one visible message');
  const c=await profile('Cara');await add(c,b);await transfer(c,b);await b.locator('#back-people').click();
  await b.locator('#request-list button').filter({hasText:'Cara'}).click();await idle(b);await b.locator('#decline-contact-request').click();await idle(b);
  assert.equal(await b.locator('#people-count').innerText(),'1');await transfer(b,c);
  await c.waitForFunction(()=>document.querySelector('#conversation-subtitle').textContent.includes('Request declined'));
  assert(await c.locator('#message').isDisabled());await c.reload();await c.waitForFunction(()=>document.querySelector('#conversation-subtitle').textContent.includes('Request declined'));
  await transfer(c,b);await b.locator('#back-people').click();assert.equal(await b.locator('#request-list button').count(),0,'declined retries should stay suppressed');
  await b.evaluate(async()=>{await(await import('/chat-store.js')).updateState(s=>{s.declinedContactIds=[s.contacts[0].id];s.contactRequests=[];});});
  await b.reload();await b.waitForFunction(()=>document.querySelector('#conversation-subtitle').textContent==='Request declined');
  assert(await b.locator('#message').isDisabled());assert(await b.locator('#pay-tusd').isDisabled());
  assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
