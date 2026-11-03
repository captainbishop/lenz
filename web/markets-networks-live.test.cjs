const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),checks=[],errors=[],observations=new Map(),requests=[];
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push({url:r.url(),body:r.postDataJSON()});});
  page.on('response',async r=>{if(r.url().endsWith('/api/markets/read')&&r.ok()){const s=await r.json();observations.set(s.provider+':'+s.chainId,s);}});
  await page.goto('http://127.0.0.1:4173/markets.html');
  await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('lenz-live-market-snapshots-v1')??'[]');return s.length===7;},{},{timeout:90000});
  assert.equal(observations.size,7);assert.equal(await page.locator('.market-row').count(),[...observations.values()].reduce((n,s)=>n+s.rows.length,0));
  for(const chainId of ['eip155:1','eip155:42161','eip155:8453'])for(const provider of ['uniswap','aave']){const s=observations.get(provider+':'+chainId);assert(s);assert.equal(s.executable,false);assert(s.rows.every(r=>r.chainId===chainId));}
  pass('all seven sources return live observations; three EVM networks keep distinct rows');
  for(const [id,name]of [['eip155:1','Ethereum'],['eip155:42161','Arbitrum'],['eip155:8453','Base']]){
   await page.locator('#market-network').selectOption(id);assert.equal(await page.locator('.market-row').count(),3);assert((await page.locator('.market-row').allTextContents()).every(text=>text.includes(name)));
  }
  await page.locator('#market-network').selectOption('eip155:1');assert.equal(await page.locator('#quote-amount').count(),0);assert((await page.locator('#market-detail').innerText()).includes('Quotes not connected'));
  await page.locator('[data-category=credit]').click();assert((await page.locator('.credit-heading').innerText()).includes('ETHEREUM'));
  pass('network filtering labels pools and credit correctly and exposes no unsupported quote form');
  await page.locator('[data-category=all]').click();await page.locator('#market-network').selectOption('eip155:8453');await page.locator('#quote-amount').fill('1');
  await page.waitForFunction(()=>document.querySelector('#quote-receive').textContent!=='—',{},{timeout:60000});assert.equal(await page.locator('#quote-public').isChecked(),false);
  pass('the reviewed Base calculator still responds without amount-sharing consent');
  await page.locator('#market-network').selectOption('eip155:42161');
  for(const theme of ['light','dark'])for(const[width,height]of [[1440,1000],[390,844]]){
   await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(__dirname,'evidence/markets-networks-'+theme+'-'+width+'.png'),fullPage:true});
  }
  pass('live multichain views fit desktop and phone in both themes');
  await page.waitForFunction(()=>document.querySelector('#home-cache-status').textContent.startsWith('Page available offline'));
  await context.setOffline(true);await page.reload();await page.locator('#market-network').selectOption('eip155:42161');await page.waitForFunction(()=>document.querySelectorAll('.market-row').length===3);assert((await page.locator('.market-row').allTextContents()).every(t=>t.includes('Arbitrum')&&t.includes('Saved data')));
  assert.equal(await page.locator('#quote-amount').count(),0);pass('offline reload retains network identity and saved-data labels');
  assert(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:4173'&&!('address'in r.body)&&!('recipient'in r.body)&&!('amount'in r.body)));
  assert.deepEqual(await page.evaluate(async()=>await indexedDB.databases()),[]);assert.deepEqual(errors,[]);pass('market reads create no wallet database or financial request');
  await fs.writeFile(path.join(__dirname,'markets-networks-live-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,observations:[...observations.values()].map(s=>({provider:s.provider,chainId:s.chainId,rows:s.rows.length,block:s.evidence.blockNumber})),scope:'Actual public reads in a disposable Windows Edge profile; no wallet, signing, financial action or execution. New Ethereum/Arbitrum pools provide discovery only; quote execution remains unconnected.'},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
