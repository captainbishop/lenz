const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {run}=require('./offline-launch.test.cjs');

const publicRoot=path.join(__dirname,'public');
const routes=[['/money.html','#money-cache-status'],['/chat.html','#chat-cache-status'],['/recovery.html','#backup-cache-status']];
const text='This encrypted chat was saved before the application update.';

async function ready(page,selector,timeout=60000){
 await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.offlineState==='ready',selector,{timeout});
 assert.equal(await page.locator(selector).evaluate(node=>node.tagName),'P','Offline readiness is a status, without a save action');
 assert.equal(await page.getByRole('button',{name:/^Save (?:page )?offline$|^Save for offline use$/}).count(),0);
}

async function seed(page){
 await page.locator('#device-profile > summary').click();
 await page.locator('#wallet-private').click();
 await page.locator('#wallet-content').waitFor();
 return page.evaluate(async text=>{
  const {readState,updateState}=await import('/chat-store.js');
  const {createIdentity,sealMessage}=await import('/peer-crypto.js');
  const state=await readState(),peer=await createIdentity('Offline test contact');
  const packet=await sealMessage(state.identity,peer.profile,{kind:'chat',text});
  await updateState(state=>{state.contacts.push(peer.profile);state.messages.push({packet});});
  return {id:state.identity.profile.id,packet:packet.id};
 },text);
}

async function retained(page,fixture){
 assert.deepEqual(await page.evaluate(async()=>{
  const {readState}=await import('/chat-store.js');
  const {openMessage}=await import('/peer-crypto.js');
  const state=await readState(),record=state.messages[0];
  const content=await openMessage(state.identity,state.contacts[0],record.packet);
  return {id:state.identity.profile.id,packet:record.packet.id,text:content.text};
 }),{...fixture,text},'The same identity keys still open the saved encrypted conversation');
}

async function activeScope(page,scope){
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  if(await page.evaluate(async scope=>(await navigator.serviceWorker.getRegistrations()).some(r=>new URL(r.scope).pathname===scope&&r.active?.state==='activated'),scope))return;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.fail('Prior scope failed to activate: '+scope);
}

async function offlineFunding(page){
 const saved=await page.evaluate(async()=>{
  const {HYPERLIQUID_TESTNET_GRANTS}=await import('/hyperliquid-funding-policy.js');
  const {newHyperliquidSetupAction}=await import('/hyperliquid-account-setup.js');
  const {createTornadoProver}=await import('/tornado-prover.js');
  const {AURORA_INTENT_DEPLOYMENT}=await import('/intent-aurora-config.js');
  await import('/intent-aurora-source.js');
  await import('/intent-aurora-funding.js');
  await import('/intent-aurora-funding-ui.js');
  await import('/intent-aurora-account.js');
  await import('/intent-aurora-plan.js');
  await import('/intent-aurora-route.js');
  const prover=createTornadoProver();let timer;
  try{
   const note=await Promise.race([prover.generateNote(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The saved original note worker did not respond offline')),15000);})]);
   return {grants:HYPERLIQUID_TESTNET_GRANTS,setup:newHyperliquidSetupAction('0x'+'1'.repeat(40),123).abstraction,chain:AURORA_INTENT_DEPLOYMENT.chainId,valid:await prover.validateNote(note)};
  }finally{clearTimeout(timer);prover.dispose();}
 });
 assert.deepEqual(saved,{grants:{spotUSDC:'12',perpsUSDC:'3'},setup:'disabled',chain:1313161555,valid:true},'Saved funding modules and the original note computation work without the server');
}

async function shellJourney({previous=false,overrides={},previousRoot=null}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-automatic-shell-'));
 const previousSources={};
 if(previous){
  for(const file of ['sw.js','chat-sw.js','money.html','money.js','chat.html','chat.js','recovery.html'])previousSources[file]=await fs.readFile(path.join(publicRoot,file),'utf8');
  // This synthetic prior version preserves the reported controls and uses the new startup code.
  previousSources['sw.js']=previousSources['sw.js'].replace(/Market shell revision: [^\r\n]+/,'Market shell revision: financial-recovery-20261112-r2');
  previousSources['chat-sw.js']=previousSources['chat-sw.js'].replace(/const CACHE = '[^']+';/,"const CACHE = 'proof-u-chat-v181-financial-recovery';");
  previousSources['money.html']=previousSources['money.html'].replace('<p id="money-cache-status" role="status"></p>','<button id="prepare-money-offline" type="button" class="secondary">Save offline</button>');
  previousSources['money.js']=previousSources['money.js'].replace("startOfflineAccess($('#money-cache-status'))","startOfflineAccess($('#prepare-money-offline'))");
  previousSources['chat.html']=previousSources['chat.html'].replace('<p id="chat-cache-status" role="status"></p>','<button id="prepare-offline" type="button" class="secondary">Save for offline use</button>');
  previousSources['chat.js']=previousSources['chat.js'].replace("startOfflineAccess($('#chat-cache-status'))","startOfflineAccess($('#prepare-offline'))");
  previousSources['recovery.html']=previousSources['recovery.html'].replace('<p id="backup-cache-status"','<button id="save-backup-offline" type="button">Save page offline</button><p id="backup-cache-status"');
 }
 let modern=!previous,context,serving=true,requests=0,missing=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname.startsWith('/api/')){res.writeHead(503);res.end('Service unavailable');return;}
   const file=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
   assert(file.startsWith(publicRoot+path.sep));
   const relative=path.relative(publicRoot,file);
   const content=!modern&&previousRoot?await fs.readFile(path.join(previousRoot,relative)):(!modern?previousSources[relative]:undefined)??overrides[relative]??await fs.readFile(file);
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.end(content);requests++;
  }catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404);res.end();}
 });
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'allow',viewport:{width:1280,height:900}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  if(previousRoot){await page.goto(base+'/');await activeScope(page,'/');}
  await page.goto(base+'/recovery.html');
  if(previousRoot){
   await page.getByRole('button',{name:'Save page offline',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#backup-cache-status')?.textContent==='Page saved for offline use.',null,{timeout:60000});
   await activeScope(page,'/recovery.html');
  }else{
  await page.waitForFunction(()=>{const node=document.querySelector('#backup-cache-status');return node&&node.dataset.offlineState&&node.dataset.offlineState!=='saving';},{},{timeout:60000});
  if(await page.locator('#backup-cache-status').getAttribute('data-offline-state')!=='ready'){
   const diagnosis=await page.evaluate(async()=>{
    let duplicate;try{await(await caches.open('duplicate-probe')).addAll(['/brand/mark.svg','/brand/mark.svg']);}catch(error){duplicate=error.message;}await caches.delete('duplicate-probe');
    let saving;try{await(await import('/offline-access.js')).ensureOfflineAccess();}catch(error){saving=error.message;}
    return {duplicate,saving,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,installing:r.installing?.state,waiting:r.waiting?.state}))};
   });
   assert.fail(JSON.stringify({status:await page.locator('#backup-cache-status').textContent(),errors,missing,diagnosis}));
  }
  }
  if(previous)assert.equal(await page.getByRole('button',{name:'Save page offline',exact:true}).count(),1,'The preserved prior version reproduces the reported button');
  else await ready(page,'#backup-cache-status');
  await page.goto(base+'/money.html');
  const fixture=await seed(page);
  if(previous){
   modern=true;
   await page.goto(base+'/recovery.html');
   // The saved prior page itself starts the background update; no manual save is used.
   const worker=String(overrides['chat-sw.js']??await fs.readFile(path.join(publicRoot,'chat-sw.js')));
   const revision=worker.match(/const CACHE = '([^']+)';/)[1];
   if(previousRoot){
    const installDeadline=Date.now()+60000;let installed=false;
    while(!installed&&Date.now()<installDeadline){
     installed=await page.evaluate(async revision=>{
      const response=await(await caches.open(revision)).match('/recovery.html');
      return response&&!((await response.text()).includes('save-backup-offline'))&&(await navigator.serviceWorker.getRegistrations()).every(r=>r.active?.state==='activated'&&!r.installing&&!r.waiting);
     },revision);
     if(!installed)await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(installed,'The new cache installs over the supplied prior app');
    // Reopening uses the new page. Older scopes may first time out their unsupported status request.
    await page.reload();await ready(page,'#backup-cache-status',180000);
   }
   const deadline=Date.now()+60000;
   let updated=false;
   while(!updated&&Date.now()<deadline){
    updated=await page.evaluate(async revision=>{
     const registrations=await navigator.serviceWorker.getRegistrations();
     const response=await(await caches.open('proof-u-web-demo-v1')).match('/recovery.html');
     return response&&!((await response.text()).includes('save-backup-offline'))&&(await caches.keys()).includes(revision)&&registrations.every(r=>r.active?.state==='activated'&&!r.installing&&!r.waiting);
    },revision);
    if(!updated)await new Promise(resolve=>setTimeout(resolve,100));
   }
   assert(updated,JSON.stringify({message:'Both workers finish updating the saved application files',diagnosis:await page.evaluate(async()=>({registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,installing:r.installing?.state,waiting:r.waiting?.state})),caches:await caches.keys(),rootRecovery:(await(await caches.open('proof-u-web-demo-v1')).match('/recovery.html'))?.status}))}));
   const savedRoot=await page.evaluate(async()=>{for(const name of await caches.keys()){if(name==='proof-u-web-demo-v1')return(await(await caches.open(name)).match('/recovery.html')).text();}});
   assert(!savedRoot.includes('save-backup-offline'),'The root worker updates its saved Recovery document as well');
   await page.reload();await ready(page,'#backup-cache-status');
  }
  for(const [route,selector]of routes){
   await page.goto(base+route);await ready(page,selector);await retained(page,fixture);
  }
  assert.equal(await page.locator('#prepare-backup').count(),1,'External backup creation remains deliberate');
  assert.equal(await page.locator('#download-backup').count(),1,'External backup export remains deliberate');
  await context.close();context=null;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  await assert.rejects(fetch(base+'/recovery.html',{signal:AbortSignal.timeout(2000)}));
  context=await open();await context.setOffline(true);page=context.pages()[0];
  page.on('pageerror',error=>errors.push(error.message));
  let networkResponses=0;context.on('response',response=>{if(response.ok()&&!response.fromServiceWorker())networkResponses++;});
  const home=await page.goto(base+'/',{waitUntil:'domcontentloaded'});assert(home.fromServiceWorker(),'Home opens from saved files');await offlineFunding(page);
  for(const [route,selector]of routes){
   const response=await page.goto(base+route);assert(response.fromServiceWorker(),route+' opens from saved application files');
   await ready(page,selector);await retained(page,fixture);
   assert.equal(await page.evaluate(()=>navigator.onLine),false);
   if(route==='/money.html')await offlineFunding(page);
  }
  assert.deepEqual(errors,[]);assert.equal(networkResponses,0);
  assert(requests>0,'Only the initial installation used the static fixture server');
 }finally{
  await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
 }
}

test('opening Recovery automatically saves Wallet, Conversations and Recovery for an offline browser restart',()=>shellJourney());
test('synthetic prior cache updates automatically and retains the same encrypted identity and chat',()=>shellJourney({previous:true}));
if(process.env.LENZ_PRIOR_PUBLIC_ROOT)test('installed prior app upgrades without a new save action and retains encrypted chat',()=>shellJourney({previous:true,previousRoot:path.resolve(process.env.LENZ_PRIOR_PUBLIC_ROOT)}));
test('an interrupted automatic installation recovers after reconnecting',()=>run({entry:'/money.html',interrupted:true,record:false}));
test('evicted application files show incomplete readiness and repair after reconnecting',()=>run({entry:'/money.html',evicted:true,record:false}));

module.exports={shellJourney};
