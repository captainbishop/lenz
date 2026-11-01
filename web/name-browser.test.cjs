const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
let base,reply,hold=false,release;const requests=[],checks=[],errors=[];
const data=()=>({version:1,system:'ens',name:'alice.eth',requestedName:'Alice.ETH',network:'testnet',chainId:1313161555,identityBinding:'not_verified',authority:'ethereum:mainnet',coinType:'3460645203',block:{hash:'0x'+'ab'.repeat(32),height:'26320069'},checkedAt:'2026-11-01T13:12:24.460Z',state:'address_found',auroraAddress:'0x'+'12'.repeat(20),resolver:'0x'+'34'.repeat(20),addressKind:'ens-aurora-record'});
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
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
    const run=async()=>{await p.locator('#name-check').click();await ready();};
    await p.goto(base+'/name-lab.html');await ready();
    const profile=await p.evaluate(async()=>{const {updateState}=await import('/chat-store.js'),{createIdentity}=await import('/peer-crypto.js');const identity=await createIdentity('Existing profile');await updateState(s=>{s.identity=identity;s.messages=[{packet:{id:'preserve-message'}}];});return identity.profile;});
    await check('opening the name screen performs no lookup or account creation',async()=>{assert.equal(requests.length,0);assert(await p.locator('#name-result').isHidden());assert(!await p.locator('#name-remember').isChecked());});
    await check('explicit lookup shows normalized name, exact network and unverified identity boundary without saving by default',async()=>{
      reply={status:200,body:data()};await p.locator('#name-input').fill('Alice.ETH');await run();
      assert.equal(await p.locator('#name-address').inputValue(),data().auroraAddress);assert.equal(await p.locator('#name-normalized').innerText(),'alice.eth');
      assert((await p.locator('.name-scope').innerText()).includes('Linking names to Lenz profiles'));
      assert(await p.locator('#name-options').evaluate(n=>!n.open));
      assert.deepEqual(requests,[{file:'/api/names/resolve',input:{system:'ens',network:'testnet',name:'Alice.ETH'}}]);
      assert.equal(await p.evaluate(()=>localStorage.getItem('lenz-name-check-v1')),null);
    });
    await check('busy state blocks duplicate submissions and input changes',async()=>{
      hold=true;release=null;await p.locator('#name-check').click();await p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='true');
      assert(await p.locator('#name-input').isDisabled());assert(await p.locator('#name-network').isDisabled());
      await p.evaluate(()=>document.querySelector('#name-form').dispatchEvent(new Event('submit',{cancelable:true})));while(!release)await new Promise(r=>setTimeout(r,10));hold=false;release();await ready();assert.equal(requests.length,2);
    });
    await check('saved result reopens offline without being presented as a fresh lookup',async()=>{
      await p.locator('#name-remember').check();await run();await p.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
      const before=requests.length;await context.setOffline(true);await p.reload();await ready();
      assert.equal(await p.locator('#name-address').inputValue(),data().auroraAddress);assert((await p.locator('#name-freshness').innerText()).includes('Saved check'));await run();
      assert((await p.locator('#name-status').innerText()).includes('Offline'));assert.equal(requests.length,before);await context.setOffline(false);
    });
    await check('changed destination is visible and failed or mismatched responses preserve a stale-labelled prior result',async()=>{
      reply={status:200,body:{...data(),auroraAddress:'0x'+'56'.repeat(20)}};await run();assert(await p.locator('#name-change').isVisible());
      for(const response of [{status:503,body:{error:'offline'}},{status:200,body:{...data(),network:'mainnet'}}]){
        reply=response;await run();assert.equal(await p.locator('#name-status').getAttribute('data-error'),'true');assert((await p.locator('#name-freshness').innerText()).includes('Saved check'));assert.equal(await p.locator('#name-address').inputValue(),'0x'+'56'.repeat(20));
      }
    });
    await check('changing naming network hides unrelated results and forgetting affects only the saved name',async()=>{
      await p.locator('#name-options summary').click();await p.locator('#name-network').selectOption('mainnet');assert(await p.locator('#name-result').isHidden());await p.locator('#name-forget').click();
      assert.equal(await p.evaluate(()=>localStorage.getItem('lenz-name-check-v1')),null);
      const state=await p.evaluate(async()=>{const {readState}=await import('/chat-store.js');const s=await readState();return {profile:s.identity.profile,messages:s.messages};});assert.deepEqual(state.profile,profile);assert.deepEqual(state.messages,[{packet:{id:'preserve-message'}}]);
    });
    await check('both themes reflow at desktop and narrow widths without clipping',async()=>{
      await p.locator('#name-network').selectOption('testnet');reply={status:200,body:data()};await run();await run();
      await p.locator('#name-options summary').click();
      await fs.mkdir(path.join(__dirname,'evidence'),{recursive:true});
      for(const theme of ['light','dark'])for(const width of [1280,390]){
        await p.setViewportSize({width,height:950});await p.evaluate(theme=>{localStorage.setItem('lenz-home-theme',theme);document.documentElement.dataset.theme=theme;},theme);
        assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await p.screenshot({path:path.join(__dirname,'evidence',`name-lookup-${theme}-${width}.png`),fullPage:true});
      }
    });
    await check('name suffix selects NEAR and its network without opening options',async()=>{
      for(const [name,network] of [['alice.near','mainnet'],['alice.testnet','testnet']]){
        await p.locator('#name-input').fill(name);
        reply={status:200,body:{version:1,system:'near',name,requestedName:name,network,chainId:network==='mainnet'?1313161554:1313161555,identityBinding:'not_verified',authority:'near:'+network,block:{hash:'a'.repeat(44),height:123},checkedAt:new Date().toISOString(),state:'account_found',auroraAddress:'0x'+'12'.repeat(20),accountId:name,addressKind:'derived-near-caller'}};
        await run();
        assert.deepEqual(requests.at(-1).input,{system:'near',network,name});
        assert((await p.locator('#name-meaning').innerText()).includes('not a payment destination'));
      }
    });
    await check('missing ENS resolver shows no address instead of implying the name is unregistered',async()=>{
      await p.locator('#name-input').fill('Alice.ETH');
      const {auroraAddress,...missing}=data();reply={status:200,body:{...missing,state:'not_found'}};await run();
      assert.equal(await p.locator('#name-state').innerText(),'No address found');
      assert(await p.locator('#name-address-wrap').isHidden());
      await p.locator('#name-input').focus();
      assert.equal(await p.locator('#name-input').evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
      assert.equal(await p.locator('label[for=name-input]').evaluate(n=>getComputedStyle(n).outlineStyle),'none');
    });
    assert.deepEqual(errors,[]);assert(requests.every(r=>r.file==='/api/names/resolve'));
    await fs.writeFile(path.join(__dirname,'name-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),scope:'Disposable Edge context, synthetic naming responses, real offline reload; no signing or financial requests.',checks,errors,screenshots:['light-1280','light-390','dark-1280','dark-390'].map(x=>'evidence/name-lookup-'+x+'.png')},null,2)+'\n');
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
