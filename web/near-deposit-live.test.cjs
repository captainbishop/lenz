// Full failed-swap -> backed return -> offline onward -> NEAR settlement, in a disposable Edge profile.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const checks=[],transactions=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true',null,{timeout:300000});}
(async()=>{const c=JSON.parse(await fs.readFile(path.join(__dirname,'public/rhea-config.json'),'utf8'));assert(c.refundPayer);const {view}=await import('../contracts/client.mjs');
const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  p.on('response',async r=>{if(r.url().includes('/api/'))try{const x=await r.json();if(x.txHash)transactions.push({action:r.url().split('/').at(-1),txHash:x.txHash,stage:x.order?.stage});}catch{}});
  await p.goto('http://127.0.0.1:4173/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  await p.locator('#wallet-name').fill('Reentry live');await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);
  let depositRequest,before,after,onward,swapId;
  await check('actual failed Rhea swap refunds one tUSD to its signed receiving account',async()=>{
    await p.locator('#near-fund').click();await p.locator('#near-fund-amount').fill('3');await p.locator('#near-fund-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3',null,{timeout:180000});await idle(p);
    await p.locator('#rhea-open').click();await p.locator('#rhea-minimum').fill('1000000');await p.locator('#rhea-receiver').fill(c.refundPayer);await p.locator('#rhea-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='2');await idle(p);
    await p.getByRole('button',{name:'Start swap',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent==='Refund available',null,{timeout:420000});await idle(p);
    swapId=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,c.reserve);return v.rheaOrders[0].packet.id;},c);
    assert.equal((await view(c.adapter,'get_order',{id:swapId})).stage,'refunded');
  });
  await check('lost return response recovers one backed root without a second token debit',async()=>{
    before={payer:await view(c.reserve,'ft_balance_of',{account_id:c.refundPayer}),reserve:await view(c.reserve,'reserved_balance',{}),supply:await view(c.reserve,'ft_total_supply',{})};
    await p.route('**/api/rhea/return',async route=>{depositRequest=JSON.parse(route.request().postData()).request;const response=await route.fetch({timeout:180000});assert.equal(response.status(),200);const r=await response.json();transactions.push({action:'return-response-dropped',txHash:r.txHash,root:r.root.id});await route.abort('failed');},{times:1});
    await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('internet connection'),null,{timeout:240000});await idle(p);assert.equal(await p.locator('#near-total').innerText(),'2');
    await p.reload();await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3',null,{timeout:180000});await idle(p);
    after={payer:await view(c.reserve,'ft_balance_of',{account_id:c.refundPayer}),reserve:await view(c.reserve,'reserved_balance',{}),supply:await view(c.reserve,'ft_total_supply',{})};
    assert.equal(BigInt(before.payer)-BigInt(after.payer),1000000n);assert.equal(BigInt(after.reserve)-BigInt(before.reserve),1000000n);assert.equal(after.supply,before.supply);
  });
  await check('returned note is transferred A to B to C while the browser is offline',async()=>{
    await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3');
    onward=await p.evaluate(async c=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),p=await import('/peer-crypto.js');return updateState(async s=>{const v=await n.readNearVault(s,c.reserve),b=await p.createIdentity('Offline B'),d=await p.createIdentity('Offline C');const ab=await n.makeNearPayment(v,s.identity,b.profile,'0.6'),vb=(await n.acceptNearPayment(n.emptyNearVault(c.reserve),b,s.identity.profile,ab.payload)).vault,bc=await n.makeNearPayment(vb,b,d.profile,'0.2'),vc=(await n.acceptNearPayment(n.emptyNearVault(c.reserve),d,b.profile,bc.payload)).vault;await n.saveNearVault(s,ab.vault);return {payload:bc.payload,recipient:n.compressed(d.profile.signingPublic),amount:(await n.nearLedger(vc)).available.find(x=>x.owner===n.compressed(d.profile.signingPublic)).amount};});},c);
    assert.equal(onward.payload.root.id,depositRequest.id);assert.equal(onward.amount,'200000');assert.equal(onward.payload.path.length,2);
    await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='2.4');
  });
  await check('NEAR settles returned-note ancestry and later deposit checks do not revive its input',async()=>{
    await ctx.setOffline(false);const result=await p.evaluate(async({c,path})=>{const r=await fetch('/api/testnet/settle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contract:c.reserve,path})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;},{c,path:onward.payload.path});
    assert.equal(result.finality,'FINAL');assert.equal(result.receipts.at(-1).outputs[0].owner,onward.recipient);assert.equal(result.receipts.at(-1).outputs[0].amount,'200000');
    await p.getByRole('button',{name:'Check refund',exact:true}).click();await idle(p);assert.equal(await p.locator('#near-total').innerText(),'2.4');
    assert.equal(await view(c.reserve,'ft_balance_of',{account_id:c.refundPayer}),after.payer);
  });
  assert.deepEqual(errors,[]);await p.screenshot({path:path.join(__dirname,'evidence/refund-return-live.png'),fullPage:true});
  await fs.writeFile(path.join(__dirname,'near-deposit-live-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,transactions,adapter:c.adapter,contract:c.reserve,swapId,depositRequest,before,after,onward,scope:'Disposable Edge identity, actual Rhea refund and NEAR deposit/settlement; dropped-response recovery and real browser offline onward signatures. No user browser data or real funds. B/C keys are disposable browser fixtures, not physical phones.'},null,2)+'\n');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
