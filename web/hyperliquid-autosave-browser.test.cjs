const fsSync=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),os=require('node:os');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'web/public'),out=process.env.LENZ_TEST_REPORT_DIR??fsSync.mkdtempSync(path.join(os.tmpdir(),'lenz-catalogue-autosave-'));
fsSync.mkdirSync(out,{recursive:true});
const mode='hyper',checks=[],errors=[];
(async()=>{
 const {createHyperliquidCatalogReader}=await import(pathToFileURL(path.join(root,'integrations/hyperliquid-catalog.mjs'))),{hyperliquidFixtureFetcher}=await import(pathToFileURL(path.join(root,'integrations/hyperliquid-fixtures.mjs')));
 const catalogue=await createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher})({scope:"spot"});
 const lending=null;
 let hold=false,release=null,requestFailed=false,malformed=false,heldRequest=false;
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture'),surface=url.pathname==='/lending.html'?'lending':'hyper';
  if(['/hyper.html','/lending.html'].includes(url.pathname)){res.setHeader('content-type','text/html');res.end(`<!doctype html><html><input id="market-live" type="checkbox"><section id="surface"></section><script type="module">if(localStorage.getItem('fixture-quota')==='on'){const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('lenz-hyperliquid-testnet-catalog-v2')||k==='lenz-hyperliquid-testnet-lending-v2')throw new DOMException('Quota','QuotaExceededError');return original.call(this,k,v);};}const sw=await navigator.serviceWorker.register('/fixture-sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));const target=document.querySelector('#surface');${surface==='hyper'?`const{mountHyperliquid}=await import('/hyperliquid-ui.js');window.surface=mountHyperliquid(target);surface.show(true,'spot');`:`const{mountLendingMarkets}=await import('/lending-market-ui.js');window.surface=mountLendingMarkets(target,{snapshots:()=>[],refreshSources:()=>{},saveSources:()=>{}});surface.show(true);`}</script></html>`);return;}
  if(url.pathname==='/fixture-sw.js'){res.setHeader('content-type','text/javascript');res.end(`const NAME='catalogue-fixture';self.addEventListener('install',e=>e.waitUntil(caches.open(NAME).then(c=>c.addAll(['/hyper.html','/lending.html'])).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(caches.open(NAME).then(async c=>{const prior=await c.match(e.request);if(prior)return prior;const response=await fetch(e.request);if(response.ok)await c.put(e.request,response.clone());return response;}));});`);return;}
  if(url.pathname==='/api/markets/hyper-catalog'||url.pathname==='/api/markets/lending'){
   let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),url.pathname.endsWith('/hyper-catalog')?{privacy:'public',scope:'spot'}:{privacy:'public'});
   if(hold){heldRequest=true;await new Promise(r=>{release=r;});}if(requestFailed){res.writeHead(503);res.end();return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(malformed?{version:1,rows:[{symbol:'BAD'}]}:url.pathname.endsWith('/lending')?lending:catalogue));return;
  }
  if(url.pathname.startsWith('/api/')){res.writeHead(503);res.end();return;}
  const file=path.resolve(publicRoot,'.'+url.pathname);if(!file.startsWith(publicRoot+path.sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const surface of mode==='hyper'?['hyper']:mode==='lending'?['lending']:['hyper','lending']){
   const context=await browser.newContext({viewport:{width:390,height:850}}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
   const row=surface==='hyper'?'.hyper-row':'.lending-market',status=surface==='hyper'?'.hyper-status':'.lending-status',key=surface==='hyper'?'lenz-hyperliquid-testnet-catalog-v2-spot':'lenz-hyperliquid-testnet-lending-v2';
   await page.goto(base+'/'+surface+'.html');await page.locator(row).first().waitFor();
   await assert.doesNotReject(()=>page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('Saved on this device'),status,{timeout:1500}),surface+' must save the successful read without a manual action');
   assert.equal(await page.getByRole('button',{name:surface==='hyper'?'Save offline':'Save lending markets offline',exact:true}).count(),0);
   checks.push(surface+': validated read saves automatically with no manual Save control');
   await context.setOffline(true);await page.reload();await page.locator(row).first().waitFor();assert.match(await page.locator(status).textContent(),/Offline/);checks.push(surface+': full offline reload reopens saved catalogue');
   await context.setOffline(false);await page.evaluate(()=>localStorage.setItem('fixture-quota','on'));await page.reload();await page.locator(row).first().waitFor();await page.waitForFunction(s=>document.querySelector(s).textContent.includes('Could not save'),status);assert.match(await page.locator(status).textContent(),/Could not save/);checks.push(surface+': storage failure is visible while current figures remain available');
   await page.evaluate(()=>localStorage.removeItem('fixture-quota'));requestFailed=true;await page.reload();await page.locator(row).first().waitFor();await page.waitForFunction(s=>/unavailable|could not refresh/i.test(document.querySelector(s).textContent),status);checks.push(surface+': unavailable provider retains historical saved figures');requestFailed=false;
   await context.close();
   for(const boundary of ['hide','offline','hidden','pagehide']){
    hold=true;heldRequest=false;
    const pending=await browser.newContext(),cancelled=await pending.newPage();cancelled.setDefaultTimeout(10000);
    await cancelled.addInitScript(()=>{
     const original=window.fetch;
     window.fetch=async(input,options)=>{
      const catalogue=String(input).includes('/api/markets/hyper-catalog')||String(input).includes('/api/markets/lending');
      try{
       const response=await original(input,catalogue?{...options,signal:undefined}:options);
       if(catalogue)for(const method of ['json','text']){const read=response[method].bind(response);response[method]=async()=>{try{return await read();}finally{setTimeout(()=>window.fixtureReadSettled=true,0);}};}
       return response;
      }catch(error){if(catalogue)window.fixtureReadSettled=true;throw error;}
     };
     const set=Storage.prototype.setItem;window.fixtureCatalogueWrites=0;
     Storage.prototype.setItem=function(key,value){if(key.startsWith('lenz-hyperliquid-testnet-catalog-v2')||key==='lenz-hyperliquid-testnet-lending-v2')window.fixtureCatalogueWrites++;return set.call(this,key,value);};
    });
    await cancelled.goto(base+'/'+surface+'.html');await cancelled.waitForFunction(()=>window.surface);
    await new Promise((resolve,reject)=>{const start=Date.now();function check(){if(heldRequest)return resolve();if(Date.now()-start>10000)return reject(Error('Catalogue request did not start'));setTimeout(check,10);}check();});
    if(boundary==='hide')await cancelled.evaluate(()=>window.surface.show(false));
    else if(boundary==='offline')await pending.setOffline(true);
    else if(boundary==='hidden')await cancelled.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    else await cancelled.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
    // The fixture ignores fetch cancellation so the component must reject the late response itself.
    hold=false;release();release=null;await cancelled.waitForFunction(()=>window.fixtureReadSettled);
    assert.equal(await cancelled.evaluate(k=>localStorage.getItem(k),key),null,surface+' '+boundary+' must reject late persistence');
    assert.equal(await cancelled.evaluate(()=>window.fixtureCatalogueWrites),0,surface+' '+boundary+' must not attempt persistence');
    checks.push(surface+': '+boundary+' rejects a late successful response');await pending.close();
   }
   const fresh=await browser.newContext(),bad=await fresh.newPage();bad.setDefaultTimeout(10000);malformed=true;await bad.goto(base+'/'+surface+'.html');await bad.waitForFunction(s=>/unavailable|could not refresh/i.test(document.querySelector(s)?.textContent??''),status);assert.equal(await bad.locator(row).count(),0);assert.equal(await bad.evaluate(k=>localStorage.getItem(k),key),null);checks.push(surface+': malformed response is rejected before persistence');malformed=false;await fresh.close();
  }
  if(mode!=='lending'){
   const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(base+'/hyper.html');await page.locator('.hyper-row').first().waitFor();
   hold=true;await page.getByRole('button',{name:'Refresh markets',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh markets"]').disabled);await page.getByRole('button',{name:'Remove saved',exact:true}).click();hold=false;release();release=null;await page.waitForFunction(()=>!document.querySelector('button[aria-label="Refresh markets"]').disabled);
   assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2-spot')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2')),null);checks.push('hyper: removing a saved catalogue cancels pending refresh so late response cannot resurrect it');await context.close();
  }
  if(mode==='hyper'){
   const profile=path.join(out,'restart-profile');
   let persistent=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
   for(const surface of ['hyper']){
    const p=await persistent.newPage();await p.goto(base+'/'+surface+'.html');
    await p.locator(surface==='hyper'?'.hyper-row':'.lending-market').first().waitFor();
    await p.waitForFunction(s=>document.querySelector(s)?.textContent.includes('Saved on this device'),surface==='hyper'?'.hyper-status':'.lending-status');
    assert.equal(await p.locator('#market-live').isChecked(),false);await p.close();
   }
   await persistent.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
   persistent=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,offline:true});
   try{
    for(const surface of ['hyper']){
     const p=await persistent.newPage();await p.goto(base+'/'+surface+'.html');
     await p.locator(surface==='hyper'?'.hyper-row':'.lending-market').first().waitFor({timeout:10000});
     assert.equal(await p.evaluate(()=>navigator.onLine),false);
     assert.match(await p.locator(surface==='hyper'?'.hyper-status':'.lending-status').innerText(),/Offline/);
     assert.equal(await p.locator('#market-live').isChecked(),false);
     checks.push(surface+': saved catalogue survives a full offline browser restart with the server stopped');await p.close();
    }
   }finally{await persistent.close();}
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result-'+mode+'.json'),JSON.stringify({at:new Date().toISOString(),checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }finally{await browser.close();if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
})().catch(async error=>{await fs.writeFile(path.join(out,'failure-'+mode+'.json'),JSON.stringify({at:new Date().toISOString(),checks,error:String(error),stack:error.stack},null,2));console.error(error);process.exitCode=1;});
