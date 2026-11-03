const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),quotes=[],requests=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto('http://127.0.0.1:4173/markets.html');await page.waitForFunction(()=>document.querySelector('#home-cache-status').textContent.startsWith('Page available offline'));assert.equal(requests.filter(r=>r.method==='POST').length,0);
  await page.locator('#refresh-markets').click();await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled&&document.querySelectorAll('.market-row').length>3,null,{timeout:60000});
  async function estimate(amount,provider){
   assert.equal(await page.locator('#quote-public').isChecked(),false);await page.locator('#quote-amount').fill(amount);await page.locator('#quote-public').check();
   const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/markets/quote'),{timeout:60000});await page.locator('#quote-submit').click();const response=await responsePromise;assert.equal(response.status(),200,await response.text());const q=await response.json();
   assert.equal(q.request.provider,provider);assert.equal(q.request.amount,amount);assert.equal(q.executable,false);assert(q.expiresAt>Date.now());await page.waitForFunction(()=>document.querySelector('#quote-result').textContent.length>0);quotes.push(q);
  }
  await page.locator('[data-market-id="uniswap:0xd0b53d9277642d899df5c87a3966a349a798f224"]').click();
  await estimate('1','uniswap');assert((await page.locator('#quote-result').innerText()).includes('Minimum'));
  await page.locator('[data-category="perpetuals"]').click();await page.locator('#market-search').fill('ETH');await page.locator('.market-row').filter({has:page.locator('strong',{hasText:/^ETH perpetual$/})}).click();await estimate('0.01','hyperliquid');assert((await page.locator('#quote-result').innerText()).includes('Estimated cost'));
  await page.screenshot({path:path.join(__dirname,'evidence/market-quote-live.png'),fullPage:true});
  assert(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:4173'));assert.equal(requests.filter(r=>r.method==='POST').length,5);assert(requests.filter(r=>r.method==='POST').every(r=>/\/api\/markets\/(read|quote)$/.test(r.url)));assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(async()=>({storage:Object.keys(localStorage),databases:(await indexedDB.databases()).map(d=>d.name)})),{storage:[],databases:[]});
  const report={checkedAt:new Date().toISOString(),browser:await browser.version(),passed:4,failed:0,checks:['No request on opening; explicit market load','Uniswap quote reaches Base and displays minimum output','Hyperliquid estimate reaches the venue and displays book cost','Only five market POSTs; no wallet state, saved quote or financial submission'],quotes,scope:'Disposable Edge, real local API and public provider reads; no mocks, wallet, signing or transaction'};
  fs.writeFileSync(path.join(__dirname,'market-quote-live-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,quotes:quotes.map(q=>({provider:q.request.provider,sourceTime:q.sourceTime,result:q.result}))},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
