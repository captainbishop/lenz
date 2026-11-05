const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
(async()=>{
 const files=['web/public/form-controls.js','web/public/markets.js','web/public/markets.html','web/public/oracle-prices-ui.js','web/public/market-picker.js','web/public/degen-chart.js','web/public/chart-indicators.js','web/public/chart-vendor/lightweight-charts.js','web/market-navigation-browser.test.cjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',f))).digest('hex')]))),sources=await hashes();
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],financial=[];
 const templates=JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8')).results;
 const {tapeFixtures}=await import('../integrations/market-tape-fixtures.mjs');
 try{for(const width of [1280,680,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(snapshots=>{
   localStorage.setItem('lenz-market-live-mode','off');localStorage.setItem('lenz-market-snapshots-v1',JSON.stringify(snapshots));
   window.navigationLoops=[];const Native=MutationObserver;
   // Stop only a runaway callback so the regression fails instead of hanging the test browser.
   window.MutationObserver=class extends Native{constructor(callback){let rounds=0,reset=false;super((records,observer)=>{
    if(!reset){reset=true;setTimeout(()=>{rounds=0;reset=false;},0);}
    if(++rounds>60){window.navigationLoops.push(records.map(r=>({type:r.type,target:r.target.id||r.target.className,attribute:r.attributeName})));observer.disconnect();return;}
    callback(records,observer);
   });}};
  },templates.map(t=>t.observation));
  await page.route('**/api/**',route=>{const url=route.request().url();if(url.endsWith('/tape'))return route.fulfill({json:tapeFixtures(route.request().postDataJSON()).snapshot});if(url.endsWith('/quote')||/settle|submit|send/.test(url))financial.push(url);return route.fulfill({status:503,json:{error:'Fixture source unavailable'}});});
  await page.goto('http://127.0.0.1:4173/markets.html');
  for(let round=0;round<3;round++)for(const category of ['prices','perpetuals','liquidity','credit','all']){
   await page.locator('#market-filters [data-category="'+category+'"]').click();
   const state=await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>resolve({loops:window.navigationLoops,prices:!document.querySelector('#oracle-prices').hidden,hidden:document.querySelector('#market-network').closest('.lenz-choice').hidden}),0)));
   assert.deepEqual(state.loops,[],'Category navigation must yield without a repeating form observer');assert.equal(state.prices,category==='prices');assert.equal(state.hidden,category==='prices');
   assert.equal(await page.locator('#market-filters [data-category="'+category+'"]').getAttribute('aria-pressed'),'true');
   if(category==='perpetuals')await page.locator('#candle-chart .chart-host canvas').first().waitFor();
  }
  checks.push('Repeated Prices, Perpetuals, Liquidity, Credit and All markets navigation stays responsive at '+width+'px with unavailable price feeds');console.log('PASS '+checks.at(-1));
  await page.evaluate(()=>{const select=document.querySelector('#market-network');select.hidden=true;select.disabled=true;});
  await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
  assert.deepEqual(await page.evaluate(()=>window.navigationLoops),[]);
  await page.evaluate(()=>{const select=document.querySelector('#market-network');select.hidden=false;select.disabled=false;});
  if(width<=760)await page.locator('#data-settings summary').first().click();
  const network=page.locator('#market-network-control');await network.click();assert.equal(await network.getAttribute('aria-expanded'),'true');await network.press('Escape');
  checks.push('Hidden and disabled network controls restore without loops at '+width+'px');console.log('PASS '+checks.at(-1));await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(financial,[]);assert.deepEqual(await hashes(),sources,'Sources changed during verification');
 await fs.writeFile(path.join(__dirname,'market-navigation-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,checks,sources,scope:'Disposable Edge, saved fixture markets, failed price feeds, real event-loop yields and repeated category changes. Runaway-observer tripwire fails assertions. No user storage changes or financial requests.'},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
