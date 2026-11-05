const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.LENZ_DEGEN_TEST_BASE??'http://127.0.0.1:4173';
(async()=>{
 const {normalizeDiscovery,normalizeTrades}=await import('../integrations/degen-discovery.mjs'),{networkFixture,candleFixture,tradeTableFixture}=await import('../integrations/degen-fixtures.mjs');
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];let candles=0,slow=false;
 try{
  await context.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','on'));
  await context.route('**/api/**',async route=>{const request=route.request();if(!request.url().includes('/api/degen/'))return route.fulfill({status:503,json:{}});const r=request.postDataJSON();if(r.kind==='candles'){candles++;if(slow)await new Promise(r=>setTimeout(r,900));return route.fulfill({json:{version:1,request:r,observedAt:Date.now()-120000,candles:candleFixture(r.interval,Date.now()-120000),executable:false,stale:true,retryAfterMs:60000}}).catch(()=>{});}if(r.kind==='trades')return route.fulfill({json:normalizeTrades(tradeTableFixture(r.address),r)});return route.fulfill({json:{version:1,request:r,observedAt:Date.now(),rows:normalizeDiscovery('geckoterminal',networkFixture(r.network)),executable:false}});});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/markets.html?view=degen&network=base');await page.waitForFunction(()=>document.querySelector('.degen-chart-state')?.textContent.includes('Retrying')).catch(async e=>{console.error(await page.locator('.degen-detail').innerText(),errors);throw e;});
  const sibling=await context.newPage();await sibling.goto(base+'/brand/mark.svg');await page.waitForTimeout(500);const before=candles;
  await page.evaluate(()=>document.querySelector('.chart-host').dataset.fixtureInstance='original');
  for(let i=0;i<4;i++){await sibling.evaluate(()=>{const s=JSON.parse(localStorage.getItem('lenz-degen-v1'));s.snapshots[0].observedAt=Date.now();localStorage.setItem('lenz-degen-v1',JSON.stringify(s));});await page.waitForTimeout(350);}
  assert.equal(candles,before,'snapshot updates must not interrupt chart backoff');assert.equal(await page.locator('.chart-host').getAttribute('data-fixture-instance'),'original');
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(base+'/markets.html?view=degen&network=solana');await other.waitForFunction(()=>document.querySelector('.degen-chart-state')?.textContent.includes('Retrying'));const both=candles;await page.waitForTimeout(2000);assert.equal(candles,both,'two pages must not bounce chart requests');
  slow=true;await page.getByRole('button',{name:'1h',exact:true}).click();await page.waitForTimeout(300);const pending=candles;
  await sibling.evaluate(()=>{const s=JSON.parse(localStorage.getItem('lenz-degen-v1'));s.snapshots[0].observedAt=Date.now();localStorage.setItem('lenz-degen-v1',JSON.stringify(s));});await page.waitForTimeout(1000);assert.equal(candles,pending);assert.match(await page.locator('.degen-chart-state').innerText(),/Retrying/);assert.deepEqual(errors,[]);
  const checks=['snapshot-only updates preserve chart instance and retry window','two visible tabs do not create storage/request loops','slow chart request survives unrelated saved-data update'];
  const retryContext=await browser.newContext({serviceWorkers:'block'}),retryPage=await retryContext.newPage();let chartReads=0,feedReads=0;
  await retryContext.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','on'));
  await retryContext.route('**/api/**',async route=>{
   if(!route.request().url().includes('/api/degen/'))return route.fulfill({status:503,json:{}});
   const r=route.request().postDataJSON();
   if(r.kind==='candles'){chartReads++;return r.interval==='5m'?route.fulfill({status:429,headers:{'Retry-After':'30'},json:{error:'waiting'}}):route.fulfill({json:{version:1,request:r,observedAt:Date.now(),candles:candleFixture(r.interval),executable:false}});}
   if(r.kind==='trades')return route.fulfill({json:normalizeTrades(tradeTableFixture(r.address),r)});
   feedReads++;return route.fulfill({json:{version:1,request:r,observedAt:Date.now()-120000,rows:normalizeDiscovery('geckoterminal',networkFixture(r.network)),executable:false,stale:true,retryAfterMs:1000}});
  });
  retryPage.on('pageerror',e=>errors.push(e.message));await retryPage.goto(base+'/markets.html?view=degen&network=base');
  await retryPage.waitForFunction(()=>document.querySelector('.degen-chart-state')?.textContent.includes('Retrying'));
  await retryPage.waitForTimeout(3200);assert(feedReads>=3,'fixture refreshes the feed during chart backoff');assert.equal(chartReads,1,'feed refresh must preserve the active chart retry window');
  await retryPage.getByRole('button',{name:'1h',exact:true}).click();await retryPage.locator('.degen-canvas .chart-host canvas').first().waitFor();assert.equal(chartReads,2,'a new interval must load immediately');
  await retryPage.waitForTimeout(1200);assert.equal(chartReads,2,'fresh charts do not refetch with the feed');assert.deepEqual(errors,[]);await retryContext.close();
  checks.push('same-page feed retries preserve chart backoff while interval changes load immediately');
  await fs.writeFile(path.join(__dirname,'degen-loading-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Disposable Edge fixtures; live provider availability is separate.'},null,2)+'\n');console.log(checks);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
