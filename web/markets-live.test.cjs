const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage(),errors=[],requests=[],observations=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));
  await page.goto('http://127.0.0.1:4173/markets.html');
  await page.waitForFunction(()=>document.querySelector('#home-cache-status').textContent.startsWith('Page available offline'));
  assert.equal(requests.filter(r=>r.method==='POST').length,0);
  const responses=Promise.all(['uniswap','aave','hyperliquid'].map(provider=>page.waitForResponse(r=>r.url().endsWith('/api/markets/read')&&r.request().postDataJSON()?.provider===provider,{timeout:60000})));
  await page.locator('#refresh-markets').click();
  for(const response of await responses){assert.equal(response.status(),200,await response.text());const s=await response.json();assert.equal(s.executable,false);assert.equal(s.kind,'market-observation');assert(s.rows.length>0);observations.push({provider:s.provider,rows:s.rows.length,observedAt:s.observedAt,blockNumber:s.evidence.blockNumber??null,blockTimestamp:s.evidence.blockTimestamp??null});}
  await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled,{timeout:60000});
  assert.equal(await page.locator('.market-row').count(),observations.reduce((n,s)=>n+s.rows,0));
  assert(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:4173'));
  assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>JSON.parse(r.body)).sort((a,b)=>a.provider.localeCompare(b.provider)),['aave','hyperliquid','uniswap'].map(provider=>({provider})));
  assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-market-snapshots-v1')),null);
  assert.deepEqual(await page.evaluate(async()=>({storage:Object.keys(localStorage),databases:(await indexedDB.databases()).map(x=>x.name)})),{storage:[],databases:[]});
  assert.deepEqual(errors,[]);
  await page.locator('[data-category="perpetuals"]').click();await page.locator('#market-search').fill('ETH');
  await page.screenshot({path:path.join(__dirname,'evidence/markets-live.png'),fullPage:true});
  const report={checkedAt:new Date().toISOString(),browser:await browser.version(),passed:4,failed:0,checks:['Opening the page performs no market reads','Explicit load reaches all three public providers through the local API','All returned rows display without page errors','No wallet/database access, automatic saved snapshot or extra POST'],observations,scope:'Disposable Edge profile; real public mainnet reads only, no mocks, addresses, credentials, signing or financial operations'};
  fs.writeFileSync(path.join(__dirname,'markets-live-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
