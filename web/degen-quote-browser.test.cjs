const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const {normalizeDiscovery,normalizeTrades}=await import('../integrations/degen-discovery.mjs'),{networkFixture,candleFixture,tradeTableFixture}=await import('../integrations/degen-fixtures.mjs');
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],screens=path.join(os.tmpdir(),'lenz-degen-quotes');await fs.mkdir(screens,{recursive:true});
 try{for(const width of [320,1360,390]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),quoteRequests=[];let failPair=false,changed=false,release=null,outputUnits='42000000000000000000';
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('lenz-market-live-mode','on');const original=fetch;window.fetch=(url,options)=>original(url,String(url).includes('/api/degen/quote')?{...options,signal:undefined}:options);});
  await page.route('**/api/**',async route=>{
   const url=route.request().url(),r=route.request().postDataJSON();
   if(url.endsWith('/api/degen/quote')){
    quoteRequests.push(r);if(failPair)return route.fulfill({status:502,json:{error:'unavailable'}});
    const assets=[{id:r.token,symbol:'DGN',decimals:18},{id:'0x4200000000000000000000000000000000000006',symbol:'WETH',decimals:18}],now=Date.now();
    const data={version:1,kind:r.kind==='pool'?'degen-pair':'degen-quote',request:r,assets,feePips:3000,observedAt:now,expiresAt:now+30000,evidence:{source:'https://mainnet.base.org',blockNumber:'1234',blockHash:'0x'+'ab'.repeat(32),blockTimestamp:now-1000},executable:false};
    if(r.kind==='quote'){
     if(changed)assets[0]={...assets[0],symbol:'CHANGED'};
     const input=assets[r.side==='buy'?1:0],output=assets[r.side==='buy'?0:1],{decimalUnits}=await import('./public/market-quote.js');Object.assign(data,{input,output,inputUnits:decimalUnits(r.amount,input.decimals).toString(),outputUnits,minOutputUnits:(BigInt(outputUnits)*BigInt(10000-r.slippageBps)/10000n).toString(),gasUnits:'120000'});
     if(release===true)await new Promise(resolve=>release=resolve);
    }
    return route.fulfill({json:data}).catch(()=>{});
   }
   if(!url.includes('/api/degen/read'))return route.fulfill({status:503,json:{error:'fixture'}});
   const rows=normalizeDiscovery('geckoterminal',networkFixture(r.network??'base'));
   return route.fulfill({json:r.kind==='candles'?{version:1,request:r,observedAt:Date.now(),candles:candleFixture(r.interval),executable:false}:r.kind==='trades'?normalizeTrades(tradeTableFixture(r.address),r):{version:1,request:r,observedAt:Date.now(),rows,hasMore:false,executable:false}}).catch(()=>{});
  });
  await page.goto('http://127.0.0.1:4173/markets.html?view=degen');await page.getByRole('button',{name:'Quote swap',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Degen swap quote'});
  assert.equal(quoteRequests.length,0);failPair=true;await dialog.getByRole('checkbox').check();await dialog.getByText('Quote unavailable. Check the pool or try again.',{exact:true}).waitFor();failPair=false;await dialog.getByRole('button',{name:'Check pair',exact:true}).click();await dialog.getByRole('textbox',{name:'Amount to pay'}).waitFor();checks.push('Consent precedes reads and pair errors can retry at '+width+'px');
  await dialog.getByRole('textbox',{name:'Amount to pay'}).fill('0.25');await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await dialog.getByText('41.79 DGN',{exact:true}).waitFor();assert.equal(quoteRequests.at(-1).side,'buy');assert.equal(await dialog.getByLabel('Estimated amount received').innerText(),'42');assert.equal(await dialog.locator('a').count(),0);checks.push('Exact counter-asset buy quote and minimum stay inside Lenz at '+width+'px');
  for(const [units,display]of [['999999999999000000000000000000','999999999999'],['11234567890123','≈ 0.0000112346']]){outputUnits=units;await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await dialog.getByText(display,{exact:true}).waitFor();assert(await dialog.getByLabel('Estimated amount received').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'small or large amount overflows at '+width);}
  outputUnits='2567888960844013356821';await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await dialog.getByText('≈ 2,555.05 DGN',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Estimated amount received').innerText(),'≈ 2,567.89');assert.equal(await dialog.getByLabel('Estimated amount received').getAttribute('title'),'2567.888960844013356821 DGN');
  await dialog.getByText('Quote details',{exact:true}).click();await dialog.getByText('Exact minimum · 2555.049516039793290036 DGN',{exact:true}).waitFor();await dialog.getByText('Quote details',{exact:true}).click();checks.push('Long quote amounts stay compact with exact amounts available at '+width+'px');
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert(await dialog.getByLabel('Estimated amount received').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.clientHeight<60));await page.screenshot({path:path.join(screens,theme+'-'+width+'.png'),animations:'disabled'});}
  outputUnits='42000000000000000000';
  await page.clock.install();await page.clock.fastForward(31000);await dialog.getByText('Quote expired. Check again.',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Estimated amount received').innerText(),'\u2014');await page.clock.setSystemTime(Date.now());checks.push('Expired quotes clear their displayed output at '+width+'px');
  await dialog.getByRole('button',{name:'Sell',exact:true}).click();assert.equal(await dialog.getByLabel('Estimated amount received').innerText(),'—');await dialog.getByRole('textbox',{name:'Amount to pay'}).fill('2');await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await dialog.getByText('41.79 WETH',{exact:true}).waitFor();assert.equal(quoteRequests.at(-1).side,'sell');checks.push('Direction changes clear the amount and require a new quote at '+width+'px');
  release=true;await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.degen-quote-status').textContent==='Checking price…');await dialog.getByRole('textbox',{name:'Amount to pay'}).fill('3');while(typeof release!=='function')await new Promise(r=>setTimeout(r,10));release();release=null;await page.waitForTimeout(150);assert.equal(await dialog.getByLabel('Estimated amount received').innerText(),'—');checks.push('Late responses cannot restore an edited quote even when abort is ignored at '+width+'px');
  changed=true;await dialog.getByRole('button',{name:'Get quote',exact:true}).click();await dialog.getByText('Pool details changed. Check the pair again.',{exact:true}).waitFor();assert(await dialog.locator('form').isHidden());changed=false;await dialog.getByRole('button',{name:'Check pair',exact:true}).click();await dialog.getByRole('textbox',{name:'Amount to pay'}).waitFor();checks.push('Changed on-chain token details require another pair check at '+width+'px');
  await context.setOffline(true);await dialog.getByText('Connect for a new quote.',{exact:true}).waitFor();assert(!(await dialog.getByRole('button',{name:'Get quote',exact:true}).isEnabled()));await context.setOffline(false);await dialog.getByRole('button',{name:'Close swap quote',exact:true}).click();assert(await dialog.isHidden());assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Quote swap');checks.push('Offline quoting stops and close restores focus at '+width+'px');
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,screens},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
