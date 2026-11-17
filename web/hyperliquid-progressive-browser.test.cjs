const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
(async()=>{
 const {createMarketRoute}=await import('./market-relay.mjs'),{createMarketStream}=await import('./market-stream.mjs'),{createHyperliquidCatalogReader}=await import('../integrations/hyperliquid-catalog.mjs'),{readHyperliquidTape}=await import('../integrations/hyperliquid-feed.mjs'),{hyperliquidFixtureFetcher}=await import('../integrations/hyperliquid-fixtures.mjs'),{hyperliquidRequest:parse}=await import('./public/hyperliquid-catalog.js'),{checkedHyperliquidEvent:checkEvent}=await import('./public/hyperliquid-feed.js');
 const checks=[],errors=[],requests=[],timings=[];let reader,release,barrier;
 function reset(){
  barrier=new Promise(r=>release=r);
  reader=createHyperliquidCatalogReader({fetcher:async(url,options)=>{
   const r=JSON.parse(options.body);
   if(['spotMetaAndAssetCtxs','outcomeMeta','outcomeTemplates'].includes(r.type)||r.dex==='xyz'){
    await Promise.race([barrier,new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))]);
   }
   options.signal.throwIfAborted();return hyperliquidFixtureFetcher(url,options);
  }});
 }
 class Socket extends EventTarget{readyState=0;constructor(){super();setImmediate(()=>{if(this.readyState!==3){this.readyState=1;this.dispatchEvent(new Event('open'));}});}send(){}close(){this.readyState=3;}}
 const catalog=options=>reader(options),read=r=>readHyperliquidTape(r,{catalog,fetcher:hyperliquidFixtureFetcher}),route=createMarketRoute({catalog,hyperTape:read,hyperStream:createMarketStream({Socket,read,parse,checkEvent}),discover:async()=>{throw Error('Unavailable fixture source');}});
 const root=path.join(__dirname,'public'),evidence=process.env.LENZ_MARKET_ENTRY_EVIDENCE_DIR??path.join(os.tmpdir(),'lenz-market-progressive');await fs.mkdir(evidence,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/builder-fixture.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app-theme.css"><link rel="stylesheet" href="/theme-tokens.css"><link rel="stylesheet" href="/hyperliquid.css"><link rel="stylesheet" href="/form-controls.css"><script type="module" src="/form-controls.js"></script></head><body><input id="market-live" type="checkbox" checked><section id="hyperliquid-workspace"></section><script type="module">import{mountHyperliquid}from"/hyperliquid-ui.js";mountHyperliquid(document.querySelector("#hyperliquid-workspace")).show(true,"perpetuals","perp:xyz:0");</script></body></html>');return;}
  if(pathname.startsWith('/api/')){requests.push(pathname);req.headers.host='127.0.0.1:4173';req.headers.origin='http://127.0.0.1:4173';if(await route(req,res))return;res.writeHead(503);res.end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(root+path.sep));res.setHeader('content-type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.wasm':'application/wasm','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const mode of ['normal','builder','switch','offline']){
   reset();const context=await browser.newContext({viewport:{width:mode==='builder'?1280:390,height:850},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
   const started=Date.now();await page.goto(base+(mode==='builder'?'/builder-fixture.html':'/markets.html?view=perpetuals'),{waitUntil:'domcontentloaded'});await page.locator('#hyperliquid-workspace .hyper-row').first().waitFor({timeout:1500});timings.push({mode,firstCoreMs:Date.now()-started});
   assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),1);assert.match(await page.locator('#hyperliquid-workspace .hyper-row').innerText(),/BTC/);await page.waitForFunction(()=>document.querySelector('#hyperliquid-workspace .hyper-status').textContent.includes('Loading more venues'));
   const partial=await page.evaluate(()=>({full:localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2'),core:JSON.parse(localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2-core-perps'))}));assert.equal(partial.full,null);assert.equal(partial.core.rows.length,1);assert.equal(partial.core.rows[0].quote.symbol,'USDC');
   if(mode==='builder'){
    assert.match(await page.locator('#hyperliquid-workspace .hyper-detail').innerText(),/Loading the selected market/);assert(!await page.getByText('This market is no longer available.',{exact:true}).count());release();await page.locator('#hyperliquid-workspace .hyper-detail h3').filter({hasText:'GOLD'}).waitFor();assert.equal(await page.locator('#hyperliquid-workspace .hyper-row[aria-pressed=true]').getAttribute('data-market-id'),'perp:xyz:0');checks.push('An exact preferred builder market waits for full discovery and opens when its validated row arrives');
   }else if(mode==='switch'){
    await page.locator('#market-filters [data-category="spot"]').click();assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),0);release();await page.locator('#hyperliquid-workspace .hyper-row').first().waitFor();assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),2);assert.match(await page.locator('#hyperliquid-workspace .hyper-row').first().innerText(),/HYPE/);checks.push('Switching to Spot during core-only loading waits for its full data and never reports core-only as complete');
   }else if(mode==='offline'){
    await context.setOffline(true);release();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2')),null);await page.route('**/api/markets/hyper-catalog',r=>r.fulfill({status:503}));await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await context.setOffline(false);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#hyperliquid-workspace .hyper-row').first().waitFor();assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),1);assert.match(await page.locator('#hyperliquid-workspace .hyper-status').innerText(),/Offline/);checks.push('Cancelling full discovery offline preserves a separate core cache that restores in an offline UI reload');
   }else{
    await page.locator('#hyperliquid-workspace .hyper-row').first().click();await page.locator('#hyperliquid-workspace .hyper-chart-panel>summary').click();await page.locator('#hyperliquid-workspace .hyper-chart canvas').first().waitFor({timeout:1500});assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2')),null);await page.screenshot({path:path.join(evidence,'perpetuals-core-'+mode+'.png')});release();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2'))?.rows.length===5);assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),2);checks.push('Primary Perpetuals and chart render while unrelated feeds stay held, then builder discovery enriches the full catalogue ('+mode+')');
   }
   await context.close();
  }
  assert.deepEqual(errors,[]);assert(!requests.some(p=>/signed|execute|submit|quote|funding|accounts/.test(p)));const sources={};for(const f of ['integrations/hyperliquid-catalog.mjs','integrations/hyperliquid-feed.mjs','web/market-relay.mjs','web/public/hyperliquid-ui.js','web/hyperliquid-progressive-browser.test.cjs'])sources[f]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',f))).digest('hex');
  const report={checkedAt:new Date().toISOString(),passed:checks.length,checks,timings,sources,scope:'Public catalogue and chart HTTP/browser boundaries with all unrelated feeds held, disposable Edge and fixture data. No financial action or live quote.'};await fs.writeFile(path.join(evidence,'hyperliquid-progressive-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
