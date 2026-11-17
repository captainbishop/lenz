const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
(async()=>{
 const {createMarketRoute}=await import('./market-relay.mjs'),{createMarketStream}=await import('./market-stream.mjs'),{createHyperliquidCatalogReader}=await import('../integrations/hyperliquid-catalog.mjs'),{readHyperliquidTape}=await import('../integrations/hyperliquid-feed.mjs'),{hyperliquidFixtureFetcher:fetcher}=await import('../integrations/hyperliquid-fixtures.mjs'),{hyperliquidRequest:parse}=await import('./public/hyperliquid-catalog.js'),{checkedHyperliquidEvent:checkEvent}=await import('./public/hyperliquid-feed.js');
 const catalog=createHyperliquidCatalogReader({fetcher}),calls=[],errors=[],checks=[];
 class Socket extends EventTarget{readyState=0;constructor(){super();setImmediate(()=>{if(this.readyState!==3){this.readyState=1;this.dispatchEvent(new Event('open'));}});}send(){}close(){this.readyState=3;}}
 const read=r=>readHyperliquidTape(r,{fetcher,catalog}),route=createMarketRoute({catalog,hyperTape:read,hyperStream:createMarketStream({Socket,read,parse,checkEvent}),discover:async()=>{throw Error('Unavailable fixture provider');}});
 const root=path.join(__dirname,'public'),evidence=process.env.LENZ_MARKET_ENTRY_EVIDENCE_DIR??path.join(os.tmpdir(),'lenz-market-direct-entry');
 await fs.mkdir(evidence,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname.startsWith('/api/')){calls.push({method:req.method,path:pathname});req.headers.host='127.0.0.1:4173';req.headers.origin='http://127.0.0.1:4173';if(await route(req,res))return;res.writeHead(503);res.end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(root+path.sep));res.setHeader('content-type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.wasm':'application/wasm','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of process.argv.includes('--recovery-only')?[]:[390,1280]){
   const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','on'));
   await page.goto(base+'/markets.html?view=perpetuals');
   await page.locator('#hyperliquid-workspace .hyper-row').first().waitFor();
   assert.equal(await page.locator('#market-filters [data-category="perpetuals"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#market-overview').isVisible(),false);
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2'))?.rows.some(row=>row.kind==='builder'));
   assert.equal(await page.locator('#hyperliquid-workspace .hyper-row').count(),2);await page.locator('#hyperliquid-workspace .hyper-row').first().click();if(width===390)await page.locator('#hyperliquid-workspace .hyper-chart-panel>summary').click();await page.locator('#hyperliquid-workspace .hyper-chart canvas').first().waitFor();
   await page.screenshot({path:path.join(evidence,'perpetuals-direct-'+width+'.png'),fullPage:true});checks.push('Cold direct Perpetuals loads its catalogue, selected market and chart without Overview at '+width+'px');
   await page.waitForFunction(()=>document.querySelector('#home-cache-status').dataset.offlineState==='ready',null,{timeout:30000});await context.setOffline(true);await page.reload();await page.locator('#hyperliquid-workspace .hyper-row').first().waitFor();assert.match(await page.locator('#hyperliquid-workspace .hyper-status').innerText(),/Offline/);checks.push('Saved Perpetuals restores on a direct offline reload at '+width+'px');
   await context.close();
  }
  const recovery=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'block'}),recoverPage=await recovery.newPage();recoverPage.setDefaultTimeout(10000);recoverPage.on('pageerror',e=>errors.push(e.message));let failuresLeft=2;await recoverPage.route('**/api/markets/hyper-catalog',r=>failuresLeft-->0?r.fulfill({status:503}):r.continue());await recoverPage.goto(base+'/markets.html?view=perpetuals');await recoverPage.waitForFunction(()=>document.querySelector('#hyperliquid-workspace .hyper-status')?.textContent.includes('unavailable'));await recoverPage.locator('#hyperliquid-workspace .hyper-row').first().waitFor();checks.push('A transient first catalogue failure recovers automatically on direct Perpetuals without visiting Overview');await recovery.close();
  for(const boundary of ['hide','offline','paused']){
   const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();let attempts=0;await page.route('**/api/markets/hyper-catalog',r=>{attempts++;return r.fulfill({status:503});});await page.goto(base+'/markets.html?view=perpetuals');await page.waitForFunction(()=>document.querySelector('#hyperliquid-workspace .hyper-status')?.textContent.includes('Reconnecting'));await page.clock.pauseAt(new Date());
   if(boundary==='hide')await page.locator('#market-filters [data-category="liquidity"]').click();else if(boundary==='offline')await context.setOffline(true);else{await page.locator('#data-settings>summary').click();await page.locator('#market-live').uncheck();}
   const before=attempts;await page.clock.runFor(15000);assert.equal(attempts,before,'Catalogue retry must stop at '+boundary);checks.push('Pending direct catalogue retries stop when '+boundary);await context.close();
  }
  assert.deepEqual(errors,[]);assert.equal(calls.some(r=>/signed|submit|execute|fund|wallet|accounts|quote/.test(r.path)),false);
  const sources={};for(const name of ['public/hyperliquid-ui.js','public/markets.js','public/form-controls.css','market-direct-entry-browser.test.cjs'])sources[name]=createHash('sha256').update(await fs.readFile(path.join(__dirname,name))).digest('hex');
  const report={checkedAt:new Date().toISOString(),passed:checks.length,checks,calls,sources,scope:'Cold direct browser route and offline reload with disposable Edge profiles and fixture Hyperliquid data. No Overview navigation, connected wallet, account read, signature or financial action.'};await fs.writeFile(path.join(evidence,'market-direct-entry-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,sources:report.sources,scope:report.scope},null,2));
 }finally{if(errors.length)console.error(errors);await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
