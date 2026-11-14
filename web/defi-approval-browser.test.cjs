const {openWalletSection}=require('./wallet-test-ui.cjs');
async function walletSettings(p){if(await p.locator('.wallet-settings').count()&&!await p.locator('.wallet-settings').evaluate(n=>n.open))await p.locator('.wallet-settings summary').click();}
// Real Edge UI, IndexedDB, WebCrypto and loopback carrier/inbox; synthetic backing only.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),net=require('node:net'),os=require('node:os'),{createHash}=require('node:crypto');
const {securityHeaders}=require('./security-policy.mjs');
const c={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
const files=['budget-courier.js','offline-budget.js','offline-budget-outbox.js','defi-courier.js','defi-courier-ui.js','nearby-courier.js','nearby-courier-ui.js','nearby-client.js','nearby-connection.js','nearby-ui.js','nearby.css','defi-workspace.js','defi-surfaces.js','defi-surfaces.css','defi-wallet-ui.js','defi-wallet.js','defi-delivery.js','defi-request.js','rhea-wallet.js','rhea-protocol.js','near-wallet.css','chat-sw.js','carrier-protocol.js','chat-store.js','peer-crypto.js','near-protocol.js','wallet-feedback.js'];
async function unused(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return 'http://127.0.0.1:'+p;}
async function run({overrides={},filter,record=true}={}){
 const p=await import('./public/peer-crypto.js'),{createCarrier}=await import('../carrier/server.mjs'),{DefiInbox}=await import('../carrier/defi-inbox.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-approval-')),origin=await unused(),executor=await p.createIdentity('Bola'),other=await p.createIdentity('<img src=x onerror=alert(1)>');
 const sourceFiles={};for(const file of files)sourceFiles['web/public/'+file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'public',file))).digest('hex');
 let browser,carrier,inbox,api=0;const checks=[],errors=[],apiRequests=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),f=url.pathname;
  for(const [k,v]of Object.entries(securityHeaders(f,[origin])))res.setHeader(k,v);
  res.setHeader('Cache-Control','no-store');
  if(f==='/api/markets/assets'&&req.method==='POST'){res.writeHead(503);res.end();return;}
  if(f.startsWith('/api/')||req.method!=='GET'){api++;apiRequests.push(req.method+' '+f);res.writeHead(403);res.end();return;}
  if(f==='/near-config.json'||f==='/rhea-config.json'||f==='/carrier-config.json'||f==='/nostr-config.json'){
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f==='/near-config.json'?{network:'testnet',contract:c.reserve,ready:true}:f==='/rhea-config.json'?c:f==='/carrier-config.json'?{version:1,carriers:[origin]}:{version:1,relays:[]}));return;
  }
  const target=path.resolve(__dirname,'public','.'+(f==='/'?'/index.html':f));if(!target.startsWith(path.resolve(__dirname,'public')+path.sep)){res.writeHead(404);res.end();return;}
  try{const body=overrides[f.slice(1)]??await fs.readFile(target);res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[f==='/'?'.html':path.extname(f)]??'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}
 });
 async function ready(page,base){await page.goto(base+'/money.html');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');if(await page.locator('#wallet-content').isVisible())await openWalletSection(page,'defi');}
 async function review(page){await openWalletSection(page,'defi');await page.locator('#rhea-open').click();await page.locator('#rhea-privacy').selectOption('public-testnet');await page.locator('#rhea-amount').fill('4');await page.locator('#rhea-minimum').fill('0.25');await page.locator('#rhea-receiver').fill('receiver.testnet');await page.locator('#defi-method').selectOption('contact');await page.locator('#defi-contact').selectOption(executor.profile.id);await page.locator('#rhea-form button[type=submit]').click();await page.locator('#defi-approval').waitFor();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');}
 async function approve(page){await review(page);await page.locator('#defi-consent').check();await page.locator('#defi-approve').click();await page.waitForFunction(()=>!document.querySelector('#defi-approval').open);}
 async function state(page){return page.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),n=await import('/near-protocol.js'),v=await n.readNearVault(s,c.reserve),l=await n.nearLedger(v);return {profile:s.identity.profile,contacts:s.contacts,messages:s.messages,vault:v,available:l.available.reduce((t,x)=>t+BigInt(x.amount),0n).toString(),reserved:[...l.reserved]};},c);}
 async function saved(page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save request file',exact:true}).click();return JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));}
 async function test(name,fn){if(filter&&!name.startsWith(filter))return;const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{const base='http://127.0.0.1:'+server.address().port;await ready(page,base);await page.evaluate(async({c,contacts})=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),n=await import('/near-protocol.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Amina');s.contacts=contacts;const v=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'10');v.roots.push({id:f.id,owner:f.owner,amount:f.amount});await n.saveNearVault(s,v);});},{c,contacts:[executor.profile,other.profile]});await ready(page,base);await openWalletSection(page,'defi');await fn({page,context,base});checks.push(name);console.log('PASS '+name);}catch(e){e.message=name+': '+e.message;throw e;}finally{await context.close();}}
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  carrier=createCarrier({origin,directory:path.join(dir,'carrier'),allowedOrigins:[base]});await carrier.listen();inbox=new DefiInbox(path.join(dir,'inbox'),{identity:executor,config:c});browser=await chromium.launch({channel:'msedge',headless:true});
  await test('automatic encrypted updates show pending verification offline and confirm after reconnecting',async({page,context,base})=>{
    await approve(page);const before=await state(page),order=before.vault.rheaOrders[0];let available=false,reads=0;
    await page.route('**/api/defi/rhea/status',async route=>{
      reads++;assert.equal(route.request().postDataJSON().request.id,order.defi.request.id);
      if(!available){await route.fulfill({status:503,json:{error:'Unavailable'}});return;}
      await route.fulfill({json:{requestId:order.defi.request.id,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:{id:order.packet.id,instruction:order.packet.instruction,stage:'complete',output:order.packet.instruction.min_output,reason:''}}}});
    });
    const transport=await import('./public/carrier-protocol.js');
    const packet=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:order.defi.request.id,checkedAt:Date.now(),state:'observed',observation:{claimed:'complete'},transaction:null});
    await transport.carrierPost(origin,'/v1/store',await transport.wrapForCarrier(executor,packet));
    const firstCheck=page.waitForResponse(response=>response.url().endsWith('/api/defi/rhea/status'));
    await walletSettings(page);await page.locator('#carrier-open').click();
    await page.locator('#carrier-options > summary').click();await page.locator('#carrier-enabled').check();
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Update received · awaiting verification');
    await page.waitForFunction(()=>!document.querySelector('#carrier-enabled').disabled);
    await firstCheck;assert(reads>0);assert.equal((await state(page)).vault.rheaOrders[0].defi.checkedOutcome,undefined);
    await page.locator('#carrier-close').click();await walletSettings(page);await page.locator('#prepare-money-offline').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('saved for offline use'));
    await context.setOffline(true);const offlineReads=reads;await ready(page,base);
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Update received · awaiting verification');
    assert.equal(reads,offlineReads);assert(await page.getByRole('button',{name:'Check swap',exact:true}).isDisabled());
    const offline=await state(page);assert.equal(offline.available,before.available);assert.deepEqual(offline.reserved,before.reserved);
    available=true;await context.setOffline(false);
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Swap complete');
    const after=await state(page);assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);
    assert.equal(after.vault.rheaOrders[0].defi.checkedUpdateId,after.vault.rheaOrders[0].defi.executorUpdate.id);
  });
  await test('an executor update file opens offline and waits for a separate completion check',async({page,context,base})=>{
    await approve(page);const before=await state(page),order=before.vault.rheaOrders[0];let reads=0;
    const packet=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:order.defi.request.id,checkedAt:Date.now(),state:'observed',observation:{claimed:'complete'},transaction:null});
    await page.route('**/api/defi/rhea/status',async route=>{
      reads++;assert.equal(route.request().postDataJSON().request.id,order.defi.request.id);
      await route.fulfill({json:{requestId:order.defi.request.id,state:'observed',observation:{finality:'FINAL',block:{height:12,hash:'5'.repeat(32)},order:{id:order.packet.id,instruction:order.packet.instruction,stage:'complete',output:order.packet.instruction.min_output,reason:''}}}});
    });
    await walletSettings(page);await page.locator('#prepare-money-offline').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('saved for offline use'));
    await context.setOffline(true);
    const [chooser]=await Promise.all([page.waitForEvent('filechooser',{timeout:5000}),page.getByRole('button',{name:'Open update file',exact:true}).click({timeout:5000})]);
    await chooser.setFiles({name:'executor-update.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Update received · awaiting verification');
    const saved=await state(page);assert.equal(saved.available,before.available);assert.deepEqual(saved.reserved,before.reserved);
    assert.equal(saved.vault.rheaOrders[0].defi.checkedOutcome,undefined);assert.equal(reads,0);
    const older=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:order.defi.request.id,checkedAt:order.defi.request.createdAt,state:'pending',observation:null,transaction:null});
    const choosingOlder=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open update file',exact:true}).click();
    await(await choosingOlder).setFiles({name:'older-update.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(older))});
    await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
    assert.equal(await page.locator('#rhea-feedback').innerText(),'Update file checked.');assert.deepEqual(await state(page),saved);
    await ready(page,base);assert.equal(await page.locator('#rhea-orders .near-state').innerText(),'Update received · awaiting verification');
    assert(await page.getByRole('button',{name:'Check swap',exact:true}).isDisabled());assert.equal(reads,0);
    await context.setOffline(false);await page.getByRole('button',{name:'Check swap',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Swap complete');
    assert.equal(reads,1);assert.deepEqual((await state(page)).reserved,before.reserved);
  });
  await test('invalid update files preserve the saved swap and allow a valid retry',async({page,context})=>{
    await approve(page);const before=await state(page),order=before.vault.rheaOrders[0];
    const packet=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:order.defi.request.id,checkedAt:Date.now(),state:'pending',observation:null,transaction:null});
    const upload=async text=>{
      const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open update file',exact:true}).click();
      await(await choosing).setFiles({name:'executor-update.json',mimeType:'application/json',buffer:Buffer.from(text)});
      await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
    };
    await context.setOffline(true);
    for(const [text,message]of [
      [JSON.stringify(packet)+' '.repeat(204801),'This update file is too large. Ask for a new file.'],
      ['{','Choose a valid Lenz update file.'],
      ['null','Choose a valid Lenz update file.'],
      [JSON.stringify({...packet,signature:'0'.repeat(128)}),'We could not verify this request. Your balance has not changed.'],
    ]){
      await upload(text);assert.equal(await page.locator('#status').innerText(),message);assert.deepEqual(await state(page),before);
    }
    await upload(JSON.stringify(packet));assert.equal(await page.locator('#rhea-orders .near-state').innerText(),'Update received · awaiting verification');
    const after=await state(page);assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);assert.equal(after.vault.rheaOrders[0].status,null);
  });
  await test('switching accounts during an update file read preserves the new wallet',async({page})=>{
    await approve(page);const before=await state(page),order=before.vault.rheaOrders[0];
    const packet=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:order.defi.request.id,checkedAt:Date.now(),state:'pending',observation:null,transaction:null});
    await page.evaluate(()=>{
      const read=File.prototype.text;window.fileReadStarted=false;
      File.prototype.text=async function(){window.fileReadStarted=true;await new Promise(resolve=>window.finishFileRead=resolve);return read.call(this);};
    });
    const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open update file',exact:true}).click();
    await(await choosing).setFiles({name:'executor-update.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});
    await page.waitForFunction(()=>window.fileReadStarted);
    await page.evaluate(async c=>{
      const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),n=await import('/near-protocol.js');
      await store.updateState(async s=>{s.identity=await p.createIdentity('New account');delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault(c.reserve));});
    },c);
    const changed=await state(page);assert.notEqual(changed.profile.id,before.profile.id);
    await page.evaluate(()=>window.finishFileRead());await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
    assert.deepEqual(await state(page),changed);assert.notEqual(await page.locator('#rhea-feedback').innerText(),'Update file checked.');assert.equal((changed.vault.rheaOrders??[]).length,0);
  });
  await test('checking a delegated swap shows independently confirmed outcome and keeps it offline',async({page,context})=>{
    await approve(page);const before=await state(page),order=before.vault.rheaOrders[0];let reads=0;
    await page.route('**/api/defi/rhea/status',async route=>{
      reads++;assert.equal(route.request().postDataJSON().request.id,order.defi.request.id);
      await route.fulfill({json:{requestId:order.defi.request.id,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:{id:order.packet.id,instruction:order.packet.instruction,stage:'complete',output:order.packet.instruction.min_output,reason:''}}}});
    });
    await page.getByRole('button',{name:'Check swap',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Swap complete');
    assert.equal(reads,1);const after=await state(page);assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);
    assert.equal(await page.getByRole('button',{name:'Save request file',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Send over internet',exact:true}).count(),0);
    await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
    await walletSettings(page);await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('saved for offline use'));
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#rhea-orders .near-state')?.textContent==='Swap complete');
    await openWalletSection(page,'defi');assert(await page.getByRole('button',{name:'Check swap',exact:true}).isDisabled());assert.equal(reads,1);
    assert.deepEqual((await state(page)).reserved,before.reserved);
    if(process.env.LENZ_STATUS_SCREENSHOT)await page.locator('#rhea-orders').screenshot({path:process.env.LENZ_STATUS_SCREENSHOT});
    await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.LENZ_STATUS_SCREENSHOT)await page.locator('#rhea-orders').screenshot({path:process.env.LENZ_STATUS_SCREENSHOT+'.mobile.png'});
  });
  await test('private preference blocks quotes and both approval paths without a public fallback',async({page})=>{
   const before=await state(page);await openWalletSection(page,'defi');await page.locator('#rhea-open').click();await page.locator('#rhea-privacy').waitFor();assert.equal(await page.locator('#rhea-privacy').inputValue(),'private');assert(await page.locator('#rhea-quote').isDisabled());assert(await page.locator('#rhea-form button[type=submit]').isDisabled());
   await page.locator('#rhea-amount').fill('4');await page.locator('#rhea-minimum').fill('0.25');await page.locator('#rhea-receiver').fill('receiver.testnet');
   await page.locator('#rhea-quote').evaluate(b=>b.dispatchEvent(new MouseEvent('click')));await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert((await page.locator('#status').innerText()).includes('You chose a private swap'));
   for(const method of ['self','contact']){await page.locator('#defi-method').selectOption(method);if(method==='contact')await page.locator('#defi-contact').selectOption(executor.profile.id);await page.locator('#rhea-form').evaluate(f=>f.dispatchEvent(new Event('submit',{cancelable:true})));await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert.deepEqual(await state(page),before);assert.equal(await page.locator('#defi-approval').isVisible(),false);}
  });
  await test('DEX quote binds slippage and discards a reply after privacy changes',async({page})=>{
   await openWalletSection(page,'defi');await page.locator('#rhea-open').click();await page.locator('#rhea-privacy').selectOption('public-testnet');await page.locator('#rhea-amount').fill('4');await page.locator('#rhea-slippage').selectOption('50');let held,delay=false,calls=0;
   await page.route('**/api/defi/rhea/quote',async route=>{calls++;const request=route.request().postDataJSON();if(delay)await new Promise(r=>held=r);await route.fulfill({json:{request,amountOut:'2000000000000000000000000',minAmountOut:(2000000000000000000000000n*BigInt(10000-request.slippageBps)/10000n).toString()}});});
   await page.locator('#rhea-quote').click();await page.waitForFunction(()=>document.querySelector('#rhea-output').textContent==='2');assert.equal(await page.locator('#rhea-minimum').inputValue(),'1.99');assert((await page.locator('#rhea-rate').innerText()).includes('0.5 wNEAR'));assert((await page.locator('#rhea-estimate').innerText()).includes('0.5%'));
   if(record)for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width:1200,height:1000});await page.screenshot({path:path.join(__dirname,'evidence','defi-dex-'+theme+'.png')});await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.querySelector('#rhea-dialog').scrollWidth<=document.querySelector('#rhea-dialog').clientWidth));await page.screenshot({path:path.join(__dirname,'evidence','defi-dex-'+theme+'-narrow.png')});}
   delay=true;await page.locator('#rhea-slippage').selectOption('100');await page.locator('#rhea-quote').click();await page.waitForFunction(()=>document.querySelector('#rhea-estimate').textContent.includes('Getting'));await page.locator('#rhea-privacy').selectOption('private');assert(held);held();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert.equal(await page.locator('#rhea-output').innerText(),'—');assert(await page.locator('#rhea-form button[type=submit]').isDisabled());assert.equal(calls,2);assert.equal((await state(page)).available,'10000000');
  });
  await test('invalid quote minimum and changed slippage cannot replace the chosen minimum',async({page})=>{
   await openWalletSection(page,'defi');await page.locator('#rhea-open').click();await page.locator('#rhea-privacy').selectOption('public-testnet');await page.locator('#rhea-amount').fill('4');await page.locator('#rhea-minimum').fill('0.25');let held,delay=false;
   await page.route('**/api/defi/rhea/quote',async route=>{const request=route.request().postDataJSON();if(delay)await new Promise(r=>held=r);await route.fulfill({json:{request,amountOut:'2000000000000000000000000',minAmountOut:delay?'1980000000000000000000000':'1'}});});
   await page.locator('#rhea-quote').click();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert.equal(await page.locator('#rhea-output').innerText(),'—');assert.equal(await page.locator('#rhea-minimum').inputValue(),'0.25');
   delay=true;await page.locator('#rhea-quote').click();await page.waitForFunction(()=>document.querySelector('#rhea-estimate').textContent.includes('Getting'));await page.locator('#rhea-slippage').selectOption('200');assert(held);held();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert.equal(await page.locator('#rhea-output').innerText(),'—');assert.equal(await page.locator('#rhea-minimum').inputValue(),'0.25');assert.equal((await state(page)).available,'10000000');
  });
  await test('DeFi workspace includes other actions without simulated markets or approvals',async({page})=>{
   const before=await state(page);for(const name of ['Supply','Borrow','Liquidity','Stake','Farm','Claims','Withdraw']){await page.locator('.defi-tabs').getByRole('button',{name,exact:true}).click();assert((await page.locator('#defi-market-state .position-unavailable strong').innerText()).includes('unavailable'));assert((await page.locator('#defi-market-state').innerText()).includes('Privacy required'));assert.equal(await page.locator('#defi-market-state button').count(),0);assert.equal(await page.locator('#rhea-open').isVisible(),false);assert.deepEqual(await state(page),before);}await page.locator('.defi-tabs').getByRole('button',{name:'Swap',exact:true}).click();assert(await page.locator('#rhea-open').isVisible());
  });
  await test('review requires unchecked consent and back leaves money unchanged',async({page})=>{
   const before=await state(page);await review(page);assert(await page.locator('#defi-approve').isDisabled());assert(!await page.locator('#defi-consent').isChecked());const terms=await page.locator('#defi-terms').innerText();for(const text of ['4 tUSD','0.25 wrapped test NEAR','receiver.testnet','NEAR testnet'])assert(terms.includes(text));assert.equal(await page.locator('#defi-person-name').innerText(),'Bola');
   await page.locator('#defi-approve').evaluate(b=>b.dispatchEvent(new MouseEvent('click')));assert.deepEqual(await state(page),before);await page.keyboard.press('Escape');assert(await page.locator('#rhea-dialog').isVisible());assert.deepEqual(await state(page),before);
  });
  await test('approval freezes reviewed terms and rapid clicks reserve once',async({page})=>{
   const before=await state(page);await review(page);await page.evaluate(()=>{document.querySelector('#rhea-amount').value='9';document.querySelector('#rhea-receiver').value='wrong.testnet';});await page.locator('#defi-consent').check();await page.locator('#defi-approve').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>!document.querySelector('#defi-approval').open);
   const after=await state(page),order=after.vault.rheaOrders[0];assert.equal(after.vault.rheaOrders.length,1);assert.equal(after.available,'6000000');assert.equal(order.packet.instruction.receiver_id,'receiver.testnet');assert.equal(order.packet.instruction.min_output,'250000000000000000000000');assert.deepEqual(after.profile,before.profile);assert.deepEqual(after.contacts,before.contacts);assert.deepEqual(after.messages,before.messages);assert.equal(await page.getByRole('button',{name:'Start swap',exact:true}).count(),0);
  });
  await test('failed approval write keeps review open and retry creates one order',async({page})=>{
   const before=await state(page);await review(page);await page.locator('#defi-consent').check();await page.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Storage write failed: test disk failure');};});await page.locator('#defi-approve').click();await page.waitForFunction(()=>document.querySelector('#defi-approval .wallet-feedback').textContent.includes('could not save'));assert.deepEqual(await state(page),before);await page.evaluate(()=>IDBObjectStore.prototype.put=window.savedPut);await page.locator('#defi-approve').click();await page.waitForFunction(()=>!document.querySelector('#defi-approval').open);assert.equal((await state(page)).vault.rheaOrders.length,1);
  });
  await test('removing selected contact before approval rejects without reserving money',async({page})=>{
   await review(page);await page.evaluate(async()=>{await(await import('/chat-store.js')).updateState(s=>s.contacts=[]);});await page.locator('#defi-consent').check();await page.locator('#defi-approve').click();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');assert((await page.locator('#defi-approval .wallet-feedback').textContent()).includes('contact was removed'));assert.equal((await state(page)).available,'10000000');
  });
  await test('encrypted file survives cached offline reload and enters real executor inbox',async({page,context,base})=>{
   await approve(page);const original=await saved(page),before=await state(page);assert.equal(original.packet.to,executor.profile.id);assert(!JSON.stringify(original).includes('receiver.testnet'));
   const prepared=page.locator('#prepare-money-offline');await walletSettings(page);await prepared.click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('saved for offline use'));await context.setOffline(true);await ready(page,base);const again=await saved(page);assert.deepEqual(again,original);assert.deepEqual(await state(page),before);
   const accepted=await inbox.receive(original);assert.equal(accepted.duplicate,false);assert.equal((await inbox.receive(again)).duplicate,true);
   const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open update file',exact:true}).click();await(await choosing).setFiles({name:'receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(accepted.receipt))});await page.waitForFunction(()=>document.querySelector('#rhea-orders').textContent.includes('Received · completion not confirmed'));const after=await state(page);assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);assert.equal(after.vault.rheaOrders[0].status,null);
  });
  await test('carrier consent and real HTTP delivery preserve exact envelope on retry',async({page})=>{
   await approve(page);await page.getByRole('button',{name:'Send over internet',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Turn on internet delivery'));const before=await state(page);assert(!before.vault.rheaOrders[0].defi.storedBy);
   await page.evaluate(async()=>{await(await import('/chat-store.js')).updateState(s=>s.carrier={enabled:true,outbox:[],excluded:[]});});
   await page.getByRole('button',{name:'Send over internet',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#rhea-orders').textContent.includes('Sent · awaiting receipt'));const first=(await state(page)).vault.rheaOrders[0].defi.envelope;await page.getByRole('button',{name:'Send over internet',exact:true}).click();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');const after=await state(page);assert.deepEqual(after.vault.rheaOrders[0].defi.envelope,first);assert.deepEqual(after.vault.rheaOrders[0].defi.storedBy,[origin]);assert.equal(after.available,before.available);assert.equal(after.vault.rheaOrders[0].status,null);assert(carrier.store.all().some(e=>e.id===first.id));
  });
  await test('failed durable envelope write makes zero delivery calls',async({page})=>{
   await approve(page);const result=await page.evaluate(async({c,origin})=>{const store=await import('/chat-store.js');await store.updateState(s=>s.carrier={enabled:true,outbox:[],excluded:[]});const v=await(await import('/near-protocol.js')).readNearVault(await store.readState(),c.reserve),put=IDBObjectStore.prototype.put;let calls=0,rejected=false;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk');};try{await(await import('/defi-delivery.js')).sendDefiRequest(c,v.rheaOrders[0].defi.request.id,{version:1,carriers:[origin]},{post:async()=>{calls++;}});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}return {calls,rejected};},{c,origin});assert.deepEqual(result,{calls:0,rejected:true});
  });
  await test('absent carrier consent makes zero posts',async({page})=>{
   await approve(page);const result=await page.evaluate(async({c,origin})=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,c.reserve);let calls=0,rejected=false;try{await(await import('/defi-delivery.js')).sendDefiRequest(c,v.rheaOrders[0].defi.request.id,{version:1,carriers:[origin]},{post:async(o,r,e)=>{calls++;return {type:e.type,id:e.id,status:'stored',expiresAt:e.expiresAt};}});}catch{rejected=true;}return {calls,rejected};},{c,origin});assert.deepEqual(result,{calls:0,rejected:true});
  });
  await test('substituted saved carrier envelope is refused',async({page})=>{
   await approve(page);await saved(page);const rejected=await page.evaluate(async({c,executor})=>{const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),p=await import('/peer-crypto.js');let id;await store.updateState(async s=>{const v=await n.readNearVault(s,c.reserve),a=v.rheaOrders[0].defi;id=a.request.id;a.envelope=await(await import('/carrier-protocol.js')).wrapForCarrier(s.identity,await p.sealMessage(s.identity,executor,{kind:'chat',text:'Substituted file'}));await n.saveNearVault(s,v);});try{await(await import('/defi-wallet.js')).defiHandoff(c,id,{envelope:true});return false;}catch{return true;}},{c,executor:executor.profile});assert(rejected);
  });
  await test('expiry conflict and false carrier receipt cannot change money',async({page})=>{
   await approve(page);await saved(page);const result=await page.evaluate(async({c,origin})=>{const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),w=await import('/defi-wallet.js'),d=await import('/defi-delivery.js');await store.updateState(s=>s.carrier={enabled:true,outbox:[],excluded:[]});const v=await n.readNearVault(await store.readState(),c.reserve),a=v.rheaOrders[0].defi,clock=Date.now;let expired=false,conflict=false,falseAck=false;Date.now=()=>a.request.expiresAt;try{await w.defiHandoff(c,a.request.id,{envelope:true});}catch{expired=true;}finally{Date.now=clock;}try{await d.sendDefiRequest(c,a.request.id,{version:1,carriers:[origin]},{post:async()=>({type:'lenz/carrier/v1',id:a.envelope.id,status:'executed',expiresAt:a.envelope.expiresAt})});}catch{falseAck=true;}await store.updateState(async s=>{const v=await n.readNearVault(s,c.reserve);v.chainConsumed={[v.rheaOrders[0].packet.instruction.input]:'b'.repeat(64)};await n.saveNearVault(s,v);});try{await w.defiHandoff(c,a.request.id,{envelope:true});}catch{conflict=true;}return {expired,conflict,falseAck,vault:await n.readNearVault(await store.readState(),c.reserve)};},{c,origin});assert(result.expired&&result.conflict&&result.falseAck);assert.equal(result.vault.rheaOrders[0].status,null);assert(!result.vault.rheaOrders[0].defi.storedBy);
  });
  await test('delivery rechecks opt-out between carriers and recovers response loss',async({page})=>{
   await approve(page);const result=await page.evaluate(async({c,origin})=>{const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),d=await import('/defi-delivery.js');await store.updateState(s=>s.carrier={enabled:true,outbox:[],excluded:[]});const v=await n.readNearVault(await store.readState(),c.reserve),id=v.rheaOrders[0].defi.request.id,bodies=[];let loss=false,optout=false;
    try{await d.sendDefiRequest(c,id,{version:1,carriers:[origin]},{post:async(o,r,e)=>{bodies.push(e);throw Error('response lost');}});}catch{loss=true;}
    try{await d.sendDefiRequest(c,id,{version:1,carriers:[origin,'https://second.example']},{post:async(o,r,e)=>{bodies.push(e);await store.updateState(s=>s.carrier.enabled=false);return {type:e.type,id:e.id,status:'stored',expiresAt:e.expiresAt};}});}catch{optout=true;}
    return {loss,optout,bodies,vault:await n.readNearVault(await store.readState(),c.reserve)};},{c,origin});assert(result.loss&&result.optout);assert.equal(result.bodies.length,2);assert.deepEqual(result.bodies[0],result.bodies[1]);assert.equal(result.vault.rheaOrders[0].status,null);
  });
  await test('review is safe for hostile names and fits both themes with keyboard and large text',async({page})=>{
   await review(page);await page.locator('#defi-back').click();await page.locator('#defi-contact').selectOption(other.profile.id);await page.locator('#rhea-form button[type=submit]').click();assert.equal(await page.locator('#defi-person-name').innerText(),other.profile.name);assert.equal(await page.locator('#defi-person-name img').count(),0);
   await page.locator('#defi-back').click();await page.locator('#defi-contact').selectOption(executor.profile.id);await page.locator('#rhea-form button[type=submit]').click();
   await page.emulateMedia({reducedMotion:'reduce'});
   for(const theme of ['light','dark'])for(const [width,height]of [[375,812],[812,375],[1280,1000]]){
    await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#defi-approval').scrollWidth<=document.querySelector('#defi-approval').clientWidth));const box=await page.locator('#defi-approve').boundingBox();assert(box.height>=48);
    if(record&&width===375){await fs.mkdir(path.join(__dirname,'evidence'),{recursive:true});await page.screenshot({path:path.join(__dirname,'evidence','defi-approval-'+theme+'.png'),fullPage:true});}
   }
   await page.setViewportSize({width:375,height:812});await page.addStyleTag({content:'#defi-approval{font-size:24px}#defi-approval p{font-size:24px}'});assert(await page.evaluate(()=>document.querySelector('#defi-approval').scrollWidth<=document.querySelector('#defi-approval').clientWidth));await page.locator('#defi-consent').focus();await page.keyboard.press('Space');assert(await page.locator('#defi-consent').isChecked());
  });
  assert.equal(api,0,'No financial endpoint should be called: '+JSON.stringify(apiRequests));assert.deepEqual(errors,[]);
  sourceFiles['web/defi-approval-browser.test.cjs']=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const report={checkedAt:new Date().toISOString(),passed:checks.length,checks,sourceFiles,apiRequests:api,scope:'Disposable Windows Edge UI, cached offline reload, IndexedDB and real local HTTP/SQLite carrier and executor intake. Synthetic backing. No chain dispatch, credit, physical device, remote host or nearby executor delivery.'};
  if(record)await fs.writeFile(path.join(__dirname,'defi-approval-browser-results.json'),JSON.stringify(report,null,2)+'\n');return report;
 }finally{await browser?.close();inbox?.close();await carrier?.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
