const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function run(){
 const root=path.join(__dirname,'public'),checks=[],errors=[],requests=[];let browser;
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   assert(!pathname.startsWith('/api/'));
   const file=path.resolve(root,'.'+pathname);assert(file.startsWith(root+path.sep));
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const hostname of ['localhost','127.0.0.1']){
   const base='http://'+hostname+':'+server.address().port;
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   let passkeyPrompts=0;
   await context.exposeFunction('recordPasskeyPrompt',()=>{passkeyPrompts++;});
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base||url.pathname.startsWith('/api/')){requests.push(url.origin+url.pathname);return route.abort('internetdisconnected');}
    return route.continue();
   });
   await context.addInitScript(()=>{
    Object.defineProperty(navigator,'onLine',{get:()=>false});
    for(const method of ['create','get'])Object.defineProperty(navigator.credentials,method,{value:async()=>{await window.recordPasskeyPrompt();throw Error('No passkey available for this offline test');}});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/account.html?next=wallet');
   await page.waitForFunction(()=>document.querySelector('#account-development').hidden===false);
   assert.equal(await page.locator('#account-local').count(),1,'Account must offer local onboarding without a passkey');
   await page.locator('#account-local').waitFor();
   const button=await page.locator('#account-local').boundingBox();
   assert(button.y>=0&&button.y+button.height<=844,'The local onboarding action must be visible on arrival from Wallet');
   await page.locator('#account-create-name').fill('First offline visit');
   if(hostname==='127.0.0.1')await page.locator('#account-create-name').press('Enter');
   else await page.locator('#account-local').click();
   await page.waitForURL('**/money.html');
   await page.locator('#wallet-content').waitFor();
   assert.equal(await page.locator('#my-name').innerText(),'First offline visit');
   assert.equal(passkeyPrompts,0);
   await page.goto(base+'/account.html?next=wallet');
   await page.locator('#account-existing').waitFor();
   assert.equal(await page.locator('#account-name').innerText(),'First offline visit');
   assert.equal(await page.locator('#account-protected').isVisible(),false);
   if(hostname==='127.0.0.1')assert.match(await page.locator('#account-enroll-detail').innerText(),/Automatic backup is unavailable at this address/);
   const original=await page.evaluate(async()=>{
    const {readState}=await import('/chat-store.js');const {identity,accountSync}=await readState();
    return {id:identity.profile.id,signingExtractable:identity.signingPrivate.extractable,boxExtractable:identity.boxPrivate.extractable,hasBackup:!!accountSync};
   });
   assert.equal(original.signingExtractable,false);assert.equal(original.boxExtractable,false);assert.equal(original.hasBackup,false);
   await page.reload();await page.locator('#account-existing').waitFor();
   assert.equal(await page.locator('#account-name').innerText(),'First offline visit');
   assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),original.id);
   await page.locator('.account-continue').click();await page.locator('#wallet-content').waitFor();
   assert.equal(await page.locator('#my-name').innerText(),'First offline visit');
   assert.equal(passkeyPrompts,0);
   await context.close();checks.push('Fresh '+hostname+' visit creates and retains a local profile, opens Wallet, and uses no passkey or internet API');
  }
  const base='http://localhost:'+server.address().port;
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base||url.pathname.startsWith('/api/')){requests.push(url.origin+url.pathname);return route.abort('internetdisconnected');}
   return route.continue();
  });
  await context.addInitScript(()=>{
   Object.defineProperty(navigator,'onLine',{get:()=>false});
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args){if(window.rejectLocalSave)throw new DOMException('Device storage is full','QuotaExceededError');return put.apply(this,args);};
  });
  const first=await context.newPage();first.on('pageerror',e=>errors.push(e.message));
  await first.goto(base+'/account.html');await first.locator('#account-local').waitFor();
  await first.evaluate(()=>{window.rejectLocalSave=true;});await first.locator('#account-local').click();
  await first.locator('#account-status').filter({hasText:'Device storage is full'}).waitFor();
  assert.equal(await first.locator('#account-existing').isVisible(),false);
  await first.reload();await first.locator('#account-local').waitFor();
  assert.equal(await first.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity),null);
  checks.push('Failed device storage does not create an identity or report successful onboarding');
  const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));
  await second.goto(base+'/account.html');await second.locator('#account-local').waitFor();
  await first.locator('#account-create-name').fill('First tab');await second.locator('#account-create-name').fill('Second tab');
  await first.evaluate(()=>new Promise(held=>{
   window.heldState=navigator.locks.request('proof-u-private-chat-v1',()=>new Promise(release=>{window.releaseState=release;held();}));
  }));
  await first.locator('#account-local').click();
  await first.waitForFunction(async()=>(await navigator.locks.query()).pending.some(row=>row.name==='proof-u-private-chat-v1'));
  await second.locator('#account-local').click();
  await second.waitForFunction(async()=>(await navigator.locks.query()).pending.filter(row=>row.name==='proof-u-private-chat-v1').length>=2);
  await first.evaluate(()=>window.releaseState());
  await first.locator('#account-existing').waitFor();
  await second.locator('#account-status').filter({hasText:'This browser already has an account'}).waitFor();
  assert.equal(await second.locator('#account-name').innerText(),'First tab');
  const ids=await Promise.all([first,second].map(page=>page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id)));
  assert.equal(ids[0],ids[1]);
  checks.push('Two concurrent onboarding attempts retain the first committed identity');
  await context.close();
  assert.deepEqual(requests,[],'Local onboarding must not attempt internet/API requests');
  assert.deepEqual(errors,[]);
  for(const check of checks)console.log('PASS '+check);
  return {passed:checks.length,checks,scope:'Fresh browser contexts; authentic app files served on loopback, internet/API requests blocked, no prior cache or identity. This does not demonstrate peer installation, physical mesh or funded DeFi.'};
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
module.exports={run};
if(require.main===module)run().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
