const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const {normalizePredictions}=await import('./public/prediction-model.js');
 const {createMarketRoute}=await import('./market-relay.mjs'),{createHyperliquidCatalogReader}=await import('../integrations/hyperliquid-catalog.mjs'),{hyperliquidFixtureFetcher}=await import('../integrations/hyperliquid-fixtures.mjs');
 const catalog=createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher});let failing=false,calls=0,contextCalls=0;
 const poly=()=>Array.from({length:7},(_,i)=>({id:String(i),slug:'event-'+i,title:i===0?'Will Bitcoin reach a new high this year?':'Election outcome '+i,active:true,closed:false,tags:[{label:i===0?'Crypto':'Politics'}],image:i===0?"https://images.polymarket.com/event.png":i===6?"https://images.polymarket.com/missing.png":null,volume24hr:100000*(i+1),endDate:'2027-01-01',markets:[{id:'m'+i,question:i===1?'<img src=x onerror=alert(1)>':'Will this happen?',active:true,closed:false,acceptingOrders:true,outcomes:'["Yes","No"]',outcomePrices:'["0.62","0.38"]',description:'Settles using the named source.'}]}));
 const route=createMarketRoute({catalog,predictions:async p=>{calls++;if(failing&&p==='polymarket')throw Error();return normalizePredictions(p,p==='polymarket'?poly():p==='hyperliquid'?await catalog():{events:[{event_ticker:'EVENT',title:'Will inflation fall next month?',category:'Economics',markets:[{ticker:'M',status:'active',title:'Will inflation fall?',yes_bid_dollars:'0.20',yes_ask_dollars:'0.24',notional_value_dollars:'1',volume_24h_fp:'12000',rules_primary:'Official monthly release.'}]}]});},marketContext:async()=>({version:1,provider:'coinmarketcap',observedAt:Date.now(),marketCap:2500000000000,volume24h:31000000000,btcDominance:60}),discover:async()=>{throw Error();}});
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{try{
  if(req.url.startsWith('/api/markets/prediction-image?')){if(req.url.includes('missing.png')){res.writeHead(404);res.end();}else{res.setHeader('content-type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=','base64'));}return;}
  if(req.url.startsWith('/api/')){if(req.url==='/api/markets/context')contextCalls++;req.headers.host='127.0.0.1:4173';req.headers.origin='http://127.0.0.1:4173';if(await route(req,res))return;throw Error();}
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
 try{for(const width of [1360,390,320]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.goto(base+'/markets.html?view=predictions');await page.locator('.prediction-card').first().waitFor();await page.waitForFunction(()=>document.querySelector('.prediction-coverage h3').textContent==='9 events');
  assert.equal(await page.locator('#prediction-workspace').isVisible(),true);assert.equal(await page.locator('#hyperliquid-workspace').isVisible(),false);
  await page.getByRole('searchbox',{name:'Search events',exact:true}).fill('Bitcoin');assert.equal(await page.locator('.prediction-card').count(),1);await page.locator('.prediction-card').click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('link',{name:'View on Polymarket'}).getAttribute('href'),'https://polymarket.com/event/event-0');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('[data-event-id="polymarket:0"] .prediction-art').classList.contains('has-image'));
  assert.equal(await page.locator('[data-event-id="polymarket:0"] .prediction-art img').last().evaluate(img=>img.naturalWidth>0),true);
  await page.getByRole('searchbox',{name:'Search events',exact:true}).fill('');await page.locator('[data-event-id="polymarket:1"]').click();assert.equal(await page.locator('.prediction-dialog img[src=x]').count(),0);assert.match(await page.locator('.prediction-detail-markets').textContent(),/<img/);await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-event-id="polymarket:6"] .prediction-art.has-image').count(),0);
  await page.locator('.prediction-categories').getByRole('button',{name:'Economy',exact:true}).click();assert.equal(await page.locator('.prediction-card').count(),1);assert.match(await page.locator('.prediction-card').textContent(),/12K contracts/);await page.locator('.prediction-categories').getByRole('button',{name:'All events',exact:true}).click();
  for(const theme of ['light','dim','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(os.tmpdir(),`lenz-predictions-${width}-${theme}.png`),fullPage:true});}
  await page.getByRole('button',{name:'Save events offline',exact:true}).click();await context.setOffline(true);await page.waitForTimeout(100);assert.match(await page.locator('.prediction-status').first().textContent(),/Offline/);assert.equal(await page.locator('.prediction-card').count(),9);await context.setOffline(false);
  await page.getByText('Data settings',{exact:true}).click();await page.locator('#market-live').uncheck();await page.getByText('Data settings',{exact:true}).click();
  failing=true;await page.getByRole('button',{name:'Refresh events',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.prediction-status').textContent.includes('Some sources'));assert.equal(await page.locator('.prediction-card').count(),9);assert.match(await page.locator('[data-event-id="polymarket:0"]').textContent(),/Saved/);failing=false;
  await page.locator('[data-category="all"]').click();await page.getByRole('heading',{name:'Market pulse',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.market-context').textContent.includes('$2.5T'));checks.push(`${width}px: cards, event details, filters, safe text, themes, offline, partial failure and CMC context`);await context.close();
 }
 const regressions=[];
 async function regression(name,run){const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(4000);try{await run(page,context);checks.push(name);}catch(error){regressions.push(name+': '+error.message);}finally{await context.close();}}
 await regression('Spot order controls survive Predictions navigation',async page=>{
  await page.goto(base+'/markets.html?view=spot');await page.locator('#hyperliquid-workspace .hyper-action').waitFor();
  await page.locator('[data-category="predictions"]').click();await page.locator('.prediction-card').first().waitFor();
  await page.locator('[data-category="spot"]').click();assert.equal(await page.locator('#hyperliquid-workspace .hyper-action').count(),1);
 });
 await regression('Saved Hyperliquid event details remain accessible offline without a separately saved catalogue',async(page,context)=>{
  await page.goto(base+'/markets.html?view=predictions');await page.locator('[data-event-id="hyperliquid:outcome:12"]').waitFor();
  await page.getByRole('button',{name:'Save events offline',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2')),null);
  await context.setOffline(true);await page.locator('[data-event-id="hyperliquid:outcome:12"]').click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('.prediction-detail-markets').textContent(),/60%/);
 });
 await regression('Overview refresh includes CoinMarketCap',async page=>{
  await page.goto(base+'/markets.html');await page.waitForFunction(()=>document.querySelector('.market-context').textContent.includes('$2.5T'));const before=contextCalls;
  await page.getByRole('button',{name:'Refresh overview',exact:true}).click();await page.waitForTimeout(250);assert.equal(contextCalls,before+1);
 });
 await regression('Sanitized Polymarket links remain on the correct provider',async page=>{
  const snapshot=normalizePredictions('polymarket',poly());snapshot.events[0].url=null;
  await page.addInitScript(s=>localStorage.setItem('lenz-prediction-snapshots-v1',JSON.stringify([s])),snapshot);
  await page.goto(base+'/markets.html?view=predictions');await page.locator('[data-event-id="polymarket:0"]').click();assert.equal(await page.locator('.prediction-detail-actions a').getAttribute('href'),'https://polymarket.com');
 });
 await regression('An open event reports an offline transition',async(page,context)=>{
  await page.goto(base+'/markets.html?view=predictions');await page.locator('[data-event-id="polymarket:0"]').click();await context.setOffline(true);await page.waitForTimeout(100);assert.match(await page.locator('.prediction-dialog .prediction-card-source').textContent(),/Saved/);
 });
 await regression('Overview can save a CMC snapshot when every other provider is unavailable',async page=>{
  await page.route('**/api/**',r=>r.request().url().endsWith('/context')?r.continue():r.fulfill({status:503,body:'{}'}));
  await page.goto(base+'/markets.html');await page.waitForFunction(()=>document.querySelector('.market-context').textContent.includes('$2.5T'));
  const save=page.getByRole('button',{name:'Save overview offline',exact:true});assert.equal(await save.isEnabled(),true);await save.click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lenz-market-context-v1')).marketCap),2500000000000);
 });
 await regression('Saved Hyperliquid details remain accessible when its native catalogue fails online',async page=>{
  await page.route('**/api/markets/hyper-catalog',r=>r.fulfill({status:503,body:'{}'}));
  await page.goto(base+'/markets.html?view=predictions');await page.locator('[data-event-id="hyperliquid:outcome:12"]').click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('.prediction-detail-markets').textContent(),/60%/);
 });
 assert.deepEqual(regressions,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,calls},null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
