// Actual testnet transactions from an isolated Edge profile. Never uses the user's browser data.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const checks=[],transactions=[],errors=[];
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true',null,{timeout:240000});}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{
  const config=JSON.parse(await fs.readFile(path.join(__dirname,'public/rhea-config.json'),'utf8'));
  const recipient=JSON.parse(await fs.readFile(path.join(__dirname,'../contracts/rhea-flow-results.json'),'utf8')).account;
  const {view}=await import('../contracts/client.mjs');const before=await view(config.tokenOut,'ft_balance_of',{account_id:recipient});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
    p.on('response',async response=>{if(response.url().includes('/api/rhea/'))try{const r=await response.json();if(r.txHash)transactions.push({txHash:r.txHash,stage:r.order?.stage,failedReceipts:r.failedReceipts});}catch{}});
    await p.goto('http://127.0.0.1:4173/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
    await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill('Live Rhea test');await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);
    await check('disposable browser funds three actual testnet tUSD and gets a live quote',async()=>{
      await p.locator('#near-fund').click();await p.locator('#near-fund-amount').fill('3');await p.locator('#near-fund-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3',null,{timeout:180000});await idle(p);
      await p.locator('#rhea-open').click();await p.locator('#rhea-quote').click();await p.waitForFunction(()=>document.querySelector('#rhea-estimate').textContent.startsWith('Estimate:'),null,{timeout:90000});await idle(p);
      await p.locator('#rhea-receiver').fill(recipient);await p.locator('#rhea-close').click();
      await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);
    });
    let packet;
    await check('browser signs offline, saves authorization and preserves reservation after reload',async()=>{
      await ctx.setOffline(true);await p.locator('#rhea-open').click();await p.locator('#rhea-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='2');await idle(p);
      const download=p.waitForEvent('download');await p.getByRole('button',{name:'Share swap request',exact:true}).click();packet=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
      await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='2');assert(await p.getByText('Saved · money set aside',{exact:true}).isVisible());
    });
    await check('lost submission response leaves the same order reserved and can be recovered',async()=>{
      await ctx.setOffline(false);
      await p.route('**/api/rhea/submit',async route=>{const response=await route.fetch({timeout:180000});assert.equal(response.status(),200);const r=await response.json();transactions.push({txHash:r.txHash,stage:r.order?.stage,responseDropped:true});await route.abort('failed');},{times:1});
      await p.getByRole('button',{name:'Start swap',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('internet connection'),null,{timeout:240000});await idle(p);
      assert.equal(await p.locator('#near-total').innerText(),'2');await p.getByRole('button',{name:'Check status',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent==='Ready to execute',null,{timeout:90000});await idle(p);
    });
    await check('saved browser instruction executes on Rhea and exact output reaches signed account',async()=>{
      await p.getByRole('button',{name:'Continue swap',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent==='Swap complete',null,{timeout:420000});await idle(p);
      assert.equal(await p.locator('#near-total').innerText(),'2');const order=await view(config.adapter,'get_order',{id:packet.id});assert.equal(order.stage,'complete');assert.equal(order.instruction.receiver_id,recipient);
      const after=await view(config.tokenOut,'ft_balance_of',{account_id:recipient});assert.equal(BigInt(after)-BigInt(before),BigInt(order.output));
      await fs.writeFile(path.join(__dirname,'rhea-wallet-live-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length+1,failed:0,checks:[...checks,'saved browser instruction executes on Rhea and exact output reaches signed account'],transactions,adapter:config.adapter,packet,order,before,after,scope:'Isolated Windows Edge, actual NEAR testnet grant and Rhea execution; offline signing/reload and lost submission response. No user identity or real funds.'},null,2)+'\n');
    });
    assert.deepEqual(errors,[]);await p.screenshot({path:path.join(__dirname,'evidence/rhea-live-complete.png'),fullPage:true});
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
