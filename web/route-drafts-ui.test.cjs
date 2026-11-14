const {chooseTheme}=require('./theme-test-ui.cjs');
const fixtureSource=(s,input)=>s.provider===input.provider&&s.chainId===(input.provider==='hyperliquid'?'hypercore:testnet':({base:'eip155:8453',ethereum:'eip155:1',arbitrum:'eip155:42161'})[input.network??'base']);
// Real browser, static product files and fixture public APIs. No financial endpoints.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {securityHeaders}=require('./security-policy.mjs');
async function run({overrides={},filter,record=true}={}){
  const root=path.join(__dirname,'public'),{quoteMarket}=await import(pathToFileURL(path.join(__dirname,'../integrations/market-quotes.mjs'))),{quoteMock}=await import(pathToFileURL(path.join(__dirname,'../integrations/market-quote-fixtures.mjs')));
  const templates=JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8')).results.map(r=>r.observation),hl=templates.find(s=>s.provider==='hyperliquid'),eth=hl.rows.find(r=>r.instrument==='ETH');eth.id='hyperliquid:0:ETH';eth.venueIndex=0;eth.sizeDecimals=3;hl.rows=[eth];
  const {tapeFixtures}=await import(pathToFileURL(path.join(__dirname,'../integrations/market-tape-fixtures.mjs')));
  let browser,mode='normal',release,latestQuote,requests=[],unexpected=[];const checks=[],errors=[],missing=[];
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),name=url.pathname;for(const [k,v]of Object.entries(securityHeaders(name)))res.setHeader(k,v);
      if(name.startsWith('/api/')){
        let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);requests.push({path:name,input});
        if(name==='/api/markets/read'){const value=structuredClone(templates.find(s=>fixtureSource(s,input)));value.observedAt=Date.now();value.expiresAt=value.observedAt+60000;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;}
        if(name==='/api/markets/tape'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(tapeFixtures(input).snapshot));return;}
        if(name==='/api/markets/quote'){
          const active=mode;if(active==='defer')await new Promise(r=>release=r);if(active==='fail'){res.writeHead(503);res.end();return;}
          const quote=structuredClone(await quoteMarket(input,quoteMock()));quote.observedAt=Date.now();quote.sourceTime=quote.observedAt-500;quote.expiresAt=quote.observedAt+29000;
          if(active==='mismatch')quote.request.amount='999';latestQuote=quote;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(quote));return;
        }
        unexpected.push(name);res.writeHead(403);res.end();return;
      }
      const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep))throw Error('Invalid path');
      const body=Object.hasOwn(overrides,name.slice(1))?overrides[name.slice(1)]:await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.mp4':'video/mp4','.webp':'image/webp'}[path.extname(file)]??'application/octet-stream'));res.end(body);
    }catch{missing.push(req.url);res.writeHead(404);res.end();}
  });
  const base=()=>`http://127.0.0.1:${server.address().port}`;
  async function seed(page){await page.evaluate(async()=>{const p=await import('/peer-crypto.js'),s=await import('/chat-store.js');await s.updateState(async state=>{state.identity=await p.createIdentity('Draft reader');state.contacts=[{name:'Keep contact'}];state.messages=[{text:'Keep history'}];state.nearBox={iv:'keep',ciphertext:'keep-reservation'};});});}
  const snapshot=page=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const drafts=page=>page.evaluate(async()=>await(await import('/defi-route-drafts.js')).listRouteDrafts());
  async function quote(page,perp=false){
    await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','off'));await page.goto(base()+'/markets.html');await page.waitForFunction(()=>document.querySelector('#home-cache-status').dataset.offlineState==='ready'||document.querySelector('#home-cache-status').textContent.startsWith('Page available offline'));
    await page.locator('#refresh-markets').click();await page.waitForFunction(()=>!document.querySelector('#refresh-markets').disabled);
    await page.locator(perp?'[data-market-id="hyperliquid:0:ETH"]':'[data-market-id="uniswap:0xd0b53d9277642d899df5c87a3966a349a798f224"]').click();
    await page.locator('#quote-amount').fill(perp?'1.5':'2');await page.locator('#quote-public').check();await page.locator('#quote-amount').press('Enter');await page.locator('#quote-save-draft').waitFor();
  }
  async function form(page,perp=false){
    await page.locator('#quote-save-draft').click();await page.locator('#draft-address').fill('0x'+'44'.repeat(20));await page.locator('#draft-fee').fill('0.002');
    if(perp){await page.locator('#draft-collateral').fill('25');await page.locator('#draft-leverage').selectOption('2');await page.locator('#draft-reduce').check();}
  }
  async function save(page,perp=false){await quote(page,perp);await form(page,perp);await page.locator('#draft-public').check();await page.locator('#draft-save').click();await page.locator('#open-saved-drafts').waitFor();await page.locator('#open-saved-drafts').click();await page.locator('.route-row').waitFor();await page.waitForFunction(()=>document.querySelector('#route-cache-status').dataset.offlineState==='ready'||document.querySelector('#route-cache-status').textContent.startsWith('Drafts available offline'));}
  async function check(name,fn){if(filter&&!name.startsWith(filter))return;mode='normal';release=null;requests=[];unexpected=[];const context=await browser.newContext({viewport:{width:1360,height:1100}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    try{await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','off'));await page.goto(base()+'/markets.html');await seed(page);await fn({page,context});assert.deepEqual(unexpected,[]);assert(requests.every(r=>Object.keys(r.input).every(k=>!['recipient','address','wallet'].includes(k))));checks.push({name,pass:true});console.log('PASS '+name);}
    catch(e){console.error({name,missing,errors,cache:await page.locator('#home-cache-status').textContent({timeout:1000}).catch(()=>null)});throw e;}finally{release?.();await context.close();}
  }
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});
    await check('public route consent is separate and cancel preserves wallet state',async({page})=>{
      await quote(page);const before=await snapshot(page);await form(page);assert.equal(await page.locator('#draft-public').isChecked(),false);assert(await page.locator('#draft-save').isDisabled());await page.locator('#draft-form').evaluate(f=>f.requestSubmit());assert.deepEqual(await drafts(page),[]);for(let i=0;i<12;i++){await page.keyboard.press('Tab');if(!await page.evaluate(()=>document.hasFocus()))await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('#draft-review').contains(document.activeElement)));}await page.keyboard.press('Escape');assert.equal(await page.locator('#draft-review').count(),0);assert(await page.locator('#quote-save-draft').evaluate(n=>n===document.activeElement));assert.equal(await snapshot(page),before);
    });
    await check('saved swap uses exact terms and double clicks create one encrypted draft',async({page})=>{
      await quote(page);const before=JSON.parse(await snapshot(page));await form(page);await page.locator('#draft-public').check();await page.locator('#draft-save').evaluate(b=>{b.click();b.click();});await page.locator('#open-saved-drafts').waitFor();const rows=await drafts(page);assert.equal(rows.length,1);assert.equal(rows[0].objective.source.amount,'2000000');assert.equal(rows[0].objective.limits.maxFees[0].amount,'2000000000000000');assert.equal(rows[0].objective.privacy,'transparent');assert.equal(rows[0].executable,false);assert.equal(rows[0].revision,1);
      const after=JSON.parse(await snapshot(page));assert(!JSON.stringify(after).includes('0x'+'44'.repeat(20)));delete after.routeDraftKey;delete after.routeDraftBox;assert.deepEqual(after,before);
    });
    await check('failed writes and expired review save neither objective nor quote',async({page})=>{
      await quote(page);const before=await snapshot(page);await form(page);await page.locator('#draft-public').check();await page.evaluate(()=>{window.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};});await page.locator('#draft-save').click();await page.waitForFunction(()=>document.querySelector('#draft-review-status').textContent.includes('could not'));await page.evaluate(()=>IDBObjectStore.prototype.put=put);assert.equal(await snapshot(page),before);
      await page.evaluate(expiry=>{window.clock=Date.now;Date.now=()=>expiry;},latestQuote.expiresAt);await page.waitForFunction(()=>document.querySelector('#draft-save').disabled);await page.locator('#draft-form').evaluate(f=>f.requestSubmit());assert.deepEqual(await drafts(page),[]);await page.evaluate(()=>Date.now=clock);assert.equal(await snapshot(page),before);
    });
    await check('Hyperliquid draft keeps order size separate from collateral and fits both themes',async({page})=>{
      await save(page,true);const [row]=await drafts(page);assert.equal(row.objective.source.amount,'25000000');assert.equal(row.objective.destination.order.size,'1500');assert.equal(row.objective.destination.order.maxLeverage,2);assert.equal(row.objective.destination.order.reduceOnly,true);
      for(const theme of ['light','dark']){if(theme==='dark')await chooseTheme(page,'dark');for(const [width,height]of [[320,740],[390,844],[844,390],[1360,1100]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),theme+' overflow '+width);}if(record)await page.screenshot({path:path.join(__dirname,`evidence/routes-${theme}.png`),fullPage:true});}
      await page.setViewportSize({width:390,height:844});if(record)await page.screenshot({path:path.join(__dirname,'evidence/routes-phone.png'),fullPage:true});assert((await page.locator('#route-detail').innerText()).includes('Fees, margin and account checks pending.'));
    });
    await check('offline reload retains drafts and expiry without network or wallet changes',async({page,context})=>{
      await save(page);const before=await snapshot(page),count=requests.length;await context.setOffline(true);await page.reload();await page.locator('.route-row').waitFor();assert(await page.locator('#refresh-draft-quote').isDisabled());assert.equal(await snapshot(page),before);assert.equal(requests.length,count);
      await page.evaluate(async()=>{const [row]=await(await import('/defi-route-drafts.js')).listRouteDrafts();window.clock=Date.now;Date.now=()=>row.estimate.quote.expiresAt;});await page.waitForFunction(()=>document.querySelector('.route-state').textContent==='Estimate expired');assert.equal(await snapshot(page),before);await page.evaluate(()=>Date.now=clock);
    });
    await check('refresh requires consent and discards revoked, failed and mismatched replies',async({page})=>{
      await save(page);assert.equal(await page.locator('#draft-quote-public').isChecked(),false);assert(await page.locator('#refresh-draft-quote').isDisabled());const before=await snapshot(page);await page.evaluate(()=>{window.originalFetch=fetch;window.replyRead=false;window.fetch=async(url,options)=>{const response=await originalFetch(url,{...options,signal:undefined}),read=response.text.bind(response);response.text=async()=>{const result=await read();window.replyRead=true;return result;};return response;};});await page.locator('#draft-quote-public').check();mode='defer';await page.locator('#refresh-draft-quote').click();while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#draft-quote-public').uncheck();release();release=null;await page.waitForFunction(()=>window.replyRead);await page.evaluate(()=>window.fetch=originalFetch);assert.equal(await snapshot(page),before);
      for(const failure of ['fail','mismatch']){mode=failure;await page.locator('#draft-quote-public').check();await page.locator('#refresh-draft-quote').click();await page.waitForFunction(()=>!document.querySelector('#refresh-draft-quote').disabled);assert.equal(await snapshot(page),before);}
      mode='normal';await page.locator('#refresh-draft-quote').click();await page.waitForFunction(()=>document.querySelector('#route-action-status').textContent.includes('Estimate saved'));assert.equal((await drafts(page))[0].revision,2);assert.equal(await page.locator('#draft-quote-public').isChecked(),false);
    });
    await check('changed market terms cannot save the still-open review',async({page})=>{
      await quote(page);const before=await snapshot(page);await form(page);await page.locator('#draft-public').check();await page.locator('#quote-amount').evaluate(n=>{n.value='3';n.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#draft-save').disabled);await page.locator('#draft-form').evaluate(f=>f.requestSubmit());assert.deepEqual(await drafts(page),[]);assert.equal(await snapshot(page),before);
    });
    await check('another tab deleting a draft prevents a late refresh from restoring it',async({page,context})=>{
      await save(page);const b=await context.newPage();await b.goto(page.url());await b.locator('.route-row').waitFor();await page.locator('#draft-quote-public').check();mode='defer';await page.locator('#refresh-draft-quote').click();while(!release)await new Promise(r=>setTimeout(r,10));await b.locator('#delete-draft').click();await b.waitForFunction(()=>document.querySelectorAll('.route-row').length===0);release();release=null;await page.waitForFunction(()=>document.querySelector('#route-action-status').textContent.includes('Draft changed'));assert.deepEqual(await drafts(page),[]);await page.locator('#reload-drafts').click();await page.waitForFunction(()=>document.querySelectorAll('.route-row').length===0);assert((await snapshot(page)).includes('keep-reservation'));
    });
    await check('older private drafts retain exact amounts and chain labels',async({page})=>{
      await page.evaluate(async()=>{
        const asset={chainId:'near:mainnet',kind:'native',id:'native',decimals:36};
        await(await import('/defi-route-drafts.js')).saveRouteDraft({id:'older-rhea',source:{asset,amount:'1'},destination:{marketId:'rhea',chainId:'near:mainnet',action:'swap',outputAsset:asset},recipient:{chainId:'near:mainnet',address:'reader.near'},limits:{deadline:Date.now()+3600000,minReceive:'1',maxFees:[{asset,amount:'1'+'0'.repeat(77)}]},privacy:'private',returnTo:null});
      });
      await page.goto(base()+'/routes.html');await page.locator('.route-row').waitFor();const text=await page.locator('#route-detail').innerText();assert(text.includes('Rhea · NEAR'));assert(text.includes('0.'+'0'.repeat(35)+'1'));assert(text.includes('1'+'0'.repeat(41)+' NEAR'));assert(!text.includes('ETH'));assert(!text.includes('Trading address'));assert(text.includes('Private transfer required'));assert.equal(await page.locator('#refresh-draft-quote').count(),0);
    });
    await check('review reflows in both themes with large text and reduced motion',async({page})=>{
      await quote(page,true);await form(page,true);await page.emulateMedia({reducedMotion:'reduce'});
      for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const [width,height]of [[1360,1100],[375,812],[844,390]]){await page.setViewportSize({width,height});assert(await page.locator('#draft-review').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.locator('#draft-public').focus();assert(await page.locator('#draft-public').evaluate(n=>{const b=n.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}),JSON.stringify({theme,width,height,bounds:await page.locator('#draft-public').boundingBox()}));if(record&&width!==844)await page.locator('#draft-review').screenshot({path:path.join(__dirname,`evidence/draft-review-${theme}-${width}.png`)});}}
      await page.setViewportSize({width:375,height:812});await page.evaluate(()=>{const nodes=[...document.querySelectorAll('#draft-review *')].map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);for(const[n,size]of nodes)n.style.fontSize=(size*2)+'px';});assert(await page.locator('#draft-review').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.locator('#draft-address').focus();await page.locator('#draft-public').focus();assert(await page.locator('#draft-public').evaluate(n=>{const b=n.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}));
    });
    await check('unreadable storage never reports that saved drafts are absent',async({page})=>{
      await save(page);await page.evaluate(async()=>{await(await import('/chat-store.js')).updateState(s=>{s.routeDraftBox.ciphertext='00';});});const before=await snapshot(page);await page.locator('#reload-drafts').click();await page.waitForFunction(()=>document.querySelector('#draft-list-status').textContent.includes('could not be read'));assert(!(await page.locator('#main').innerText()).includes('No saved drafts'));assert.equal(await snapshot(page),before);
    });
    assert.deepEqual(errors,[]);assert(checks.length>0);const sourceFiles={};
    for(const f of ['web/public/workspace-layout.css','web/route-drafts-ui.test.cjs','web/public/markets.html','web/public/market-quote-ui.js','web/public/route-draft-form.js','web/public/route-draft-ui.js','web/public/defi-route-drafts.js','web/public/routes.html','web/public/routes.css','web/public/defi-surfaces.css','web/public/routes.js','web/public/sw.js','web/public/chat-sw.js'])sourceFiles[f]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',f))).digest('hex');
    const report={checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sourceFiles,scope:'Disposable Windows Edge with real service workers/IndexedDB/WebCrypto and fixture public APIs. No user profile, live transaction, signing, reservation or physical-device test.'};if(record)await fs.writeFile(path.join(__dirname,'route-drafts-ui-results.json'),JSON.stringify(report,null,2)+'\n');return report;
  }finally{release?.();await browser?.close();await new Promise(r=>server.close(r));}
}
module.exports={run};if(require.main===module)run().then(r=>console.log(JSON.stringify({passed:r.passed}))).catch(e=>{console.error(e);process.exitCode=1;});
