const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const c={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',ready:true,recoverRedemption:true};
const checks=[],errors=[];let fixture;
const server=http.createServer(async(req,res)=>{try{
  const file=req.url.split('?')[0];
  if(file==='/near-config.json'||file==='/rhea-config.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(file.startsWith('/near-')?{network:'testnet',contract:c.reserve,ready:true}:c));return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  res.end(await fs.readFile(path.join(__dirname,'public',file)));
}catch{res.writeHead(404);res.end('missing');}});
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');}
async function open(p){await p.goto(base+'/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');}
let base;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await open(p);
    await p.locator('#wallet-name').fill('Rhea disposable');await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);
    const identity=await p.evaluate(async c=>{const {updateState}=await import('/chat-store.js');const n=await import('/near-protocol.js');return updateState(async s=>{const v=n.emptyNearVault(c.reserve),r=await n.fundingRequest(s.identity,c.reserve,'10');v.roots.push({id:r.id,owner:r.owner,amount:r.amount});await n.saveNearVault(s,v);return s.identity.profile.id;});},c);
    await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='10');
    await check('everyday wallet hides technical import, transaction export and experimental signer controls',async()=>{
      const text=await p.locator('body').innerText();assert(!text.includes('Carry a signed swap'));assert(!text.includes('Deposit transaction details'));assert.equal(await p.locator('#rhea-file').count(),0);assert.equal(await p.locator('#near-signer-connect').isVisible(),false);assert(await p.getByRole('button',{name:'New swap',exact:true}).isVisible());
    });
    await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);
    await check('swap screen loads offline with explicit minimum, refund account and public-terms notice',async()=>{
      await context.setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='10');
      await p.locator('#rhea-open').click();await p.locator('#rhea-dialog').waitFor();await p.locator('#rhea-privacy').selectOption('public-testnet');await p.locator('.dex-details summary').click();assert(await p.locator('#rhea-receiver').isVisible());assert(await p.getByText('The amount and receiving wallet are public on the test network.',{exact:false}).isVisible());
      await p.locator('#rhea-minimum').fill('0.0001');await p.locator('#rhea-receiver').fill('alice.testnet');
    });
    await check('failed encrypted-vault commit exposes no signed swap and leaves full balance available',async()=>{
      await p.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw new Error('Swap storage failed');};});
      await p.locator('#rhea-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#rhea-dialog .wallet-feedback').textContent.includes('could not save'));await idle(p);
      assert.equal(await p.locator('#near-total').innerText(),'10');assert.equal(await p.locator('#rhea-orders article').count(),0);await p.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut;});
    });
    await check('offline signing reserves one tUSD and exports a verifiable browser signature',async()=>{
      await p.locator('#rhea-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='9');await idle(p);
      const download=p.waitForEvent('download');await p.getByRole('button',{name:'Share swap request',exact:true}).click();const packet=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
      const result=await p.evaluate(async({c,packet})=>({id:await(await import('/rhea-protocol.js')).checkRheaPacket(c,packet),now:Date.now()}),{c,packet});assert.equal(result.id,packet.id);fixture={...result,packet};
      await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='9');assert(await p.getByText('Saved · money set aside',{exact:true}).isVisible());
    });
    await check('receipt checking preserves reservations and identity across failure, reload and forged responses',async()=>{
      await context.setOffline(false);let reply={finality:'FINAL',order:{id:fixture.packet.id,instruction:fixture.packet.instruction,stage:'attention'},reconciliation:{state:'needs_review',finality:'FINAL',txHash:'1'.repeat(32),failedReceipts:[{failure:'RAW_CALLBACK_FAILURE'}]}};
      await p.route('**/api/rhea/order',route=>route.fulfill({json:reply}));
      await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);assert((await p.locator('#rhea-feedback').innerText()).includes('money is still set aside'));assert.equal(await p.locator('#near-total').innerText(),'9');assert(!(await p.locator('body').innerText()).includes('RAW_CALLBACK_FAILURE'));
      await p.reload();await p.getByText('Swap needs checking',{exact:true}).waitFor();
      const saved=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,c.reserve);return {id:s.identity.profile.id,o:v.rheaOrders[0]};},c);assert.equal(saved.id,identity);assert.equal(saved.o.reconciliation.state,'needs_review');assert.equal(saved.o.txHash,'1'.repeat(32));
      reply={...reply,reconciliation:{state:'unavailable'}};await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);assert((await p.locator('#rhea-feedback').innerText()).includes('could not be verified'));assert.equal(await p.locator('#near-total').innerText(),'9');
      reply={...reply,order:{...reply.order,instruction:{...reply.order.instruction,amount:'9999999'}}};await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);assert((await p.locator('#rhea-feedback').innerText()).includes('could not verify'));assert.equal(await p.locator('#near-total').innerText(),'9');await p.unroute('**/api/rhea/order');await context.setOffline(true);
    });
    await check('resume appears only for the supported stalled stage and never repeats a payment',async()=>{
      await context.setOffline(false);const calls=[];let finish;
      const original={id:fixture.packet.id,instruction:fixture.packet.instruction,stage:'redeeming'};
      await p.route('**/api/rhea/**',async route=>{
        const method=new URL(route.request().url()).pathname;calls.push({method,data:route.request().postDataJSON()});
        if(method==='/api/rhea/recover'){await new Promise(r=>finish=r);return route.fulfill({json:{finality:'FINAL',order:{...original,stage:'funded'}}});}
        assert.equal(method,'/api/rhea/order');return route.fulfill({json:{finality:'FINAL',order:original}});
      });
      assert.equal(await p.getByRole('button',{name:'Resume swap',exact:true}).count(),0);
      await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);
      const resume=p.getByRole('button',{name:'Resume swap',exact:true});assert(await resume.isVisible());assert.equal(await p.getByRole('button',{name:'Continue swap',exact:true}).count(),0);
      for(const [width,height] of [[375,812],[812,375]]){await p.setViewportSize({width,height});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      await p.screenshot({path:path.join(__dirname,'evidence/rhea-recovery.png'),fullPage:true});
      await resume.click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent==='Checking your saved payment…');
      const pending=p.getByRole('button',{name:'Checking payment…',exact:true});assert(await pending.isDisabled());assert.equal(await p.locator('main').getAttribute('aria-busy'),'true');
      await pending.evaluate(button=>button.click());await p.getByRole('button',{name:'Check status',exact:true}).click();assert.equal(calls.length,2);
      finish();await idle(p);assert.equal(await p.getByRole('button',{name:'Resume swap',exact:true}).count(),0);assert(await p.getByRole('button',{name:'Continue swap',exact:true}).isVisible());
      assert.deepEqual(calls.map(r=>r.method),['/api/rhea/order','/api/rhea/recover']);assert.deepEqual(calls[1].data,{adapter:c.adapter,id:fixture.packet.id});assert.equal(await p.locator('#near-total').innerText(),'9');
      await p.unroute('**/api/rhea/**');
    });
    await check('pending, interrupted and forged recovery replies keep the original reservation',async()=>{
      const original={id:fixture.packet.id,instruction:fixture.packet.instruction,stage:'redeeming'};let reply={finality:'FINAL',order:original},mode='ok',count=0;
      await p.route('**/api/rhea/order',route=>route.fulfill({json:{finality:'FINAL',order:original}}));
      await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);
      await p.route('**/api/rhea/recover',route=>{count++;return mode==='lost'?route.abort('connectionreset'):route.fulfill({json:reply});});
      for(const next of ['ok','lost','forged']){
        mode=next;if(mode==='forged')reply={...reply,order:{...original,instruction:{...original.instruction,receiver_id:'evil.testnet'}}};
        await p.getByRole('button',{name:'Resume swap',exact:true}).click();await idle(p);assert.equal(await p.locator('#near-total').innerText(),'9');assert(await p.getByRole('button',{name:'Resume swap',exact:true}).isEnabled());
        const saved=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,c.reserve);return {id:s.identity.profile.id,o:v.rheaOrders[0]};},c);
        assert.equal(saved.id,identity);assert.deepEqual(saved.o.packet,fixture.packet);assert.equal(saved.o.status.stage,'redeeming');assert.equal(saved.o.status.instruction.receiver_id,'alice.testnet');
      }
      assert.equal(count,3);await p.reload();await p.getByRole('button',{name:'Resume swap',exact:true}).waitFor();assert.equal(await p.locator('#near-total').innerText(),'9');
      await p.unroute('**/api/rhea/order');await p.unroute('**/api/rhea/recover');await context.setOffline(true);
    });
    await check('cached capability changes hide recovery without changing identity or reserved money',async()=>{
      await context.setOffline(false);
      for(const enabled of [false,true]){
        c.recoverRedemption=enabled;await p.locator('#prepare-money-offline').click();await idle(p);await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='9');
        assert.equal(await p.getByRole('button',{name:'Resume swap',exact:true}).count(),enabled?1:0);
        assert.equal(await p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.identity.profile.id;}),identity);
      }
      await context.setOffline(true);
    });
    await check('separate developer tools preserve offline packet import and bounded deposit export',async()=>{
      const tools=await context.newPage();await tools.goto(base+'/swap-tools.html');await tools.locator('#swap-file').setInputFiles({name:'swap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.packet))});await tools.waitForFunction(()=>document.querySelector('#tools-status').textContent.includes('Verified packet saved'));
      const count=await p.evaluate(async c=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js');return updateState(async s=>{const v=await n.readNearVault(s,c.reserve);v.rheaOrders[0].status={stage:'refunded'};await n.saveNearVault(s,v);return v.rheaOrders.length;});},c);assert.equal(count,1);
      await tools.reload();const download=tools.waitForEvent('download');await tools.getByRole('button',{name:/Export deposit action:/}).click();const action=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));assert.equal(action.network,'testnet');assert.equal(action.methodName,'deposit_offline');assert.equal(action.signerId,'alice.testnet');assert.equal(action.deposit,'30000000000000000000000');await tools.close();assert.equal(await p.locator('#near-total').innerText(),'9');
    });
    await check('two tabs cannot reserve the same remaining note',async()=>{
      const second=await context.newPage();await open(second);
      const attempt=page=>page.evaluate(async c=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),r=await import('/rhea-protocol.js');try{await updateState(async s=>{const value=await r.prepareRheaSwap(await n.readNearVault(s,c.reserve),s.identity,c,{text:'9',minOutput:'1',receiver:'alice.testnet',deadlineMs:Date.now()+3600000});await n.saveNearVault(s,value.vault);});return 'saved';}catch(e){return e.message;}},c);
      const results=await Promise.all([attempt(p),attempt(second)]);assert.equal(results.filter(r=>r==='saved').length,1);assert(results.some(r=>r.includes('No single available')));await second.close();
      await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='0');
      assert.equal(await p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.identity.profile.id;}),identity);
    });
    await check('swap controls reflow at desktop, portrait, landscape and enlarged text',async()=>{
      for(const [width,height] of [[1280,900],[375,812],[812,375]]){await p.setViewportSize({width,height});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      await p.setViewportSize({width:375,height:812});await p.locator('#rhea-open').click();await p.addStyleTag({content:'html{font-size:125%}'});
      assert(await p.evaluate(()=>document.querySelector('#rhea-dialog').scrollWidth<=document.querySelector('#rhea-dialog').clientWidth));
      await p.screenshot({path:path.join(__dirname,'evidence/rhea-swap-narrow.png'),fullPage:true});
    });
    assert.deepEqual(errors,[]);
    await fs.mkdir(path.join(__dirname,'../contracts/adapter/fixtures'),{recursive:true});await fs.writeFile(path.join(__dirname,'../contracts/adapter/fixtures/browser-swap.json'),JSON.stringify(fixture,null,2)+'\n');
    await fs.writeFile(path.join(__dirname,'rhea-wallet-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,scope:'Isolated Windows Edge. Fixture funding; actual offline signing, storage failure and concurrent tabs. No live swap in this suite.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
