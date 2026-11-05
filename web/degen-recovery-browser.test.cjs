const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.LENZ_DEGEN_TEST_BASE??'http://127.0.0.1:4173';
(async()=>{
 const {normalizeDiscovery,normalizeTrades}=await import('../integrations/degen-discovery.mjs'),{networkFixture,candleFixture,tradeTableFixture}=await import('../integrations/degen-fixtures.mjs');
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let candles=0,trades=0;const errors=[];
 try{
  await context.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','on'));
  await context.route('**/api/**',async route=>{
   if(!route.request().url().includes('/api/degen/'))return route.fulfill({status:503,json:{}});
   const r=route.request().postDataJSON();
   if(r.kind==='candles'){
    candles++;if(candles===1)return route.abort('failed');
    if(candles===2)return route.fulfill({status:502,headers:{'Retry-After':'1'},json:{error:'temporary'}});
    return route.fulfill({json:{version:1,request:r,observedAt:Date.now(),candles:candleFixture(r.interval),executable:false}});
   }
   if(r.kind==='trades'){
    trades++;const now=Date.now()-(trades===1?3600000:0),value=normalizeTrades(tradeTableFixture(r.address,now),r,now);
    return route.fulfill({json:trades===1?{...value,stale:true,retryAfterMs:2000}:value});
   }
   return route.fulfill({json:{version:1,request:r,observedAt:Date.now(),rows:normalizeDiscovery('geckoterminal',networkFixture(r.network)),executable:false}});
  });
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/markets.html?view=degen&network=base');
  await page.waitForFunction(()=>document.querySelector('.degen-chart-state')?.textContent.includes('Retrying'),null,{timeout:4000});
  await page.waitForFunction(()=>document.querySelector('.degen-trades-head span')?.textContent.includes('Saved'));
  assert(await page.locator('[data-trade]').count()>0,'saved trades remain visible during throttling');
  await page.waitForFunction(()=>document.querySelector('.degen-trades-head span')?.textContent.startsWith('Updated'));
  await page.locator('.degen-canvas .chart-host canvas').first().waitFor({timeout:25000});assert.equal(candles,3);assert.deepEqual(errors,[]);
  const checks=['a failed network request and then a 502 automatically recover the chart','saved trade responses remain visible with their original timestamp and refresh after backoff'];
  await fs.writeFile(path.join(__dirname,'degen-recovery-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Disposable Edge, public API fixtures; no financial requests.'},null,2)+'\n');console.log(checks);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
