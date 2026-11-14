// Actual wallet UI with disposable provider/API fixtures; no user wallet or funds.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Wallet,verifyMessage}=require('../aurora/node_modules/ethers');
const {securityHeaders}=require('./security-policy.mjs');
const {walletClick}=require('./wallet-test-ui.cjs');
const output=process.env.LENZ_PRIVATE_WALLET_EVIDENCE||path.join(os.tmpdir(),'lenz-private-wallet-20261109');
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [key,value] of Object.entries(securityHeaders(file)))res.setHeader(key,value);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  if(file.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
  res.end(await fs.readFile(path.join(__dirname,'public',file==='/'?'index.html':file)));
}catch{res.writeHead(404);res.end('Unavailable');}});
(async()=>{
  await fs.mkdir(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),wallet=Wallet.createRandom();
    const base='http://127.0.0.1:'+server.address().port;
    page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE',error.message);});
    let mode='balances',auth=0,reads=0,releaseRead=null;
    await page.exposeFunction('signFixture',async hex=>wallet.signMessage(Buffer.from(hex.slice(2),'hex')));
    await context.addInitScript(address=>{
      const handlers=new Map(),f=window.privateFixture={address,chain:'0x1',calls:[],delay:false,decline:false,resolve:null,emit:event=>handlers.get(event)?.()};
      const provider={on:(event,fn)=>handlers.set(event,fn),removeListener:event=>handlers.delete(event),async request(value){
        f.calls.push(value);
        if(value.method==='personal_sign'){
          if(f.decline)throw Object.assign(Error('Declined'),{code:4001});
          if(f.delay)await new Promise(resolve=>f.resolve=resolve);
          return signFixture(value.params[0]);
        }
        return {eth_requestAccounts:[f.address],eth_accounts:[f.address],eth_chainId:f.chain,eth_blockNumber:'0x1',eth_getBalance:'0x0',eth_getCode:'0x'}[value.method];
      }};
      addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Private fixture'},provider}})));
    },wallet.address.toLowerCase());
    await page.route('https://free.rpc.fastnear.com/**',r=>r.fulfill({json:{jsonrpc:'2.0',id:'lenz-auth-salt',result:{result:[...Buffer.from('"e110f317"')]}}}));
    await page.route('https://1click.chaindefuser.com/**',async route=>{
      const request=route.request(),url=request.url();
      if(url.endsWith('/auth/authenticate')){
        auth++;const signed=request.postDataJSON().signedData,value=JSON.parse(signed.payload);
        assert.deepEqual(value.intents,[]);assert.equal(value.signer_id,wallet.address.toLowerCase());
        const {base58}=await import('../integrations/node_modules/@scure/base/lib/esm/index.js');
        assert.equal(verifyMessage(signed.payload,'0x'+Buffer.from(base58.decode(signed.signature.slice(10))).toString('hex')),wallet.address);
        await route.fulfill({json:{accessToken:'fixture-private-access',refreshToken:'fixture-private-refresh',expiresIn:60,refreshExpiresIn:3600}});return;
      }
      assert(url.endsWith('/account/balances'));reads++;assert.equal(request.headers().authorization,'Bearer fixture-private-access');
      if(mode==='delay')await new Promise(resolve=>releaseRead=resolve);
      if(mode==='401'){await route.fulfill({status:401,json:{error:'fixture-private-access'}});return;}
      await route.fulfill({json:{balances:mode==='empty'?[]:[{tokenId:'nep141:eth.omft.near',available:'9007199254740993123456789',source:'private'}, {tokenId:'nep141:unknown.near',available:'123456789012345678901234567890',source:'private'}]}}).catch(()=>{});
    });
    await page.route('**/api/receive/assets',r=>r.fulfill({json:{tokens:[{assetId:'nep141:eth.omft.near',symbol:'ETH',blockchain:'eth',decimals:18}]}}));
    await page.route('**/api/tokens/**',r=>r.abort());
    await page.goto(base+'/money.html');await page.locator('#wallet-account').waitFor();
    const connect=async()=>{await walletClick(page,'evm-connect');await page.getByRole('button',{name:'Private fixture',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);await page.locator('#wallet-account-dialog').waitFor({state:'hidden'});};
    const open=async()=>{if(!await page.locator('#wallet-account-dialog').evaluate(n=>n.open))await page.locator('#wallet-account').click();};
    const signIn=async()=>{await open();await page.locator('#private-connect').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent==='Lenz funds checked.');};
    await connect();assert.equal(auth,0);assert.equal(await page.evaluate(()=>privateFixture.calls.some(c=>c.method==='personal_sign')),false);
    await open();assert(await page.getByText('The transfer provider can see your wallet address, sign-in signature and balances.',{exact:true}).isVisible());
    assert(await page.getByText('Sign in with your wallet to check Lenz funds. This gives no permission to spend.',{exact:true}).isVisible());
    await signIn();assert.equal(auth,1);assert.equal(reads,1);
    assert.equal(await page.locator('#private-values .asset-icon img').first().getAttribute('src'),'/asset-icons/eth.svg');
    assert.equal(await page.locator('#private-values dd').first().innerText(),'9007199.254740993123456789');
    assert((await page.locator('#private-values dd').nth(1).innerText()).includes('123456789012345678901234567890'));
    assert((await page.locator('#private-observed').innerText()).includes('Unavailable offline'));
    checks.push('explicit ownership sign-in displays exact private units with provider source and offline limits; ordinary wallet connect does not sign');
    for(const theme of ['light','dim','dark'])for(const width of [320,390,844,1280]){
      await page.setViewportSize({width,height:width===844?390:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await page.locator('#wallet-private-balances').scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert(await page.locator('#wallet-account-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));
      await page.screenshot({path:path.join(output,`private-${theme}-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert(await page.locator('#wallet-account-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.evaluate(()=>document.documentElement.style.fontSize='');
    checks.push('private amounts and long token identifiers reflow at 320–1280px in all three themes, landscape, reduced motion and enlarged text');
    await page.locator('#private-refresh').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent==='Lenz funds checked.');assert.equal(auth,1);assert.equal(reads,2);
    mode='401';await page.locator('#private-refresh').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('Session expired'));
    assert.equal(await page.locator('#private-values').innerText(),'');assert(!(await page.locator('body').innerText()).includes('fixture-private-access'));
    mode='empty';await page.locator('#private-connect').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('No Lenz funds'));
    assert.equal(await page.locator('#private-values').innerText(),'');
    await page.locator('#private-disconnect').click();await page.evaluate(()=>privateFixture.decline=true);await page.locator('#private-connect').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('declined or failed'));
    assert.equal(await page.locator('#private-values').innerText(),'');await page.evaluate(()=>privateFixture.decline=false);
    checks.push('refresh does not prompt again; expired sessions, genuine empty balances and declined signing stay distinct');
    mode='balances';await page.evaluate(()=>privateFixture.delay=true);await page.locator('#private-connect').click();await page.waitForFunction(()=>!!privateFixture.resolve);
    await page.locator('#private-disconnect').click();await page.locator('#private-connect').click();await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('declined or failed'));
    const attempts=await page.evaluate(()=>privateFixture.calls.filter(c=>c.method==='personal_sign').length),beforeLate=auth;
    await page.evaluate(()=>{privateFixture.delay=false;privateFixture.resolve();});await page.waitForTimeout(100);assert.equal(auth,beforeLate);
    assert.equal(await page.evaluate(()=>privateFixture.calls.filter(c=>c.method==='personal_sign').length),attempts);
    await signIn();
    await page.locator('#private-disconnect').click();await page.evaluate(()=>{privateFixture.delay=true;privateFixture.resolve=null;});
    await page.locator('#private-connect').click();await page.waitForFunction(()=>!!privateFixture.resolve);
    const beforeClose=auth;await page.keyboard.press('Escape');
    await page.evaluate(()=>{privateFixture.delay=false;privateFixture.resolve();});await page.waitForTimeout(100);await open();
    assert((await page.locator('#private-status').innerText()).includes('Cancelled'), 'Closing the account panel must cancel a pending sign-in');
    assert.equal(auth,beforeClose);await signIn();
    for(const dismissal of ['button','escape']) {
      await page.locator('#private-disconnect').click();
      await page.evaluate(()=>{
        const original=window.fetch;window.pendingPrivateReply=null;window.holdPrivateReply=false;
        window.fetch=async(...args)=>{const response=await original(...args);if(window.holdPrivateReply&&String(args[0]).endsWith('/account/balances'))await new Promise(resolve=>window.pendingPrivateReply=resolve);return response;};
        window.restorePrivateFetch=()=>{window.fetch=original;};
      });
      await signIn();await page.evaluate(()=>window.holdPrivateReply=true);
      await page.locator('#private-refresh').click();await page.waitForFunction(()=>!!window.pendingPrivateReply);
      if(dismissal==='button')await page.evaluate(()=>{document.querySelector('#wallet-account-dialog .wallet-close').click();pendingPrivateReply();restorePrivateFetch();});
      else {await page.evaluate(()=>document.querySelector('#wallet-account-dialog').addEventListener('cancel',()=>{pendingPrivateReply();restorePrivateFetch();},{once:true}));await page.keyboard.press('Escape');}
      await open();assert((await page.locator('#private-status').innerText()).includes('Cancelled'), 'A reply during dismissal must remain cancelled');
      assert.equal(await page.locator('#private-values').innerText(),'');await signIn();
    }
    mode='delay';await page.locator('#private-refresh').click();await assert.doesNotReject(async()=>{for(let i=0;i<100&&!releaseRead;i++)await new Promise(r=>setTimeout(r,20));assert(releaseRead);});
    await page.evaluate(()=>{privateFixture.address='0x'+'34'.repeat(20);privateFixture.emit('accountsChanged');});releaseRead();releaseRead=null;
    await page.waitForTimeout(100);assert.equal(await page.locator('#private-values').innerText(),'');assert(await page.locator('#private-connect').isDisabled());
    checks.push('cancelled signing cannot overlap a new prompt; account changes erase balances and discard late responses');
    await page.evaluate(address=>privateFixture.address=address,wallet.address.toLowerCase());mode='balances';await connect();await signIn();
    await page.keyboard.press('Escape');await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
    await page.locator('#toggle-balances').click();await page.locator('#wallet-private-open').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'private-refresh');
    assert.equal(await page.locator('#private-values dd span').first().innerText(),'••••');
    assert.equal(await page.locator('#private-values dd span').first().getAttribute('aria-label'),'Amount hidden');
    await page.keyboard.press('Escape');await page.locator('#toggle-balances').click();
    await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'),null,{timeout:120000});
    const cacheData=await page.evaluate(async()=>{const urls=[];for(const key of await caches.keys())for(const r of await(await caches.open(key)).keys())urls.push(r.url);return urls;});
    assert(cacheData.some(url=>url.endsWith('/intents-account.js')));assert(!cacheData.some(url=>url.includes('chaindefuser')||url.includes('fastnear')));
    await context.setOffline(true);await open();assert.equal(await page.locator('#private-values').innerText(),'');assert((await page.locator('#private-status').innerText()).includes('Go online'));
    page.on('requestfailed',request=>{if(request.url().startsWith(base))console.error('FAILED',new URL(request.url()).pathname);});
    await page.reload();await page.locator('#wallet-account').waitFor();await open();assert(await page.locator('#private-connect').isDisabled());
    assert.equal(await page.evaluate(()=>privateFixture.calls.length),0);
    await context.setOffline(false);await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>privateFixture.calls.length),0);
    const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!stored.includes('fixture-private-'));
    checks.push('amount masking applies to private balances; offline saving caches modules without API replies or tokens and reopening never restores a session');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,checks},null,2));
    console.log(checks.map(check=>'PASS '+check).join('\n'));
    await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
