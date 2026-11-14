const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.svg':'image/svg+xml','.css':'text/css'})[path.extname(file)]??'text/html');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/fixture.html',r=>r.fulfill({contentType:'text/html',body:'<main id="test"></main>'}));let release;const gate=new Promise(r=>release=r);const now=Date.now();
  await page.route('**/api/markets/assets',async r=>{await gate;await r.fulfill({json:{version:1,provider:'coingecko',observedAt:now,assets:[{key:'BTC',id:'bitcoin',name:'Bitcoin',price:100,change:2,change7d:-4,marketCap:2000,volume:20,supply:20,history:Array.from({length:168},(_,i)=>100+i/10),updatedAt:now}]}});});
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture.html');
  await page.evaluate(async()=>{const {assetPriceCard}=await import('/asset-price-card.js');const card=assetPriceCard({name:'BTC',price:100,quote:'USDC',referenceKey:'BTC',metrics:true});document.querySelector('#test').append(card.element);window.priceCard=card;});

  await page.evaluate(()=>window.priceCard.update({price:200,change:3}));release();await page.getByText('-4.00% · 7d',{exact:true}).waitFor();
  assert.equal(await page.locator('.asset-price-value').textContent(),'200 USDC');assert.equal(await page.locator('.asset-price-source').textContent(),'');
  await page.evaluate(async()=>{const {assetIcon}=await import('/asset-icon.js');for(const symbol of ['NEAR','HYPE']){const icon=assetIcon({symbol,trusted:true});icon.dataset.testSymbol=symbol;document.querySelector('#test').append(icon);}const unknown=assetIcon({symbol:'HYPE',contract:'0x'+'99'.repeat(20),network:'eip155:1'});unknown.id='unknown-hype';document.querySelector('#test').append(unknown);});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-test-symbol] img')].length===2&&[...document.querySelectorAll('[data-test-symbol] img')].every(n=>n.complete&&n.naturalWidth>0));assert.equal(await page.locator('#unknown-hype img').count(),0);
  await page.evaluate(async()=>{const {workspaceHeading}=await import('/workspace-heading.js');window.metricFixture=workspaceHeading({title:'Markets'});document.querySelector('#test').append(metricFixture.element);metricFixture.setMetrics([{label:'Volume',value:'$100',raw:100}],'','one');metricFixture.setMetrics([{label:'Volume',value:'$120',raw:120}],'','one');});
  assert.equal(await page.locator('.lenz-metric-trend.is-up svg').count(),1);assert.equal(await page.locator('.lenz-metric-trend').textContent(),'');
  await page.evaluate(()=>metricFixture.setMetrics([{label:'Volume',value:'$90',raw:90}],'','one'));assert.equal(await page.locator('.lenz-metric-trend.is-down').count(),1);
  await page.evaluate(()=>metricFixture.setMetrics([{label:'Volume',value:'$900',raw:900}],'','another-filter'));assert.equal(await page.locator('.lenz-metric-trend.is-up,.lenz-metric-trend.is-down').count(),0);
  await page.evaluate(()=>metricFixture.setMetrics([{label:'Volume',value:'—',raw:null}],'','another-filter'));assert.equal(await page.locator('.lenz-metric-trend.is-up,.lenz-metric-trend.is-down').count(),0);
  await context.setOffline(true);await page.getByText(/Saved · Updated/).waitFor();assert.equal(await page.locator('.asset-price-value').textContent(),'200 USDC');
  assert.deepEqual(errors,[]);console.log('6 checks passed: trusted NEAR/HYPE logos load while unknown contracts keep their fallback; chart-shaped trends follow numeric readings; filters and unknown readings reset trends; late enrichment preserves current price; 7d percentage is visible without a current-price timestamp; offline data is marked saved.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
