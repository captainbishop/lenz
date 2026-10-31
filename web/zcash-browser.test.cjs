const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
let base,reply,hold,release;const requests=[],checks=[],errors=[];
const address=require('../zcash/address-a-results.json').orchardAddress;
const data=()=>({network:'testnet',wallet:'a',mode:'native-test-companion',checkedAt:'2026-10-31T12:00:00.000Z',refreshed:false,serverHeight:null,walletHeight:4542631,amounts:{total:'123456789',spendable:'110000001',pending:'13456788',ironwood_spendable:'100000000',orchard_spendable:'0',sapling_spendable:'10000000',transparent_spendable:'1'},address,receiver:'orchard',canSend:false});
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;for(const [k,v] of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);requests.push({file,input:JSON.parse(Buffer.concat(chunks))});if(hold)await new Promise(r=>release=r);res.writeHead(reply.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(reply.body));return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(path.join(__dirname,'public',file)));
}catch{res.writeHead(404);res.end('missing');}});
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    const ready=()=>p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
    const read=async(id='#zc-read')=>{await p.locator(id).click();await ready();};
    await p.goto(base+'/zcash-lab.html');await ready();
    const identity=await p.evaluate(async()=>{const {updateState}=await import('/chat-store.js'),{createIdentity}=await import('/peer-crypto.js');const identity=await createIdentity('Unrelated Lenz profile');await updateState(s=>{s.identity=identity;s.messages=[{packet:{id:'preserve-existing-message'}}];});return identity.profile.id;});
    await check('no automatic wallet access or pretend zero before the first native read',async()=>{assert.equal(requests.length,0);assert(await p.locator('#zc-result').isHidden());assert.equal(await p.locator('#zc-total').innerText(),'—');});
    await check('local read displays exact eight-decimal ZEC amounts, native address and unrefreshed status',async()=>{
      reply={status:200,body:data()};await read();assert.equal(await p.locator('#zc-total').innerText(),'1.23456789');assert.equal(await p.locator('#zc-spendable').innerText(),'1.10000001');assert.equal(await p.locator('#zc-pending').innerText(),'0.13456788');assert.equal(await p.locator('#zc-address').inputValue(),address);assert((await p.locator('#zc-freshness').innerText()).includes('network not checked'));assert.deepEqual(requests,[{file:'/api/zcash/status',input:{wallet:'a'}}]);
    });
    await check('network update shows progress, blocks duplicate actions and preserves existing result while waiting',async()=>{
      reply={status:200,body:{...data(),refreshed:true}};hold=true;await p.locator('#zc-refresh').click();await p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='true');
      assert(await p.locator('#zc-wallet').isDisabled());assert(await p.locator('#zc-read').isDisabled());assert.equal(await p.locator('#zc-total').innerText(),'1.23456789');
      await p.evaluate(()=>document.querySelector('#zc-refresh').dispatchEvent(new MouseEvent('click')));while(!release)await new Promise(r=>setTimeout(r,10));hold=false;release();await ready();assert.equal(requests.length,2);assert((await p.locator('#zc-freshness').innerText()).includes('Network update completed'));
    });
    await check('native error and malformed successful responses preserve old data with an explicit stale label',async()=>{
      for(const response of [{status:503,body:{error:'Native wallet unavailable'}},{status:200,body:{...data(),network:'mainnet'}},{status:200,body:{...data(),wallet:'b'}},{status:200,body:{...data(),amounts:{...data().amounts,total:'1'}}},{status:200,body:{...data(),refreshed:true}}]){
        reply=response;await read();assert.equal(await p.locator('#zc-status').getAttribute('data-error'),'true');assert.equal(await p.locator('#zc-total').innerText(),'1.23456789');assert((await p.locator('#zc-freshness').innerText()).includes('may be out of date'));
      }
    });
    await check('switching test accounts hides old values and requires an explicit read',async()=>{
      const before=requests.length;await p.locator('#zc-wallet').selectOption('b');assert(await p.locator('#zc-result').isHidden());assert.equal(await p.locator('#zc-address').inputValue(),'');assert.equal(requests.length,before);
      reply={status:200,body:{...data(),wallet:'b',amounts:{total:'0',spendable:'0',pending:'0',ironwood_spendable:'0',orchard_spendable:'0',sapling_spendable:'0',transparent_spendable:'0'}}};await read();assert.equal(await p.locator('#zc-total').innerText(),'0');assert((await p.locator('#zc-funding').innerText()).includes('No test coins'));
    });
    await check('offline and reconnect events never synchronize or send; page can reload from the shared offline cache',async()=>{
      await p.evaluate(async()=>{await navigator.serviceWorker.register('/chat-sw.js');await navigator.serviceWorker.ready;});await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const before=requests.length;await context.setOffline(true);await p.waitForFunction(()=>!navigator.onLine);assert(await p.locator('#zc-refresh').isDisabled());await p.reload();await ready();assert(await p.locator('#zc-result').isHidden());assert(await p.evaluate(async()=>{try{await fetch('/uncached-zcash-probe');return false;}catch{return true;}}));await context.setOffline(false);await p.waitForFunction(()=>navigator.onLine);assert.equal(requests.length,before);
    });
    await check('responsive layout, enlarged text and identity/history preservation',async()=>{
      reply={status:200,body:data()};await read();await p.locator('#zc-result summary').click();
      for(const [width,height] of [[375,812],[812,375],[1280,900]]){await p.setViewportSize({width,height});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      await p.addStyleTag({content:'html{font-size:125%}'});await p.setViewportSize({width:375,height:812});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const s=await p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {id:s.identity.profile.id,messages:s.messages,extractable:s.identity.signingPrivate.extractable,nearBox:s.nearBox};});assert.equal(s.id,identity);assert.deepEqual(s.messages,[{packet:{id:'preserve-existing-message'}}]);assert.equal(s.extractable,false);assert.equal(s.nearBox,undefined);assert.deepEqual(errors,[]);await p.screenshot({path:path.join(__dirname,'evidence/zcash-companion-narrow.png'),fullPage:true});
    });
    await fs.writeFile(path.join(__dirname,'zcash-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,requests,scope:'Isolated Windows Edge; fixture native wallet responses, actual HTTP/browser/cache behavior. No native wallet funding or spending. Existing test Lenz identity/history preserved.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(async e=>{console.error(e);await fs.writeFile(path.join(__dirname,'zcash-browser-failure.json'),JSON.stringify({at:new Date().toISOString(),checks,error:e.stack,errors},null,2)+'\n');server.close();process.exitCode=1;});
