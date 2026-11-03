const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme:'light'}),page=await context.newPage();
  const observed=JSON.parse(fs.readFileSync(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8'));
  const templates=Object.fromEntries(observed.results.filter(r=>r.ok).map(r=>[r.provider,r.observation]));assert.equal(Object.keys(templates).length,3,'Live response shapes required for browser fixtures');
  let requests=[],failProvider=null,delayed=false;
  await page.route('**/api/markets/read',async route=>{
    const request=route.request(),body=request.postDataJSON();requests.push(body);assert.deepEqual(Object.keys(body),['provider']);
    if(delayed)await new Promise(r=>setTimeout(r,400));
    if(failProvider===body.provider){await route.fulfill({status:503,body:'unavailable'});return;}
    const snapshot=structuredClone(templates[body.provider]);snapshot.observedAt=Date.now();snapshot.expiresAt=snapshot.observedAt+60000;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)});
  });
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/markets.html');
  await page.waitForFunction(()=>document.querySelector('#home-cache-status').textContent.startsWith('Page available offline'));
  assert.equal(requests.length,0);assert.equal(await page.locator('.market-row').count(),0);
  await page.evaluate(()=>localStorage.setItem('unrelated-identity-marker','preserve'));
  checks.push('initial view performs no provider reads or account access; shell cache is checked');
  delayed=true;await page.locator('#refresh-markets').click();assert(await page.locator('#refresh-markets').isDisabled());
  await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);delayed=false;
  assert.equal(requests.length,3);assert.equal(await page.locator('.market-row').count(),8);
  assert((await page.locator('#market-sources').innerText()).includes('Recently read'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-market-snapshots-v1')),null);
  checks.push('explicit load sends only provider IDs, displays validated markets, and does not save snapshots automatically');
  await page.locator('[data-category="perpetuals"]').click();await page.locator('#market-search').fill('ETH');
  assert.equal(await page.locator('.market-row').count(),1);await page.locator('.market-row').press('Enter');assert((await page.locator('#market-detail').innerText()).includes('ETH perpetual'));
  await page.locator('#market-search').fill('not-a-market');assert.equal(await page.locator('.market-row').count(),0);assert((await page.locator('#market-status').textContent()).includes('No markets match'));
  await page.locator('#market-search').fill('');await page.locator('[data-category="all"]').click();
  checks.push('category/search filters, keyboard selection and empty results work without trading controls');
  failProvider='aave';await page.locator('#refresh-markets').click();await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);
  assert.equal(await page.locator('.market-row').count(),8);assert((await page.locator('#market-sources').innerText()).includes('Refresh failed · earlier data retained'));failProvider=null;
  checks.push('a failed provider refresh preserves earlier rows with a visible failure label');
  await page.locator('#save-markets').click();assert((await page.locator('#snapshot-status').textContent()).includes('Saved 3'));
  for(const theme of ['light','dark']){
    if(theme==='dark')await page.getByRole('button',{name:'Switch to dark theme'}).click();
    for(const [width,height] of [[320,740],[390,844],[844,390],[1024,768],[1360,1000]]){
      await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} overflow ${width}`);
    }
    await page.locator('[data-category="perpetuals"]').click();await page.locator('#market-search').fill('ETH');await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,`evidence/markets-${theme}.png`),fullPage:true});
    await page.locator('#market-search').fill('');await page.locator('[data-category="all"]').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('[data-category="credit"]').click();await page.screenshot({path:path.join(__dirname,'evidence/markets-phone.png'),fullPage:true});
  checks.push('both themes fit phone, landscape, tablet and desktop; saved snapshots require explicit action');
  await context.setOffline(true);await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.market-row').length===8);
  assert((await page.locator('#market-sources').innerText()).includes('Saved data'));assert(!(await page.locator('#market-sources').innerText()).includes('Recently read'));assert(await page.locator('#refresh-markets').isDisabled());
  assert(await page.evaluate(async()=>{try{await fetch('/uncached-market-probe');return false;}catch{return true;}}));
  assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-identity-marker')),'preserve');
  await page.locator('#forget-markets').click();assert.equal(await page.locator('.market-row').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-market-snapshots-v1')),null);
  checks.push('offline reload labels cached data as saved, blocks refresh and preserves unrelated identity storage');
  await context.setOffline(false);await page.reload();await page.evaluate(()=>localStorage.setItem('lenz-market-snapshots-v1','{"bad":true}'));await page.reload();assert((await page.locator('#snapshot-status').textContent()).includes('could not be read'));assert.equal(await page.locator('.market-row').count(),0);
  assert.deepEqual(errors,[]);checks.push('malformed saved snapshots are rejected without script errors');
  fs.writeFileSync(path.join(__dirname,'markets-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),passed:checks.length,failed:0,checks,scope:'Disposable Edge profiles; provider responses are fixtures shaped from the separate live read'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
