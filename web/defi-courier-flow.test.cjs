// Three disposable profiles, real WebRTC, fixture backing and no reachable HTTP.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {securityHeaders}=require('./security-policy.mjs');
const {openWalletSection}=require('./wallet-test-ui.cjs');
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'},contract=config.reserve;
async function choose(p,id,value){const control=p.locator('#'+id+'-control');if(!await control.count())return p.locator('#'+id).selectOption(value);const label=await p.locator('#'+id).evaluate((select,value)=>[...select.options].find(option=>option.value===value).label,value);await control.click();await p.locator('#'+id+'-options').getByRole('option',{name:label,exact:true}).click();}
async function until(page,predicate,arg){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(50);}
 throw Error('Courier state did not reach the expected condition.');
}
const read=p=>p.evaluate(()=>(import('/chat-store.js')).then(m=>m.readState()));
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
async function openNearby(p){
 if(await p.locator('#nearby-dialog').evaluate(d=>d.open))return;
 if(!await p.locator('#nearby-open').isVisible())await p.locator('.wallet-settings summary').click();
 await p.locator('#nearby-open').click();await p.locator('#nearby-dialog').waitFor();
}
async function courierPanel(p){if(!await p.locator('#nearby-courier').evaluate(d=>d.open))await p.locator('#nearby-courier>summary').click();}
async function pair(a,b,ap,bp){
 for(const p of [a,b]){await openNearby(p);if(await p.locator('#nearby-disconnect').isVisible())await p.locator('#nearby-disconnect').click();}
 await a.locator('#nearby-person').selectOption(bp.id);await a.locator('#nearby-create').click();
 await a.waitForFunction(()=>document.querySelector('#nearby-output').value.startsWith('lenz-nearby1_'));
 const offer=await a.locator('#nearby-output').inputValue();
 await b.locator('#nearby-person').selectOption(ap.id);await b.locator('#nearby-paste>summary').click();await b.locator('#nearby-input').fill(offer);await b.locator('#nearby-use').click();
 await b.waitForFunction(()=>document.querySelector('#nearby-output').value.startsWith('lenz-nearby1_'));
 await a.locator('#nearby-paste>summary').click();await a.locator('#nearby-input').fill(await b.locator('#nearby-output').inputValue());await a.locator('#nearby-use').click();
 try{for(const p of [a,b])await p.waitForFunction(()=>!document.querySelector('#nearby-connected').hidden);}
 catch(error){throw Error(error.message+' '+JSON.stringify(await Promise.all([a,b].map(p=>p.evaluate(()=>({status:document.querySelector('#nearby-status').textContent,peers:testPeers.map(pc=>({connection:pc.connectionState,ice:pc.iceConnectionState}))}))))));}
}
(async()=>{
 let offline=false;const requests=[],errors=[];
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=pathname==='/'?'/index.html':pathname;
  if(offline||file.startsWith('/api/')){if(offline)requests.push(file);res.writeHead(503);res.end();return;}
  for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  try{res.end(file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify(config):file==='/carrier-config.json'?JSON.stringify({version:1,carriers:[]}):file==='/nostr-config.json'?JSON.stringify({version:1,relays:[]}):await fs.readFile(path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'})));
  for(const context of contexts)await context.addInitScript(()=>{
   const RTC=RTCPeerConnection;globalThis.testPeers=[];globalThis.testFrames=[];
   const observe=channel=>{const send=channel.send.bind(channel);channel.send=data=>{testFrames.push(JSON.parse(data));return send(data);};return channel;};
   globalThis.RTCPeerConnection=class extends RTC{constructor(config){super(config);testPeers.push(this);this.addEventListener('datachannel',e=>observe(e.channel));}createDataChannel(...args){return observe(super.createDataChannel(...args));}};
  });
  const pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  const track=p=>p.on('pageerror',e=>errors.push(e.message));pages.forEach(track);
  for(const [i,p]of pages.entries()){
   await p.goto(base+'/money.html');await p.locator('#device-profile>summary').click();await p.locator('#wallet-name').fill(['Amina','Chidi','Bola'][i]);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);profiles.push((await read(p)).identity.profile);
  }
  for(const p of pages)await p.evaluate(async profiles=>{await(await import('/chat-store.js')).updateState(s=>{s.contacts=profiles.filter(c=>c.id!==s.identity.profile.id);});},profiles);
  let [sender,carrier,recipient]=pages;
  await sender.evaluate(async contract=>{
   const n=await import('/near-protocol.js');
   return(await import('/chat-store.js')).updateState(async s=>{
    const root=await n.fundingRequest(s.identity,contract,'10'),v=n.emptyNearVault(contract);v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);
   });
  },contract);
  for(const p of pages){await p.reload();await idle(p);await p.waitForFunction(()=>document.querySelector('#money-cache-status').dataset.offlineState==='ready',null,{timeout:120000});}
  offline=true;
  for(const c of contexts){await c.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await c.route('**/*',r=>{requests.push(r.request().url());return r.abort();});}
  for(const p of pages){await p.reload();await idle(p);await openNearby(p);await courierPanel(p);await p.locator('#courier-enabled').click();await until(p,async()=> (await(await import('/nearby-courier.js')).courierSummary()).enabled);}
  await recipient.locator('#nearby-defi-inbox>summary').click();await recipient.locator('#defi-inbox-enabled').click();
  await until(recipient,async()=>(await(await import('/defi-courier.js')).defiInboxSummary()).enabled);
  await sender.locator('#nearby-close').click();await openWalletSection(sender,'defi');await sender.locator('#rhea-open').click();
  assert.equal(await sender.locator('#rhea-privacy').inputValue(),'private');assert.equal(await sender.locator('#rhea-form button[type=submit]').isDisabled(),true);
  await choose(sender,'rhea-privacy','public-testnet');await sender.locator('#rhea-amount').fill('4');await sender.locator('#rhea-minimum').fill('0.25');await sender.locator('#rhea-receiver').fill('receiver.testnet');
  await choose(sender,'defi-method','contact');await choose(sender,'defi-contact',profiles[2].id);await sender.locator('#rhea-form button[type=submit]').click();
  await sender.locator('#defi-approval').waitFor();assert.equal(await sender.locator('#defi-approve').isDisabled(),true);await sender.locator('#defi-consent').check();await sender.locator('#defi-approve').click();
  await sender.locator('#defi-approval').waitFor({state:'hidden'});await idle(sender);
  const original=await sender.evaluate(async contract=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,contract);return {id:v.rheaOrders[0].defi.request.id,vault:v};},contract);
  await sender.getByRole('button',{name:'Send with someone nearby',exact:true}).click();
  await sender.locator('#nearby-dialog').waitFor();
  console.log('Approval saved offline through wallet UI; pairing sender and courier.');
  await pair(sender,carrier,profiles[0],profiles[1]);await courierPanel(sender);
  assert.equal((await carrier.evaluate(()=>(import('/nearby-courier.js')).then(m=>m.courierSummary()))).carried.length,0);
  await sender.locator('#courier-recipient').selectOption(profiles[2].id);await sender.locator('#courier-queue').click();
  await until(carrier,async()=> (await(await import('/nearby-courier.js')).courierSummary()).carried.length===1);
  await until(sender,async config=> (await(await import('/nearby-courier.js')).courierSummary({defiConfig:config})).outgoing[0]?.status==='with-courier',config);
  await sender.locator('#nearby-close').click();
  await sender.waitForFunction(()=>document.querySelector('#rhea-orders .near-state').textContent.includes('With nearby contact'));
  assert.equal((await read(carrier)).messages.length,0);assert.equal(await carrier.locator('#near-total').textContent(),'0');
  const carrierBefore=(await read(carrier)).courierBox;await sender.close();await carrier.reload();await idle(carrier);
  assert.deepEqual((await read(carrier)).courierBox,carrierBefore);
  assert.equal((await carrier.evaluate(()=>(import('/nearby-courier.js')).then(m=>m.courierSummary()))).carried.length,1);
  console.log('Sender closed; courier restarted. Pairing recipient.');await pair(carrier,recipient,profiles[1],profiles[2]);
  try{await until(recipient,async()=>(await(await import('/defi-courier.js')).defiInboxSummary()).requests.length===1);}
  catch(error){throw Error(error.message+' '+JSON.stringify(await Promise.all([carrier,recipient].map(p=>p.evaluate(async()=>({status:document.querySelector('#nearby-status').textContent,total:document.querySelector('#near-total').textContent,messages:(await(await import('/chat-store.js')).readState()).messages.length,courier:await(await import('/nearby-courier.js')).courierSummary()}))))));}
  await until(carrier,async()=> (await(await import('/nearby-courier.js')).courierSummary()).carried.length===2);
  const receivedBox=(await read(recipient)).defiInboxBox;assert.equal((await read(recipient)).nearBox,undefined);
  await recipient.evaluate(()=>{testFrames.length=0;});await pair(carrier,recipient,profiles[1],profiles[2]);
  await recipient.waitForFunction(()=>testFrames.some(f=>f.kind==='ack'));
  const finalRecipient=await read(recipient);assert.deepEqual(finalRecipient.defiInboxBox,receivedBox);assert.equal(finalRecipient.messages.length,0);
  for(const p of [carrier,recipient])await p.locator('#nearby-disconnect').click();
  sender=await contexts[0].newPage();track(sender);await sender.goto(base+'/money.html');await idle(sender);
  await pair(carrier,sender,profiles[1],profiles[0]);
  await until(sender,async contract=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,contract);return !!v.rheaOrders[0].defi.storageReceipt;},contract);
  const after=await sender.evaluate(async contract=>(await import('/near-protocol.js')).readNearVault(await(await import('/chat-store.js')).readState(),contract),contract);
  assert.equal(after.rheaOrders[0].defi.storageReceipt.requestId,original.id);after.rheaOrders[0].defi.storageReceipt=null;assert.deepEqual(after,original.vault);
  assert.equal(await sender.locator('#near-total').textContent(),'6');
  assert.equal((await sender.evaluate(async config=>(await import('/nearby-courier.js')).courierSummary({defiConfig:config}),config)).outgoing[0].status,'received');
  assert(requests.every(r=>r.endsWith('/chat-sw.js')),'Unexpected HTTP: '+JSON.stringify(requests));assert.deepEqual(errors,[]);
  if(!await recipient.locator('#nearby-defi-inbox').evaluate(d=>d.open))await recipient.locator('#nearby-defi-inbox>summary').click();
  await recipient.locator('#defi-inbox-items summary').click();
  for(const theme of ['light','dim','dark']){
   await recipient.setViewportSize({width:375,height:812});await recipient.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await recipient.locator('#nearby-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
   assert(await recipient.locator('#defi-inbox-items').evaluate(d=>d.scrollWidth<=d.clientWidth));
   await recipient.locator('#defi-inbox-items').scrollIntoViewIfNeeded();
   await recipient.locator('#nearby-dialog').screenshot({path:path.join(os.tmpdir(),'lenz-defi-courier-'+theme+'.png')});
  }
  console.log('PASS DeFi courier UI: offline approval, sender departure, carrier restart, opt-in executor intake, duplicate retry, bound storage receipt, unchanged source reservation and three themes');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
