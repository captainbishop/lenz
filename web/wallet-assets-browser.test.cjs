const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],checks=[];
 const screenshots=path.join(os.tmpdir(),'lenz-assets-review');await fs.mkdir(screenshots,{recursive:true});
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());
  await page.goto('http://127.0.0.1:4173/money.html');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');await page.locator('#device-profile>summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  for(const symbol of ['BTC','ETH','SOL']){const row=page.locator('.wallet-native-row').filter({hasText:symbol});await row.waitFor();assert.equal(await row.count(),1,`${symbol} has a home in Tokens`);assert.equal(await row.locator('.token-quantity').innerText(),'—');assert.equal(await row.locator('img').count(),1);await row.locator('img').evaluate(img=>img.decode());}
  assert.equal(await page.locator('.wallet-lower').isVisible(),false);assert.equal(await page.locator('#wallet-payment-history').count(),0);
  await page.getByRole('button',{name:'Activity',exact:true}).click();await page.getByRole('dialog',{name:'Activity',exact:true}).waitFor();assert(await page.locator('#near-empty').isVisible());await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-activity');
  await page.getByRole('button',{name:'Token display',exact:true}).click();await page.getByLabel('Hide zero balances',{exact:true}).check();await page.keyboard.press('Escape');assert.equal(await page.locator('.wallet-native-row').count(),3,'unknown assets are not zero');
  checks.push('native assets have logos and unread amounts; Activity is secondary; hide-zero retains unread balances');
  for(const theme of ['light','dark'])for(const width of [320,390,844,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if([390,1280].includes(width))await page.screenshot({path:path.join(screenshots,`assets-${theme}-${width}.png`),fullPage:true});}
  assert.deepEqual(errors,[]);checks.push('assets fit phone, landscape and desktop in both themes');
  await fs.writeFile(path.join(__dirname,'wallet-assets-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Disposable profile; no external wallet or user data.'},null,2));console.log(checks);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
