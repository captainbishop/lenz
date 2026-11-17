const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

(async()=>{
 const root=path.join(__dirname,'public'),errors=[],mutations=[],screens=process.env.LENZ_UI_EVIDENCE_DIR??path.join(os.tmpdir(),'lenz-intent-wallet-review');
 await fs.mkdir(screens,{recursive:true});
 const server=http.createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){
   if(/\/(?:add-funds|submit|resume|cleanup|execute|broadcast|send)$/.test(pathname))mutations.push(pathname);
   response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({error:'Test service unavailable for this isolated acceptance check.'}));return;
  }
  try{
   const file=path.resolve(root,'.'+decodeURIComponent(pathname));assert(file.startsWith(root+path.sep));
   response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');response.end(await fs.readFile(file));
  }catch{response.writeHead(404);response.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/money.html');await page.locator('#device-profile>summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#wallet-test-funds').disabled);
  assert.equal(await page.locator('#wallet-native-list').innerText(),'');assert.equal(await page.locator('#wallet-near-intents').count(),0);assert.equal(await page.getByRole('button',{name:'Get test funds',exact:true}).count(),1);
  assert.equal(await page.locator('#wallet-test-funds').innerText(),'');assert.equal(await page.locator('#wallet-test-funds svg').count(),1);assert.equal(await page.locator('.wallet-offline-token').isVisible(),false);assert.equal(await page.locator('.token-columns').isVisible(),false);
  await page.evaluate(()=>{globalThis.acceptanceSigns=0;const sign=crypto.subtle.sign.bind(crypto.subtle);crypto.subtle.sign=(...args)=>{acceptanceSigns++;return sign(...args);};});
  await page.locator('#wallet-test-funds').click();await page.locator('#wallet-funding-dialog').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#wallet-funding-dialog').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#near-intent-funding-swap,#near-intent-funding-offline').count(),0);assert.equal(await page.evaluate(()=>acceptanceSigns),0);assert.deepEqual(mutations,[]);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#wallet-test-funds').evaluate(node=>node===document.activeElement),true);
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();await page.locator('.wallet-markets a').filter({has:page.locator('strong',{hasText:/^Swap$/})}).click();await page.locator('#rhea-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#rhea-title').innerText(),'Swap');assert.equal(await page.locator('#near-intent-selection').count(),0);assert.equal(await page.locator('#rhea-form button[type=submit]').isDisabled(),true);
  for(const theme of ['light','dim','dark'])for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screens,`swap-${theme}-${width}.png`)});
  }
  await page.keyboard.press('Escape');assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.equal(await page.evaluate(()=>acceptanceSigns),0);
  console.log(JSON.stringify({passed:5,failed:0,scope:'Actual Wallet and shared Swap UI in disposable Edge, with all remote services deliberately unavailable. No testnet funding or settlement.',checks:['One funding entry and no duplicate swap card or initial unfunded BTC/ETH/SOL rows','Funding review has no asset-purpose switch or automatic authorization','Cancelling funding restores the original entry focus','Wallet Swap opens its existing composer and unavailable funds cannot approve','All three Lenz themes fit phone/desktop with no unhandled errors or financial calls']},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
