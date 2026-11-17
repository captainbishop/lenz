const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

test('a new mobile profile keeps People open through refresh, sharing and contact entry',async()=>{
 const root=path.resolve(process.env.LENZ_EMPTY_PEOPLE_PUBLIC??path.join(__dirname,'public')),server=http.createServer(async(req,res)=>{
  try{
   const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   res.end(name==='/nostr-config.json'?JSON.stringify({version:1,relays:[]}):await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/chat.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
  const idle=()=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  await page.locator('#device-profile>summary').click();await page.locator('#continue-private').click();await idle();
  assert.equal(await page.locator('#people-count').innerText(),'0');await page.locator('#back-people').click();
  await page.evaluate(()=>{document.querySelector('#people-count').textContent='Refreshing';const refresh=new BroadcastChannel('proof-u-chat-refresh');refresh.postMessage('changed');refresh.close();});
  await page.waitForFunction(()=>document.querySelector('#people-count').textContent==='0');
  assert(await page.locator('.contacts').isVisible(),'background refresh must retain the open empty People drawer');
  assert(await page.locator('#show-card').isVisible());assert(await page.locator('#show-add-contact').isVisible());
  await page.locator('#show-card').click();await page.locator('#share-contact').waitFor({state:'visible'});await idle();await page.keyboard.press('Escape');
  assert(await page.locator('.contacts').isVisible(),'closing contact sharing must return to People');
  await page.locator('#show-add-contact').click();await page.locator('#add-contact').waitFor({state:'visible'});await page.keyboard.press('Escape');
  assert(await page.locator('.contacts').isVisible());await page.locator('#contact-search').fill('Nobody yet');await idle();
  assert(await page.locator('.contacts').isVisible(),'search refresh must retain People with no contacts');
  await page.locator('#close-people').click();assert(await page.locator('.conversation').isVisible());assert(await page.locator('#message').isDisabled());assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
