const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{chromium}=require('playwright');
const publicRoot=path.join(__dirname,'public'),message='This conversation survives automatic first-entry saving.',routes=["/markets.html",'/','/account.html?next=wallet','/routes.html','/money.html','/chat.html','/recovery.html'];
async function startupJourney(entry){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-first-entry-')),profile=path.join(directory,'profile');let context,serving=true,requests=0;
 const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){res.writeHead(503);res.end('Service unavailable');return;}
  const file=path.resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(publicRoot+path.sep));
  res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.setHeader('cache-control','no-store');res.end(await fs.readFile(file));requests++;
 }catch{res.writeHead(404);res.end();}});
 const open=()=>chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,serviceWorkers:'allow',viewport:{width:1280,height:900}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+entry);
  const deadline=Date.now()+60000;let installed=false,last=[];
  while(!installed&&Date.now()<deadline){last=await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>({scope:new URL(r.scope).pathname,active:r.active?.state,script:r.active?.scriptURL})));installed=['/','/chat.html','/money.html','/swap-tools.html','/recovery.html','/account.html'].every(scope=>last.some(r=>r.scope===scope&&r.active==='activated'));if(!installed)await new Promise(resolve=>setTimeout(resolve,100));}
  assert(installed,'The first entry automatically activates all application scopes: '+JSON.stringify(last));
  const readiness=(entry==='/'||entry==='/markets.html')?'#home-cache-status':entry==='/routes.html'?'#route-cache-status':null;
  if(readiness)await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.offlineState==='ready',readiness,{timeout:60000});
  const identity=await page.evaluate(async message=>{
   const {createIdentity,sealMessage}=await import('/peer-crypto.js'),{readState,updateState}=await import('/chat-store.js');
   const existing=await readState();if(existing.identity)throw Error('Disposable test unexpectedly has an existing identity');
   const own=await createIdentity('Startup test'),peer=await createIdentity('Startup contact'),packet=await sealMessage(own,peer.profile,{kind:'chat',text:message});
   await updateState(state=>{state.identity=own;state.contacts=[peer.profile];state.messages=[{packet}];});return {id:own.profile.id,packet:packet.id};
  },message);
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;await assert.rejects(fetch(base+entry,{signal:AbortSignal.timeout(2000)}));
  context=await open();await context.setOffline(true);page=context.pages()[0];page.on('pageerror',error=>errors.push(error.message));let responses=0;context.on('response',response=>{if(response.ok()&&!response.fromServiceWorker())responses++;});
  for(const route of routes){const response=await page.goto(base+route);assert(response.fromServiceWorker(),route+' opens offline after starting from '+entry);assert.equal(await page.locator('main').count(),1);assert.equal(await page.evaluate(()=>navigator.onLine),false);}
  await page.goto(base+'/chat.html');await page.waitForFunction(()=>document.querySelector('#conversation-name')?.textContent==='Startup contact');assert.equal(await page.getByText(message,{exact:true}).count(),1);
  assert.deepEqual(await page.evaluate(async()=>{const {readState}=await import('/chat-store.js');const state=await readState();return {id:state.identity.profile.id,packet:state.messages[0].packet.id};}),identity);
  await page.goto(base+'/money.html');await page.locator('#wallet-content').waitFor();assert.equal(await page.evaluate(async()=>{const {decodeContact}=await import('/contact-card.js');return (await decodeContact(document.querySelector('#my-lenz-id').value)).id;}),identity.id);
  assert.equal(responses,0);assert.deepEqual(errors,[]);const result={checkedAt:new Date().toISOString(),entry,routes,browserRestarted:true,serverStopped:true,successfulNetworkResponses:responses,identityRetained:true,encryptedChatReadable:true,initialRequests:requests};
  if(process.env.LENZ_TEST_REPORT_DIR){await fs.mkdir(process.env.LENZ_TEST_REPORT_DIR,{recursive:true});await fs.writeFile(path.join(process.env.LENZ_TEST_REPORT_DIR,'startup-'+(entry==='/'?'home':entry.split('?')[0].slice(1).replace('.html',''))+'.json'),JSON.stringify(result,null,2)+'\n');}console.log('PASS first entry '+entry+' and offline restart');return result;
 }finally{await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
for(const entry of ["/markets.html",'/','/account.html?next=wallet','/routes.html'])test('starting from '+entry+' automatically saves the app for a complete offline restart',()=>startupJourney(entry));
module.exports={startupJourney};
