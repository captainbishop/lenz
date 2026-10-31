// Actual local native-wallet bridge. --refresh also syncs both existing test wallets.
// Never funds, creates a wallet, exports a key or sends a transaction.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const afterPczt=process.argv.includes('--after-pczt');
const base='http://127.0.0.1:4173',file=path.join(__dirname,afterPczt?'zcash-companion-after-pczt-results.json':'zcash-companion-live-results.json');
const ev={startedAt:new Date().toISOString(),network:'testnet',refresh:process.argv.includes('--refresh'),checks:[],responses:[],errors:[]};
async function save(){await fs.writeFile(file,JSON.stringify(ev,null,2)+'\n');}
(async()=>{
  const transfer=afterPczt?JSON.parse(await fs.readFile(path.join(__dirname,'../zcash/pczt-results.json'))):null;
  if(afterPczt) assert.equal(transfer.steps.confirm.ok,true,'Confirm the native transfer first');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>ev.errors.push(e.message));
    await p.goto(base+'/zcash-lab.html');await p.waitForFunction(()=>document.querySelector('#main')?.getAttribute('aria-busy')==='false');
    for(const wallet of ['a','b']){
      await p.locator('#zc-wallet').selectOption(wallet);
      for(const refresh of ev.refresh?[false,true]:[false]){
        const label=`Native wallet ${wallet.toUpperCase()} ${refresh?'network update':'local read'}`;console.log('RUN '+label);
        const responsePromise=p.waitForResponse(r=>r.url()===base+'/api/zcash/'+(refresh?'refresh':'status'),{timeout:175000});
        await p.locator(refresh?'#zc-refresh':'#zc-read').click();const response=await responsePromise,body=await response.json();
        ev.responses.push({wallet,refresh,status:response.status(),body});await save();
        await p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');assert.equal(response.status(),200,body.error);assert.equal(body.wallet,wallet);assert.equal(body.network,'testnet');assert.equal(body.refreshed,refresh);assert.equal(body.canSend,false);assert.equal(await p.locator('#zc-address').inputValue(),body.address);assert(await p.locator('#zc-result').isVisible());assert.equal(await p.locator('#zc-status').getAttribute('data-error'),'false');
        ev.checks.push(label);await save();console.log('PASS '+label+'; total '+body.amounts.total+' zatoshis');
        if(afterPczt){assert.equal(body.amounts.total,String(transfer.after[wallet].balance.total));assert.equal(body.amounts.ironwood_spendable,String(transfer.after[wallet].balance.ironwood_spendable));ev.checks.push(`Wallet ${wallet.toUpperCase()} matches confirmed PCZT balance and spendable Ironwood value`);await save();}
      }
    }
    assert.deepEqual(await p.evaluate(()=>indexedDB.databases()),[]);assert.deepEqual(ev.errors,[]);ev.checks.push('Companion page creates no Lenz identity or wallet storage and has no page errors');
    await p.locator('#zc-result summary').click();await p.screenshot({path:path.join(__dirname,afterPczt?'evidence/zcash-companion-after-pczt.png':'evidence/zcash-companion-live.png'),fullPage:true});
    ev.ok=true;ev.completedAt=new Date().toISOString();ev.scope='Actual pinned native Zcash test wallets through local HTTP and isolated Windows Edge; no fixture responses, funding, signing, sending or existing user profile access.';await save();console.log(JSON.stringify({ok:true,checks:ev.checks.length,balances:ev.responses.filter(r=>r.refresh===ev.refresh).map(r=>({wallet:r.wallet,total:r.body.amounts.total,block:r.body.walletHeight}))},null,2));
  }catch(e){ev.ok=false;ev.failure=e.stack;await save();throw e;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
