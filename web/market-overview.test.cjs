const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const {createMarketRoute}=await import('./market-relay.mjs'),{createMarketStream}=await import('./market-stream.mjs'),{createHyperliquidCatalogReader}=await import('../integrations/hyperliquid-catalog.mjs'),{readHyperliquidTape}=await import('../integrations/hyperliquid-feed.mjs'),{hyperliquidFixtureFetcher:fetcher}=await import('../integrations/hyperliquid-fixtures.mjs'),{hyperliquidRequest:parse}=await import('./public/hyperliquid-catalog.js'),{checkedHyperliquidEvent:checkEvent}=await import('./public/hyperliquid-feed.js');
  const sockets=[],errors=[],checks=[],requests=[];
  class Socket extends EventTarget{
    readyState=0;sent=[];
    constructor(){super();sockets.push(this);setImmediate(()=>{if(this.readyState!==3){this.readyState=1;this.dispatchEvent(new Event('open'));}});}
    send(value){this.sent.push(JSON.parse(value));}close(){this.readyState=3;}
    emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  }
  const catalog=createHyperliquidCatalogReader({fetcher}),read=r=>readHyperliquidTape(r,{fetcher,catalog});
  const route=createMarketRoute({catalog,marketContext:async()=>({version:1,provider:'coinmarketcap',observedAt:Date.now(),marketCap:null,volume24h:null,btcDominance:null}),hyperTape:read,hyperStream:createMarketStream({Socket,read,parse,checkEvent,includeTrades:true}),discover:async()=>{throw Error('Fixture excludes legacy providers');}});
  const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{try{
    if(req.url.startsWith('/api/')){requests.push(req.url);req.headers.host='127.0.0.1:4173';req.headers.origin='http://127.0.0.1:4173';if(await route(req,res))return;throw Error();}
    const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});

 try{
  const evidence=(await import('./market-testnet-fixtures.mjs')).testnetMarketReport(JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8')));
  const templates=Object.fromEntries(evidence.results.filter(r=>r.ok).map(r=>[r.provider,r.observation]));
  async function pageFor({paused=false,legacy=false}={}){
   const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
   if(paused)await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','off'));
   const legacyRequests=[];
   if(legacy)await page.route('**/api/markets/read',async route=>{const b=route.request().postDataJSON();legacyRequests.push(b);const snapshot=structuredClone(templates[b.provider+(b.network?':'+b.network:'')]);snapshot.observedAt=Date.now();snapshot.expiresAt=snapshot.observedAt+60000;await route.fulfill({json:snapshot});});
   return {context,page,legacyRequests};
  }
  {
   const {context,page,legacyRequests}=await pageFor({paused:true,legacy:true});
   await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   assert(!(await page.locator('.overview-status').textContent()).includes('Loading market overview'));
   assert.equal(legacyRequests.length,0);
   checks.push('Paused startup completes its one-shot catalogue load');
   if(!await page.locator('#overview-tools').evaluate(n=>n.open))await page.locator('#overview-tools>summary').click();await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);
   const onchain=page.locator('.overview-section').filter({has:page.getByRole('heading',{name:'On-chain markets',exact:true})});
   await onchain.locator('.overview-market').first().waitFor();
   assert.equal(legacyRequests.length,7);assert.equal(await onchain.locator('.overview-market').count(),6);
   checks.push('Manual overview refresh loads all seven public source snapshots');
   const observedDate=await onchain.locator('.overview-market-name small').first().textContent();
   assert(!observedDate.includes(String(new Date().getFullYear())));
   await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+86400000;});
   if(!await page.locator('#overview-tools').evaluate(n=>n.open))await page.locator('#overview-tools>summary').click();await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);
   assert((await onchain.textContent()).includes('Needs refresh'));
   await page.evaluate(()=>{Date.now=()=>new Date().getTime();});
   checks.push('Current observations hide timestamps while older data still needs a refresh');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lenz-live-market-snapshots-v1'))?.length===7);
   assert.equal(await page.getByRole('button',{name:'Save overview offline',exact:true}).count(),0);
   await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true}));
   await page.goto(base+'/markets.html');
   assert.equal(await onchain.locator('.overview-market').count(),6);
   assert((await page.locator('.overview-status').textContent()).includes('Offline · Saved data'));
   assert((await onchain.textContent()).includes('Saved data'));assert((await onchain.textContent()).includes(String(new Date().getFullYear())));
   checks.push('Saved overview restores all six on-chain rows during simulated offline reload');
   await context.close();
  }
  {
   const {context,page}=await pageFor();await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   await page.locator('[data-category="spot"]').click();await page.locator('.hyper-view-nav:visible [data-view=trade]').click();await page.locator('.hyper-chart[data-candle-count="30"]').waitFor();
   await page.getByRole('searchbox',{name:'Search trading markets'}).fill('USDH');await page.getByText('No candles for this interval',{exact:true}).waitFor();
   await page.locator('[data-category="all"]').click();await page.locator('[data-overview-market="spot:107"]').click();
   await page.waitForFunction(()=>document.querySelector('.hyper-detail h3')?.textContent==='HYPE / USDC');
   assert.equal(await page.getByRole('searchbox',{name:'Search trading markets'}).inputValue(),'');
   await page.locator('.hyper-chart[data-candle-count="30"]').waitFor();
   checks.push('Explicit overview market link clears a conflicting Spot search and opens USDC');await context.close();
  }
  {
   const {context,page}=await pageFor();await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   assert(await page.evaluate(()=>Boolean(localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2'))));await context.setOffline(true);
   await page.locator('[data-overview-market="spot:107"]').click();
   await page.getByText('Connect to load this chart.',{exact:true}).waitFor();
   assert.equal(await page.locator('.hyper-detail h3').textContent(),'HYPE / USDC');assert.equal(await page.locator('.hyper-row').count(),2);
   checks.push('Automatically saved Overview is immediately available to the trading workspace offline');await context.close();
  }
  {
   const {context,page}=await pageFor();await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   for(const key of ['count:spot','section:Active spot markets']){
    const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/markets/hyper-catalog'));
    if(!await page.locator('#overview-tools').evaluate(n=>n.open))await page.locator('#overview-tools>summary').click();await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
    await page.locator(`[data-overview-focus="${key}"]`).focus();
    await refreshed;await page.waitForFunction(()=>!document.querySelector('.overview-actions button').disabled);
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.overviewFocus),key);
   }
   await page.locator('[data-overview-focus="count:perpetuals"]').click();await page.locator('[data-market-id="perp:xyz:0"]').click();
   await page.locator('.hyper-detail h3').filter({hasText:'GOLD'}).waitFor();
   const logo=page.locator('.hyper-detail .market-logo img').first();
   await logo.waitFor();assert.match(await logo.getAttribute('src'),/^\/asset-icons\/hyperliquid\//);
   await page.waitForFunction(()=>{const img=document.querySelector('.hyper-detail .market-logo img');return img?.complete&&img.naturalWidth>0;});
   checks.push('Overview refresh preserves control focus and builder artwork loads locally');await context.close();
  }
  {
   const {context,page}=await pageFor();await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   const withoutRequested=structuredClone(await catalog());withoutRequested.rows=withoutRequested.rows.filter(row=>row.id!=='spot:107');
   await page.route('**/api/markets/hyper-catalog',route=>route.fulfill({json:withoutRequested}));
   await page.locator('[data-overview-market="spot:107"]').click();
   await page.getByText('This market is no longer in the current catalogue.',{exact:true}).waitFor();
   assert.equal(await page.locator('.hyper-detail h3').count(),0);assert.equal(await page.locator('.hyper-chart').count(),0);
   checks.push('Unavailable requested market does not silently fall back to another pair');await context.close();
  }
  for(const theme of ['light','dim','dark'])for(const width of [375,1360]){
   const {context,page}=await pageFor({legacy:true});await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
   await page.addInitScript(theme=>localStorage.setItem('lenz-home-theme',theme),theme);
   await page.goto(base+'/markets.html');await page.locator('[data-overview-market]').first().waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('.overview-artwork')].every(img=>img.complete&&img.naturalWidth>0));
   assert.equal(await page.locator('.overview-artwork').count(),9);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
   assert(await page.locator('.overview-count').evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height>=44)));
   const tickers=await page.locator('.market-ticker-strip>.asset-price-card:visible').evaluateAll(ns=>ns.map(n=>({key:n.dataset.assetKey,top:n.getBoundingClientRect().top,left:n.getBoundingClientRect().left})).sort((a,b)=>a.left-b.left));
   assert.deepEqual(tickers.map(n=>n.key),width<760?['BTC','HYPE','NEAR']:['BTC','ETH','NEAR','SOL','HYPE']);assert(tickers.every(n=>Math.abs(n.top-tickers[0].top)<1));
   if(width<760)assert.equal(await page.locator('.market-ticker-strip .asset-price-plot:visible').count(),0);
   assert.equal(await page.locator('.overview-heading .overview-actions').count(),0);
   await page.locator('#overview-tools>summary').click();assert(await page.getByRole('button',{name:'Remove saved overview',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Save overview offline',exact:true}).count(),0);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.id),'overview-tools');

   await page.screenshot({path:path.join(os.tmpdir(),`lenz-overview-${theme}-${width}.png`),fullPage:true});
   const resolvedTheme=await page.locator('html').getAttribute('data-theme');
   checks.push(`Illustrated overview fits ${resolvedTheme} (${theme} preference) at ${width}px with reduced motion`);await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks},null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
