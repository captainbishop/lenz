const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {securityHeaders}=require('./security-policy.mjs');
async function readiness(page,expected,timeout=60000){
 await page.waitForFunction(()=>{const n=document.querySelector('[data-offline-state]');return n&&n.dataset.offlineState!=='saving';},{},{timeout});
 assert.equal(await page.locator('[data-offline-state]').first().getAttribute('data-offline-state'),expected,'Offline readiness must reflect the saved files');
}

async function run({overrides={},record=true,entry='/',interrupted=false,evicted=false}={}) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-cold-start-'));
 let blocked=interrupted;
 const server=http.createServer(async(req,res)=>{
  try {
   const pathname=new URL(req.url,'http://localhost').pathname;
   for(const [key,value]of Object.entries(securityHeaders(pathname)))res.setHeader(key,value);
   res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'})[pathname==='/'?'.html':path.extname(pathname)]??'application/octet-stream');
   if(pathname.startsWith('/api/')){res.writeHead(503);res.end('External services unavailable');return;}
   if(blocked&&pathname==='/nostr-socket.js'){res.writeHead(503);res.end('Interrupted download');return;}
   const file=pathname==='/'?'index.html':pathname.slice(1);
   res.end(overrides[file]??await fs.readFile(path.join(__dirname,'public',file)));
  }catch{res.writeHead(404);res.end('Not found');}
 });
 let context,serving=true;
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,viewport:{width:1280,height:900},serviceWorkers:'allow'});
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];
  await page.goto(base+entry);
  if(entry==='/'){
   await page.waitForFunction(()=>/saved on this device|Ready offline/.test(document.querySelector('#home-cache-status')?.textContent),{},{timeout:60000});
   await page.goto(base+'/money.html');
  }
  if(await page.locator('#device-profile').count())await page.locator('#device-profile > summary').click();
  await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  const profile=await page.locator('#my-profile').innerText();assert(profile.trim());
  const identity=await page.locator('#my-lenz-id').inputValue();assert(identity);
  if(interrupted){
   await readiness(page,'unavailable');
   assert.equal(await page.locator('[data-offline-state="ready"]').count(),0,'An interrupted save must not claim readiness');
   blocked=false;await context.setOffline(true);await context.setOffline(false);
  }
  if(await page.locator('[data-offline-state]').count())await readiness(page,'ready');
  assert.equal(await page.locator('#my-lenz-id').inputValue(),identity,'Offline installation must preserve identity');
  if(evicted){
   await page.evaluate(async()=>{for(const name of await caches.keys())await(await caches.open(name)).delete('/money.js');});
   await context.setOffline(true);
   await readiness(page,'unavailable',20000);
   assert.equal(await page.locator('[data-offline-state="ready"]').count(),0,'Missing wallet files must not claim readiness');
   await context.setOffline(false);
   await readiness(page,'ready');
  }
  await context.close();context=null;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  await assert.rejects(fetch(base+'/money.html',{signal:AbortSignal.timeout(2000)}));
  context=await open();page=context.pages()[0];
  await context.setOffline(true);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let successfulNetwork=0;context.on('response',response=>{if(response.ok()&&!response.fromServiceWorker())successfulNetwork++;});
  const navigation=await page.goto(base+'/').catch(()=>null);
  assert(navigation?.fromServiceWorker(),'Homepage must reopen from saved application files after the browser and server stop');
  const wallet=await page.goto(base+'/money.html').catch(()=>null);
  assert(wallet?.fromServiceWorker(),'Wallet must reopen offline after closing the browser, without a separate save action');
  await page.locator('#wallet-content').waitFor();assert.equal(await page.locator('#my-profile').innerText(),profile);
  assert.equal(await page.locator('#my-lenz-id').inputValue(),identity);
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  await readiness(page,'ready',15000);
  const pages=['/chat.html','/markets.html?view=spot','/account.html?next=wallet','/routes.html','/recovery.html'];
  for(const route of pages){
   const response=await page.goto(base+route).catch(()=>null);assert(response?.fromServiceWorker(),'Offline entry unavailable: '+route);
   assert.equal(await page.locator('main').count(),1);assert.equal(await page.evaluate(()=>navigator.onLine),false,'Offline browser state on '+route);
   if(route==='/chat.html')await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Private chat is ready.');
   if(route==='/routes.html')await page.waitForFunction(()=>document.querySelector('#draft-list-status')?.textContent==='No saved drafts.');
  }
  await page.goto(base+'/money.html');await page.locator('#wallet-content').waitFor();
  await page.locator('#show-profile').click();await page.locator('#edit-profile').waitFor();
  await page.locator('#profile-name').fill('Offline saved profile');await page.locator('#save-profile').click();
  await page.waitForFunction(()=>document.querySelector('#my-name')?.textContent==='Offline saved profile');
  await page.reload();await page.locator('#wallet-content').waitFor();
  assert.equal(await page.locator('#my-name').innerText(),'Offline saved profile');
  assert.deepEqual(errors,[],'Offline entry points must run their application code');
  assert.equal(successfulNetwork,0,'Cold opening must not receive any network response');
  if(record&&process.env.LENZ_OFFLINE_SCREENSHOT){
   await page.locator('.wallet-settings summary').click();await page.locator('[data-offline-state="ready"]').first().waitFor();
   await page.screenshot({path:process.env.LENZ_OFFLINE_SCREENSHOT,fullPage:true});
   await page.setViewportSize({width:375,height:812});await page.screenshot({path:process.env.LENZ_OFFLINE_SCREENSHOT+'.mobile.png',fullPage:true});
  }
  await context.route('**/*',route=>route.abort());await context.setOffline(false);await page.reload();
  await readiness(page,'ready',15000);
  await page.waitForFunction(()=>document.querySelector('#my-name')?.textContent==='Offline saved profile');
  assert.equal(await page.locator('#my-name').innerText(),'Offline saved profile');
  assert.equal(successfulNetwork,0,'Saved startup must also tolerate an unavailable server when the browser reports online');
  const result={checkedAt:new Date().toISOString(),passed:1,failed:0,entry,interrupted,evicted,pages:['/','/money.html',...pages],browserRestarted:true,serverStopped:true,httpResponsesNoStore:true,browserOffline:true,offlineProfileEdit:true,unavailableServerWithOnlineBrowser:true,successfulNetworkResponses:successfulNetwork,scope:'Disposable persistent Windows Edge profile, real service workers and local identity. No physical phone, OS-installed standalone window, wallet lock, financial funding or settlement proof.'};
  if(record&&process.env.LENZ_OFFLINE_REPORT)await fs.writeFile(process.env.LENZ_OFFLINE_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log('PASS cold opening from '+entry+(interrupted?' after interrupted installation':'')+(evicted?' after missing-file repair':'')+'; offline profile edit and unavailable server');
  return result;
 }finally{
  await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
 }
}
async function upgrade({overrides={},record=true}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-offline-upgrade-'));
 const source=overrides['chat-sw.js']??await fs.readFile(path.join(__dirname,'public/chat-sw.js'),'utf8');
 // An older cache revision with the same module graph isolates worker ownership.
 const previous=source.replace(/const CACHE = '[^']+';/,"const CACHE = 'proof-u-chat-prior-opening-test';");
 let modern=false,context,serving=true;
 const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream');
  if(file==='/installation-test.html'){res.end('<!doctype html><title>Offline installation test</title>');return;}
  if(file==='/chat-sw.js'){res.end(modern?source:previous);return;}
  res.end(await fs.readFile(path.join(__dirname,'public',file.slice(1))));
 }catch{res.writeHead(404);res.end();}});
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'allow'});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];await page.goto(base+'/installation-test.html');
  const install=async(scope,update=false)=>page.evaluate(async({scope,update})=>{
   const r=update?await navigator.serviceWorker.getRegistration(scope):await navigator.serviceWorker.register('/chat-sw.js',{scope});if(update)await r.update();
   const worker=r.installing??r.waiting??r.active;
   if(worker.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);resolve();}else if(worker.state==='redundant'){worker.removeEventListener('statechange',changed);reject(Error('Installation failed'));}};worker.addEventListener('statechange',changed);changed();});
  },{scope,update});
  await install('/chat.html');await install('/money.html');modern=true;await install('/chat.html',true);
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  context=await open();await context.setOffline(true);page=context.pages()[0];
  const response=await page.goto(base+'/money.html').catch(()=>null);
  assert(response?.fromServiceWorker(),'Updating Conversations must preserve the older Wallet cache during an interrupted upgrade');
  await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  const result={checkedAt:new Date().toISOString(),passed:1,failed:0,serverStopped:true,browserRestarted:true,partialUpgrade:true,scope:'Two real worker scopes with distinct cache revisions; synthetic previous revision using current module graph. No user account or financial operation.'};
  if(record&&process.env.LENZ_OFFLINE_REPORT)await fs.writeFile(process.env.LENZ_OFFLINE_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log('PASS an interrupted Conversations update preserves the older offline Wallet');return result;
 }finally{await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={run,upgrade};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
