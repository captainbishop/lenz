// Actual Wallet and bundled Meteor adapter in disposable Edge. All financial and wallet responses are synthetic.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs'),{openWalletSection}=require('./wallet-test-ui.cjs');
const c={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function run({filter,overrides={}}={}){
  const results=[],errors=[],browser=await chromium.launch({channel:'msedge',headless:true});
  const server=http.createServer(async(req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
    res.setHeader('Cache-Control','no-store');
    if(file.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
    if(file.endsWith('-config.json')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(file==='/near-config.json'?{network:'testnet',contract:c.reserve,ready:true}:file==='/rhea-config.json'?c:{version:1,carriers:[],relays:[]}));return;}
    const target=path.resolve(__dirname,'public','.'+file);
    if(!target.startsWith(path.resolve(__dirname,'public')+path.sep)){res.writeHead(404);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]??'application/octet-stream');res.end(overrides[file.slice(1)]??await fs.readFile(target));}catch{res.writeHead(404);res.end();}
  });
  const idle=page=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  async function boot(page,base,lab){await page.goto(base+(lab?'/wallet-lab.html':'/money.html'));try{await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.',{},{timeout:10000});}catch(error){error.message+='; status='+await page.locator('#status').innerText()+'; errors='+JSON.stringify(errors);throw error;}}
  async function check(name,lab,fn){
    if(filter&&!name.startsWith(filter))return;
    const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'}),page=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
    page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
    try{
      await boot(page,base,lab);
      const seeded=await page.evaluate(async c=>{
        const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),p=await import('/peer-crypto.js'),w=await import('/defi-wallet.js'),executor=await p.createIdentity('Bola');
        await store.updateState(async s=>{s.identity=await p.createIdentity('Amina');s.contacts=[executor.profile];const vault=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'10');vault.roots.push({id:f.id,owner:f.owner,amount:f.amount});await n.saveNearVault(s,vault);});
        const ref=await w.approveDefiSwap(c,executor.profile,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:Date.now()+600000},{approvalId:'a'.repeat(32),disclosure:'lenz/disclosure/public-near-executor/v1',expiresAt:Date.now()+600000});
        const s=await store.readState(),vault=await n.readNearVault(s,c.reserve);return {ref,packet:vault.rheaOrders[0].packet};
      },c);
      const order={id:seeded.packet.id,instruction:seeded.packet.instruction,stage:'refunded',output:'0',reason:''};let backed=false,reads=0;
      await page.route('**/api/defi/rhea/status',route=>route.fulfill({json:{requestId:seeded.ref.requestId,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order}}}));
      await page.route('**/api/defi/rhea/refund-status',route=>{
        reads++;const {deposit}=route.request().postDataJSON();return route.fulfill({json:{requestId:seeded.ref.requestId,depositId:deposit.id,state:backed?'observed':'ready',observation:{finality:'FINAL',block:{height:20,hash:'5'.repeat(32)},order,deposit:backed?{root:{id:deposit.id,owner:deposit.owner,amount:deposit.amount},spent:null}:null}}});
      });
      const snapshot=()=>page.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),n=await import('/near-protocol.js'),vault=await n.readNearVault(s,c.reserve),ledger=await n.nearLedger(vault);return {vault,available:ledger.available.filter(x=>x.owner===n.compressed(s.identity.profile.signingPublic)).reduce((sum,x)=>sum+BigInt(x.amount),0n).toString(),reserved:[...ledger.reserved]};},c);
      await boot(page,base,lab);await openWalletSection(page,'defi');await page.getByRole('button',{name:'Check swap',exact:true}).click();await idle(page);
      await fn({page,context,base,snapshot,back:()=>backed=true,reads:()=>reads,boot:()=>boot(page,base,lab)});
      results.push(name);console.log('PASS '+name);
    }finally{await context.close();}
  }
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await check('Wallet prepares and checks a saved refund without a signer and shows returned value once',false,async({page,context,snapshot,back,reads,boot})=>{
      const before=await snapshot();assert.equal(await page.locator('#rhea-orders .near-state').innerText(),'Refund in receiving wallet');
      await page.getByRole('button',{name:'Prepare return',exact:true}).click();await idle(page);
      assert(await page.locator('#defi-refund-review').isVisible());assert.match(await page.locator('[data-refund-terms]').innerText(),/4 tUSD from receiver.testnet/);assert(await page.locator('[data-refund-sign]').isHidden());
      const saved=await snapshot();assert(saved.vault.rheaOrders[0].returnRequest);assert.equal(saved.available,'6000000');await page.locator('[data-refund-close]').click();
      await page.getByRole('button',{name:'Check return',exact:true}).click();await idle(page);assert.equal((await snapshot()).available,'6000000');
      await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('[data-rhea-online]')?.disabled);assert(await page.getByRole('button',{name:'Check return',exact:true}).isDisabled());assert.equal(reads(),1);await context.setOffline(false);
      back();await page.getByRole('button',{name:'Check return',exact:true}).click();await idle(page);assert.equal(await page.locator('#rhea-orders .near-state').innerText(),'Refund returned to Lenz');
      await boot();await openWalletSection(page,'defi');await page.getByRole('button',{name:'Check return',exact:true}).click();await idle(page);
      const after=await snapshot();assert.equal(after.available,'10000000');assert.deepEqual(after.reserved,before.reserved);assert.equal(after.vault.roots.filter(r=>r.id===saved.vault.rheaOrders[0].returnRequest.id).length,1);
      assert.equal(await page.getByRole('button',{name:'Review return',exact:true}).count(),0);assert.equal(context.pages().length,1);
    });
    await check('developer Wallet signs only after fresh review and a durable attempt, then checks independent backing',true,async({page,context,base,snapshot,back})=>{
      let signCalls=0;
      await page.evaluate(()=>localStorage.setItem('lenz-meteor-testnet-v1:accountId','receiver.testnet'));
      await context.route('https://test.rpc.fastnear.com/**',route=>route.fulfill({json:{result:{header:{hash:'1'.repeat(32)}}}}));
      await context.exposeBinding('refundFixture',async(source,data)=>{
        assert.equal(new URL(source.page.url()).origin,'https://wallet.meteorwallet.app');assert.equal(data.actionType,'sign');signCalls++;
        const saved=(await snapshot()).vault.rheaOrders[0];assert(saved.returnRequest);assert(saved.defi.refundAttempt);assert.equal(saved.defi.refundReview,undefined);
        const {createRequire}=require('node:module'),near=createRequire(path.join(__dirname,'../contracts/package.json'))('near-api-js'),tx=near.decodeTransaction(Buffer.from(data.inputs.transactions,'base64'));
        assert.equal(tx.signerId,'receiver.testnet');assert.equal(tx.receiverId,c.reserve);assert.equal(tx.actions.length,1);const a=tx.actions[0].functionCall;assert.equal(a.methodName,'deposit_offline');assert.equal(String(a.deposit),'30000000000000000000000');assert.equal(String(a.gas),'50000000000000');
        assert.deepEqual(JSON.parse(Buffer.from(a.args).toString()),{owner:saved.returnRequest.owner,amount:'4000000',source:saved.returnRequest.source,signature:saved.returnRequest.signature});
      });
      await context.route('https://wallet.meteorwallet.app/**',route=>{
        const url=new URL(route.request().url());return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Synthetic wallet</title><script>let handled=false;const uid=${JSON.stringify(url.searchParams.get('connectionUid'))},origin=${JSON.stringify(base)};addEventListener('message',async e=>{if(handled||e.origin!==origin||e.source!==opener||e.data.uid!==uid||e.data.status!=='initializing')return;handled=true;await refundFixture(e.data);opener.postMessage({uid,status:'closed_fail'},origin);});</script>`});
      });
      await page.getByRole('button',{name:'Prepare return',exact:true}).click();await idle(page);assert.equal(signCalls,0);
      await page.locator('[data-refund-sign]').click();await page.waitForFunction(()=>document.querySelector('#defi-refund-review .wallet-feedback').textContent.includes('stays saved'));await idle(page);
      assert.equal(signCalls,1);assert(await page.locator('[data-refund-sign]').isDisabled());assert.equal((await snapshot()).available,'6000000');
      await page.locator('[data-refund-close]').click();back();await page.getByRole('button',{name:'Check return',exact:true}).click();await idle(page);
      assert.equal(signCalls,1);assert.equal((await snapshot()).available,'10000000');assert.equal(await page.locator('#rhea-orders .near-state').innerText(),'Refund returned to Lenz');
    });
    assert.deepEqual(errors,[]);return {passed:results.length,results};
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
module.exports={run};if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
