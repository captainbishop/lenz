// Exercise an existing cache and identity, using only a disposable local browser.
const {chromium}=require('playwright');
const http=require('node:http'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const checks=[];
(async()=>{
  const current=await fs.readFile(path.join(__dirname,'public/sw.js'),'utf8');
  const paths=JSON.parse(current.match(/const PATHS = (\[[^;]+\]);/)[1].replaceAll("'",'"')).filter(p=>p!=='./vendor/ffjavascript-worker.js');
  const legacy=`const CACHE='proof-u-web-demo-v1';self.addEventListener('install',e=>e.waitUntil((async()=>{await(await caches.open(CACHE)).addAll(${JSON.stringify(paths)});await self.skipWaiting();})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith((async()=>(await(await caches.open(CACHE)).match(e.request))??fetch(e.request))());});`;
  let modern=false,failWorker=false,browser;
  const server=http.createServer(async(req,res)=>{
    try{
      const file=new URL(req.url,'http://localhost').pathname;
      if(modern)for(const [key,value]of Object.entries(securityHeaders(file)))res.setHeader(key,value);
      if(failWorker&&file==='/vendor/ffjavascript-worker.js'){res.writeHead(503);res.end('Deliberate failed update');return;}
      if(file==='/favicon.ico'){res.writeHead(204);res.end();return;}
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
      if(file==='/sw.js'){res.end(modern?current:legacy);return;}
      if(!modern&&file==='/vendor/ffjavascript.js'){res.end(await fs.readFile(path.join(__dirname,'../research/crypto-step/node_modules/ffjavascript/build/browser.esm.js')));return;}
      res.end(await fs.readFile(path.join(__dirname,'public',file==='/'?'index.html':file)));
    }catch(e){res.writeHead(404);res.end(e.code??e.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const ctx=await browser.newContext(),page=await ctx.newPage();
    await page.goto(base+'/money.html');
    await page.getByRole('button',{name:'Continue privately',exact:true}).click();
    await page.locator('#wallet-content').waitFor();
    const identity=await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity);
    await page.goto(base+'/tests.html');
    await page.evaluate(async()=>{
      localStorage.setItem('proof-u-web-demo-v1',JSON.stringify({upgradeSentinel:'existing-demo-state'}));
      await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
    });
    await page.reload();
    assert.equal(await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.legacyInline=true';document.head.append(s);return window.legacyInline===true;}),true);
    assert.equal(await page.evaluate(async()=>Boolean(await(await caches.open('proof-u-web-demo-v1')).match('/vendor/ffjavascript-worker.js'))),false);
    checks.push('legacy cache has the embedded worker and no script policy');
    modern=true;failWorker=true;
    const update=()=>page.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration('/');await registration.update();
      const worker=registration.installing??registration.waiting;
      if(!worker)throw Error('Expected an installing update');
      return new Promise(resolve=>{
        const changed=()=>{if(['activated','redundant'].includes(worker.state)){worker.removeEventListener('statechange',changed);resolve(worker.state);}};
        worker.addEventListener('statechange',changed);changed();
      });
    });
    assert.equal(await update(),'redundant');
    await ctx.setOffline(true);let response=await page.reload();assert(response.fromServiceWorker());
    assert.equal(response.headers()['content-security-policy'],undefined);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('proof-u-web-demo-v1')).upgradeSentinel),'existing-demo-state');
    checks.push('failed update leaves the old offline page and stored demo state usable');
    await ctx.setOffline(false);failWorker=false;assert.equal(await update(),'activated');
    await ctx.setOffline(true);response=await page.reload();assert(response.fromServiceWorker());
    assert(response.headers()['content-security-policy']?.includes("script-src 'self' 'wasm-unsafe-eval'"));
    const cached=await page.evaluate(async()=>{
      const cache=await caches.open('proof-u-web-demo-v1');
      return {worker:await(await cache.match('/vendor/ffjavascript-worker.js')).text(),library:await(await cache.match('/vendor/ffjavascript.js')).text(),proverPolicy:(await cache.match('/prover.js')).headers.get('content-security-policy')};
    });
    assert.equal(cached.worker,await fs.readFile(path.join(__dirname,'public/vendor/ffjavascript-worker.js'),'utf8'));
    assert(!cached.library.includes('data:application/javascript;base64,'));assert(cached.proverPolicy);
    assert.equal(await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.upgradedInline=true';document.head.append(s);return window.upgradedInline===true;}),false);
    checks.push('successful update refreshes cached document and prover policies plus the complete external worker');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('proof-u-web-demo-v1')).upgradeSentinel),'existing-demo-state');
    await ctx.setOffline(false);await page.goto(base+'/money.html');await page.locator('#wallet-content').waitFor();
    assert.deepEqual(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity),identity);
    checks.push('the same IndexedDB identity and earlier demo storage survive both updates');
    const report={checkedAt:new Date().toISOString(),passed:checks.length,failed:0,browser:await browser.version(),scope:'Disposable Edge profile; legacy cache fixture and real service-worker update. No user profile or chain transaction.',checks};
    await fs.writeFile(path.join(__dirname,'security-upgrade-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
