const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const reportDirectory=process.env.LENZ_ZCASH_REPORT_DIR??__dirname;
const live=process.argv.includes('--live'),freshness=process.argv.includes('--freshness'),effects=process.argv.includes('--effects'),checks=[],requests=[],errors=[],networkChecks=[],effectChecks=[];
const address=require('../zcash/address-b-results.json').orchardAddress;
const sample={id:'12345678-1234-1234-1234-123456789abc',wallet:'a',state:'ready',amount:'1000000',fee:'10000',totalDebit:'1010000',change:'88980000',txid:'a'.repeat(64),recipient:'b',address,walletHeight:4563325,canSign:false,canSend:false};
let server,base='http://127.0.0.1:4173',reply={review:sample};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
  await fs.mkdir(path.join(reportDirectory,'evidence'),{recursive:true});
  if(!live){server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost').pathname;for(const[k,v]of Object.entries(securityHeaders(url)))res.setHeader(k,v);
    if(url.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);requests.push({url,body:JSON.parse(Buffer.concat(chunks))});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(url)]??'application/octet-stream');res.end(await fs.readFile(path.join(__dirname,'public',url)));
  }catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    const calls=[];p.on('request',r=>{if(r.url().includes('/api/'))calls.push({url:r.url(),body:r.postDataJSON()});});
    const ready=()=>p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
    const click=async(id)=>{await p.locator(id).click();await ready();};
    await p.goto(base+'/zcash-lab.html');await ready();
    await check('opening the page makes no wallet, payment or network request',async()=>{assert.equal(calls.length,0);assert(await p.locator('#zc-review-result').isHidden());});
    if(live){await click('#zc-review-check');assert(await p.locator('#zc-review-result').isHidden(),'Existing unsigned review must be reconciled before this test');}
    await check('explicit preparation shows actual amount, fee and fixed recipient with no signing action',async()=>{
      await p.locator('#zc-review-amount').fill('0.01');await click('#zc-review-prepare');assert(await p.locator('#zc-review-result').isVisible());
      const text=await p.locator('#zc-review-terms').innerText();assert(text.includes('Test wallet B'));assert(text.includes('0.01 test ZEC'));assert(text.includes('0.0001 test ZEC'));assert(text.includes('0.0101 test ZEC'));assert.equal(await p.locator('#zc-review-heading').innerText(),'Not signed or sent');
    });
    const detail=await p.locator('#zc-review-details').textContent();
    await check('reload and reconnect do not prepare, sign or send; explicit status restores the same review',async()=>{
      const n=calls.length;await p.reload();await ready();assert.equal(calls.length,n);assert(await p.locator('#zc-review-result').isHidden());
      await context.setOffline(true);await p.waitForFunction(()=>!navigator.onLine);await context.setOffline(false);await p.waitForFunction(()=>navigator.onLine&&document.querySelector('#zc-status').textContent.includes('connection restored'));assert.equal(calls.length,n);
      await click('#zc-review-check');assert.equal(await p.locator('#zc-review-details').textContent(),detail);
      assert(!calls.some(r=>/\/sign$|\/send$|\/refresh$/.test(r.url)));
    });
    if(!live)await check('forged fee and send-enabled responses do not replace the earlier review',async()=>{
      for(const changed of [{...sample,fee:'10001'},{...sample,canSend:true},{...sample,recipient:'a'},{...sample,wallet:'b'}]){reply={review:changed};await click('#zc-review-check');assert((await p.locator('#zc-review-status').innerText()).includes('may be out of date'));assert.equal(await p.locator('#zc-review-details').textContent(),detail);}reply={review:sample};
    });
    if(effects){
      await check('local output verification is explicit, bound to this review and keeps signing unavailable',async()=>{
        const verified={status:'verified',version:6,pool:'ironwood',amount:sample.amount,fee:sample.fee,change:sample.change,inputValue:'89990000',recipient:address,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:true,canSign:false,canSend:false,checkedAt:new Date().toISOString()};
        if(!live)reply={review:{...sample,effects:verified}};
        const response=p.waitForResponse(r=>r.url().endsWith('/api/zcash/review-effects'));
        await click('#zc-review-effects');const body=await(await response).json();effectChecks.push(body.review?.effects??body);
        assert.equal(body.review?.effects?.status,'verified');
        assert((await p.locator('#zc-review-ownership').innerText()).includes('Change belongs to the sending wallet'));
        assert((await p.locator('#zc-review-ownership').innerText()).includes('Encrypted payment and change match'));
        assert((await p.locator('#zc-review-ownership').innerText()).includes('signing and sending remain unavailable'));
        assert.deepEqual(Object.keys(calls.at(-1).body).sort(),['id','wallet']);
        const n=calls.length;await p.reload();await ready();assert.equal(calls.length,n);
        await click('#zc-review-check');assert((await p.locator('#zc-review-ownership').innerText()).includes('Change belongs'));
        if(!live)for(const theme of ['light','dark']){
          await p.evaluate(t=>{localStorage.setItem('lenz-home-theme',t);dispatchEvent(new StorageEvent('storage',{key:'lenz-home-theme',newValue:t}));},theme);
          assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme);
          for(const[width,height]of[[375,812],[812,375],[1280,1000]]){await p.setViewportSize({width,height});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
          await p.setViewportSize({width:375,height:812});await p.locator('#zc-review-result').screenshot({path:path.join(reportDirectory,'evidence/zcash-effects-'+theme+'.png')});
        }
      });
      if(!live)await check('forged ownership, changed terms or request IDs invalidate the output result',async()=>{
        const good=structuredClone(reply.review);
        for(const altered of [{...good,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},...[
          {changeOwned:false},{amount:'2'},{fee:'1'},{change:'1'},{inputValue:'1'},{recipient:'foreign'},{canSign:true},{noteEncryptionVerified:undefined},{noteEncryptionVerified:'true'}
        ].map(x=>({...good,effects:{...good.effects,...x}}))]) {
          reply={review:altered};await click('#zc-review-effects');
          assert((await p.locator('#zc-review-ownership').innerText()).includes('did not complete'));
          assert.equal(await p.locator('#zc-review-details').textContent(),detail);
        }
        reply={review:{...good,effects:{status:'unavailable',checkedAt:new Date().toISOString()}}};
        await click('#zc-review-check');assert((await p.locator('#zc-review-ownership').innerText()).includes('last output check failed'));
      });
      if(!live)await check('older saved output checks stay reviewable without claiming encryption validation',async()=>{
        const legacy={status:'verified',version:6,pool:'ironwood',amount:sample.amount,fee:sample.fee,change:sample.change,inputValue:'89990000',recipient:address,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:false,canSign:false,canSend:false,checkedAt:new Date().toISOString()};
        reply={review:{...sample,effects:legacy}};await click('#zc-review-check');
        assert((await p.locator('#zc-review-ownership').innerText()).includes('Encrypted outputs have not been checked'));
        assert.equal(await p.locator('#zc-review-details').textContent(),detail);
        assert.equal(await p.locator('#zc-review-heading').innerText(),'Not signed or sent');
      });
    }
    if(freshness){
      await check('expiry checks require an explicit online action for the displayed request',async()=>{
        const n=calls.length;await context.setOffline(true);await p.waitForFunction(()=>!navigator.onLine);assert(await p.locator('#zc-review-network').isDisabled());
        await context.setOffline(false);await p.waitForFunction(()=>navigator.onLine);assert.equal(calls.length,n);
        if(!live)reply={review:{...sample,freshness:{status:'expired',checkedAt:new Date().toISOString(),serverHeight:200,walletHeight:100,expiryHeight:150,targetHeight:201,branchMatches:true,blocksRemaining:0}}};
        const response=p.waitForResponse(r=>r.url().endsWith('/api/zcash/review-check'));
        await click('#zc-review-network');const body=await(await response).json();networkChecks.push(body.review?.freshness??body);
        assert((await p.locator('#zc-review-freshness').innerText()).includes('Signing and sending remain unavailable'));
        if(!live)assert((await p.locator('#zc-review-freshness').innerText()).includes('expired'));
        assert(calls.at(-1).body.id);assert.equal(calls.at(-1).body.wallet,'a');assert.deepEqual(Object.keys(calls.at(-1).body).sort(),['id','wallet']);
        assert.equal(await p.locator('#zc-review-heading').innerText(),'Not signed or sent');
      });
      if(!live)await check('network lag is visible and forged success or failed checks invalidate the previous message',async()=>{
        const observed={status:'wallet-behind',checkedAt:new Date().toISOString(),serverHeight:200,walletHeight:100,expiryHeight:300,targetHeight:201,branchMatches:true,blocksRemaining:100};
        reply={review:{...sample,freshness:observed}};await click('#zc-review-network');assert((await p.locator('#zc-review-freshness').innerText()).includes('behind the network'));
        for(const changed of [{...observed,status:'within-expiry'},{...observed,targetHeight:200},{...observed,expiryHeight:0}]){
          reply={review:{...sample,freshness:changed}};await click('#zc-review-network');assert((await p.locator('#zc-review-freshness').innerText()).includes('did not complete'));
        }
        reply={error:'Provider unavailable'};await click('#zc-review-network');assert((await p.locator('#zc-review-freshness').innerText()).includes('did not complete'));
        reply={review:{...sample,freshness:{status:'unavailable',checkedAt:new Date().toISOString()}}};await click('#zc-review-check');assert((await p.locator('#zc-review-freshness').innerText()).includes('last check failed'));
      });
    }
    await check('review fits narrow, landscape and enlarged text and creates no Lenz identity',async()=>{
      for(const [width,height]of [[375,812],[812,375],[1280,1000]]){await p.setViewportSize({width,height});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      await p.setViewportSize({width:375,height:812});await p.addStyleTag({content:'html{font-size:125%}'});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(await p.evaluate(()=>indexedDB.databases()),[]);assert.deepEqual(errors,[]);
      await p.screenshot({path:path.join(reportDirectory,'evidence/zcash-'+(effects?'effects':freshness?'freshness':'review')+'-'+(live?'live':'fixture')+'.png'),fullPage:true});
    });
    await check('explicit discard clears only the unsigned review and never sends',async()=>{
      if(!live)reply={review:null};await click('#zc-review-discard');assert(await p.locator('#zc-review-result').isHidden());assert((await p.locator('#zc-review-status').innerText()).includes('No funds were sent'));assert(!calls.some(r=>/\/sign$|\/send$/.test(r.url)));
    });
    await fs.writeFile(path.join(reportDirectory,'zcash-'+(effects?'effects':freshness?'freshness':'review')+'-'+(live?'live':'browser')+'-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),ok:true,checks,requests:calls,networkChecks,...(effects?{effectChecks}:{}),details:detail,errors,scope:live?'Actual pinned native unsigned PCZT preparation and local review in isolated Edge. No proof, real-input signature, broadcast, synchronization or existing browser identity access. Expiry mode explicitly reads the provider height.':'Fixture native responses with actual browser interaction; no chain or native wallet activity.'},null,2)+'\n');
  }finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);if(server)server.close();process.exitCode=1;});
