const {chooseTheme}=require('./theme-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],financial=[];
 const base=process.env.LENZ_MARKETS_TEST_BASE??'http://127.0.0.1:4173',reportDirectory=process.env.LENZ_MARKETS_TEST_OUTPUT??__dirname;
 fs.mkdirSync(path.join(reportDirectory,'evidence'),{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme:'light'}),page=await context.newPage();
  const observed=(await import('./market-testnet-fixtures.mjs')).testnetMarketReport(JSON.parse(fs.readFileSync(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8')));
  const templates=Object.fromEntries(observed.results.filter(r=>r.ok).map(r=>[r.provider,r.observation]));assert.equal(Object.keys(templates).length,7,'Live response shapes required for browser fixtures');
  const liquidityRows=Object.values(templates).flatMap(s=>s.rows).filter(r=>r.category==='liquidity'),creditRows=Object.values(templates).flatMap(s=>s.rows).filter(r=>r.category==='credit');
  let requests=[],failProvider=null,delayed=false;
  await page.route('**/api/**',route=>{if(/\/(?:quote|submit|settle|send|execute)(?:\?|$)/.test(route.request().url()))financial.push(route.request().url());return route.fulfill({status:503,json:{error:'Fixture source unavailable'}});});
  await page.route('**/api/markets/read',async route=>{
    const body=route.request().postDataJSON();requests.push(body);assert.deepEqual(Object.keys(body),body.network?['provider','network']:['provider']);
    if(delayed)await new Promise(r=>setTimeout(r,400));
    if(failProvider===body.provider){await route.fulfill({status:503,body:'unavailable'});return;}
    const snapshot=structuredClone(templates[body.provider+(body.network?':'+body.network:'')]);snapshot.observedAt=Date.now();snapshot.expiresAt=snapshot.observedAt+60000;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)});
  });
  const {tapeFixtures}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../integrations/market-tape-fixtures.mjs')));await page.route('**/api/markets/tape',r=>r.fulfill({json:tapeFixtures(r.request().postDataJSON()).snapshot}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','off'));await page.goto(base+'/markets.html?view=liquidity');
  await page.waitForFunction(()=>document.querySelector('#home-cache-status').dataset.offlineState==='ready',null,{timeout:120000});
  assert.equal(requests.length,0);assert.equal(await page.locator('.market-row').count(),0);assert.deepEqual(await page.evaluate(async()=>indexedDB.databases()),[]);
  await page.evaluate(()=>localStorage.setItem('unrelated-identity-marker','preserve'));
  checks.push('paused initial liquidity view reads no providers or wallet database; automatic shell saving reaches ready');
  delayed=true;await page.locator('#refresh-markets').click();assert(await page.locator('#refresh-markets').isDisabled());
  await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);delayed=false;
  assert.equal(requests.length,7);assert.equal(await page.locator('.market-row').count(),liquidityRows.length);
  await page.locator('#data-settings > summary').click();assert.match(await page.locator('#market-sources').innerText(),/Recently read/);
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('lenz-live-market-snapshots-v1'))).length,7);
  assert.equal(await page.locator('#save-markets').count(),0);await page.locator('#data-settings > summary').click();
  checks.push('manual refresh validates seven provider responses and saves them automatically with updates paused');
  await page.locator('#market-network').selectOption('eip155:42161');assert.equal(await page.locator('.market-row').count(),1);
  await page.locator('.market-row').press('Enter');assert.match(await page.locator('#market-detail').innerText(),/ARBITRUM/);
  await page.locator('#market-search').fill('not-a-market');assert.equal(await page.locator('.market-row').count(),0);assert.match(await page.locator('#market-status').textContent(),/No markets match/);
  await page.locator('#market-search').fill('');await page.locator('#market-network').selectOption('');
  checks.push('liquidity network/search filters and keyboard selection preserve chain identity and empty results');
  failProvider='uniswap';await page.locator('#refresh-markets').click();await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);
  assert.equal(await page.locator('.market-row').count(),liquidityRows.length);await page.locator('#data-settings > summary').click();assert.match(await page.locator('#market-sources').innerText(),/Refresh failed · earlier data retained/);await page.locator('#data-settings > summary').click();failProvider=null;
  checks.push('failed liquidity-provider refresh retains earlier rows with a visible failure label');
  for(const theme of ['light','dark']){
    await chooseTheme(page,theme);
    for(const [width,height] of [[320,740],[390,844],[844,390],[1024,768],[1360,1000]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} overflow ${width}`);}
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(reportDirectory,`evidence/markets-${theme}.png`),fullPage:true});
  }
  checks.push('liquidity controls fit phone, landscape, tablet and desktop in both themes');
  await context.setOffline(true);await page.reload();await page.waitForFunction(count=>document.querySelectorAll('.market-row').length===count,liquidityRows.length);
  await page.locator('#data-settings > summary').click();assert.match(await page.locator('#market-sources').innerText(),/Saved data/);assert.doesNotMatch(await page.locator('#market-sources').innerText(),/Recently read/);assert(await page.locator('#refresh-markets').isDisabled());
  assert(await page.evaluate(async()=>{try{await fetch('/uncached-market-probe');return false;}catch{return true;}}));assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-identity-marker')),'preserve');
  await page.locator('#forget-markets').click();assert.equal(await page.locator('.market-row').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-live-market-snapshots-v1')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-market-snapshots-v1')),null);
  checks.push('offline reload labels automatically saved rows, blocks refresh and removes market data without changing unrelated storage');
  await context.setOffline(false);await page.evaluate(()=>localStorage.setItem('lenz-live-market-snapshots-v1','{"bad":true}'));await page.reload();assert.match(await page.locator('#snapshot-status').textContent(),/could not be read/);assert.equal(await page.locator('.market-row').count(),0);
  checks.push('malformed automatically saved snapshots are rejected');
  await page.setViewportSize({width:390,height:844});
  for(const [view,action,expected]of [['credit','supply','Supply'],['credit','borrow','Borrow'],['liquidity','liquidity','Liquidity']]){
    await page.goto(base+'/markets.html?view='+view+'&action='+action);
    if(view==='credit'){await page.locator('.workspace-tools:not([hidden]) > summary').click();await page.getByRole('button',{name:'Refresh lending markets',exact:true}).click();await page.locator('.lending-market').first().waitFor();assert.equal(await page.locator('.lending-market').count(),creditRows.length);assert.equal(await page.locator('.lending-controls nav [aria-pressed=true]').innerText(),expected);}
    else{await page.locator('#refresh-markets').click();await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);}
    assert.equal(await page.locator('#market-filters [aria-pressed=true]').getAttribute('data-category'),view);
    const detail=page.locator(view==='credit'?'.lending-detail':'#market-detail');assert.equal(await detail.locator('.position-surface').getAttribute('data-action'),expected);assert.equal(await detail.locator('.position-track').count(),0);
    assert.equal(await detail.locator('input:visible').count(),0);assert.equal(await detail.locator('.position-unavailable strong').innerText(),({Supply:'Deposits unavailable',Borrow:'Borrowing unavailable',Liquidity:'Liquidity deposits unavailable'})[expected]);
    for(const theme of ['light','dark']){await chooseTheme(page,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(reportDirectory,'evidence/market-action-'+action+'-'+theme+'.png'),fullPage:true});}
    if(view==='credit'){
      const modes=page.locator('.lending-controls nav'),opposite=expected==='Supply'?'Borrow':'Supply';
      const assertAction=async name=>{assert.equal(await detail.locator('.position-surface').getAttribute('data-action'),name,'Selected lending surface must match the chosen action');assert.equal(await detail.locator('.position-actions [aria-pressed=true]').innerText(),name);assert.equal(await detail.locator('input:visible').count(),0);assert.equal(await detail.locator('.position-unavailable strong').innerText(),({Supply:'Deposits unavailable',Borrow:'Borrowing unavailable',Repay:'Repayment unavailable',Withdraw:'Withdrawals unavailable'})[name]);};
      const waitForRefresh=()=>page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled&&!document.querySelector('[aria-label="Refresh lending markets"]').disabled);
      await waitForRefresh();await modes.getByRole('button',{name:opposite,exact:true}).click();assert.equal(await modes.locator('[aria-pressed=true]').innerText(),opposite);await assertAction(opposite);
      for(const [manual,next]of [['Repay',expected],['Withdraw',opposite]]){
        await detail.getByRole('button',{name:manual,exact:true}).click();await assertAction(manual);
        await modes.locator('[aria-pressed=true]').click();await assertAction(manual);
        await page.locator('.workspace-tools:not([hidden]) > summary').click();await page.getByRole('button',{name:'Refresh lending markets',exact:true}).click();await waitForRefresh();await assertAction(manual);
        await modes.getByRole('button',{name:next,exact:true}).click();assert.equal(await modes.locator('[aria-pressed=true]').innerText(),next);await assertAction(next);
      }
    }
  }
  checks.push('Wallet Supply, Borrow and Liquidity links open the requested market action on a phone and retain unavailable execution');
  checks.push('Lending mode changes select Supply or Borrow; refresh and same-mode clicks retain Repay or Withdraw without enabling execution');
  assert.deepEqual(errors,[]);assert.deepEqual(financial,[]);assert.deepEqual(await page.evaluate(async()=>{const chat=await import('/chat-store.js'),lending=await import('/lending-position-store.js'),state=await chat.readState();return {state,positions:await lending.savedLendingPositions(state)};}),{state:{identity:null,contacts:[],messages:[]},positions:[]});assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-identity-marker')),'preserve');
  checks.push('market browsing creates no identity, position or financial request and emits no script error');
  fs.writeFileSync(path.join(reportDirectory,'markets-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),passed:checks.length,failed:0,checks,scope:'Disposable Edge profile; current app files and real offline shell reload; provider responses use recorded live shapes. No live provider read, wallet, signature, funding or financial submission.'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
