const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.join(__dirname,'public'),hash=d=>'0x'+d.repeat(64),address=d=>'0x'+d.repeat(40);

async function fixture(run,{holdModule=false,holdSnapshot=false,noDebt=false}={}){
 const {LENDING_TESTNET}=await import('./public/intent-lending-config.js'),{LENDING_DEPLOYMENT}=await import('./public/intent-lending-deployment.js'),config={...LENDING_TESTNET,...LENDING_DEPLOYMENT};
 const account=address('6'),calls=[],walletCalls=[],errors=[];let moduleRequested=false,release=null,snapshotRequested=false,releaseSnapshot=null,owner=null;
 const route={chainId:config.chain,factory:config.lendingFactory,...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key=>[[key,config[key]],[key+'CodeHash',config.codeHashes[key]]]))};
 const snapshot=()=>({chainId:config.chain,observedAt:Date.now(),block:{number:'100',hash:hash('1'),timestamp:String(Math.floor(Date.now()/1000)),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},account:{status:'verified',address:account,owner,nonce:'0',codeHash:hash('2'),route,position:{freeLinkBaseUnits:'0',freeUsdcBaseUnits:'2000000',aLinkBalanceBaseUnits:'1000000000000000000',aLinkScaled:'1000000000000000000',variableDebtBaseUnits:'1000000',variableDebtScaled:'1000000',accountData:{totalCollateralBase:'3000000000',totalDebtBase:'100000000',availableBorrowsBase:'2000000000',healthFactorWad:'4500000000000000000'}}},reserves:{LINK:{asset:config.link,active:true,frozen:false,paused:false,oneNoteSupplyPossible:true,normalizedIncomeRay:'1000000000000000000000000000',variableBorrowRateRay:'0'},USDC:{asset:config.usdc,oraclePriceBase:'100000000',active:true,frozen:false,paused:false,borrowingEnabled:true,variableBorrowRateRay:'100000000000000000000000000',normalizedVariableDebtRay:'1000000000000000000000000000',availableLiquidityBaseUnits:'1000000000'}}});
 const server=http.createServer(async(req,res)=>{const pathname=new URL(req.url,'http://local').pathname;
  try{
   if(pathname.startsWith('/api/intents/lending/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()),operation=pathname.slice('/api/intents/lending/'.length);calls.push({operation,body});
    let result;if(operation==='snapshot'){owner??=body.owner;assert.equal(body.owner,owner);if(holdSnapshot){snapshotRequested=true;await new Promise(resolve=>releaseSnapshot=resolve);}result=snapshot();}
    else if(operation==='config')result={available:true,execute:true};
    else if(operation==='repayment-funding/reconcile')result={...body,grantId:'lending-repayment:'+'0'.repeat(64),status:'not-requested',available:true,verified:false};
    else if(operation==='prepare')result={available:true,execute:true,review:body.review};
    else throw Error('Financial operation is not authorized by this navigation test.');
    if(noDebt&&operation==='snapshot'){result.account.position.variableDebtBaseUnits='0';result.account.position.variableDebtScaled='0';result.account.position.accountData.totalDebtBase='0';}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
   }
   if(pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Unavailable fixture provider'}));return;}
   if(pathname==='/intent-lending-markets.js'&&holdModule){moduleRequested=true;await new Promise(resolve=>release=resolve);}
   const file=path.resolve(root,'.'+pathname);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
  }catch(error){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('walletLendingCall',method=>walletCalls.push(method));await page.addInitScript(()=>{window.ethereum={request:async({method})=>{await walletLendingCall(method);throw Error('No external wallet authority in this fixture.');},on(){},removeListener(){}};});
  await page.goto('http://127.0.0.1:'+server.address().port+'/money.html');await page.locator('#device-profile>summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();await page.locator('#wallet-defi-positions>summary').click();
  const select=async name=>{await page.locator('.defi-action-menu>summary').click();await page.locator('.defi-tabs').getByRole('button',{name,exact:true}).click();};
  await run({page,context,select,calls,walletCalls,errors,account,config,moduleRequested:()=>moduleRequested,release:()=>release?.(),snapshotRequested:()=>snapshotRequested,releaseSnapshot:()=>releaseSnapshot?.()});
 }finally{release?.();releaseSnapshot?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('Wallet selected lending actions expose the real owned Aave route without funding or signing during navigation',()=>fixture(async({page,select,calls,walletCalls,errors,account})=>{
 await select('Supply');await page.locator('#defi-market-state .intent-lending').waitFor({timeout:3000});
 assert.match(await page.locator('#defi-market-state').innerText(),/Aave V3.*Sepolia testnet/s);
 assert.equal(calls.length,0);assert.equal(await page.locator('[data-il=position]').innerText(),'Collateral\n—\nDebt\n—\nBorrow capacity\n—\nHealth factor\n—');
 assert(await page.locator('[data-il=actions]').isHidden());
 await page.getByRole('button',{name:'Open lending account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-il=position]').textContent.includes('1 LINK')&&document.querySelector('.intent-lending').getAttribute('aria-busy')==='false');
 assert.match(await page.locator('[data-il=position]').innerText(),/Debt\s+1 USDC/);assert.match(await page.locator('[data-il=position]').innerText(),/Borrow capacity\s+20 USDC\s+Health factor\s+4.5/);assert(await page.locator('[data-il=supply]').isVisible());
 assert(calls.every(c=>['snapshot','config'].includes(c.operation)));
 for(const name of ['Borrow','Repay','Withdraw']){
  const accountReads=calls.filter(c=>c.operation==='config').length;await select(name);await page.locator('#defi-market-state .intent-lending').waitFor();assert(await page.getByRole('button',{name:'Open lending account',exact:true}).isHidden());assert.equal(calls.filter(c=>c.operation==='config').length,accountReads);await page.locator('[data-il=form]').waitFor();assert.equal(await page.locator('[data-il=action-title]').innerText(),name+' '+(name==='Withdraw'?'LINK':'USDC'));
  assert.equal(await page.locator('[data-il=review]').innerText(),'Review '+name);
  await page.locator('[data-il=amount]').fill(name==='Withdraw'?'0.1':'0.25');await page.locator('[data-il=review]').click();await page.locator('[data-il=receipt]').waitFor();
  const reviewed=calls.filter(c=>c.operation==='prepare').at(-1).body.review;assert.equal(reviewed.account,account);assert.equal(reviewed.terms.recipient,account);assert.equal(reviewed.terms.action,{Borrow:0,Repay:1,Withdraw:2}[name]);assert.equal(reviewed.terms.amount,name==='Withdraw'?'100000000000000000':'250000');
  assert.match(await page.locator('[data-il=terms]').innerText(),/Sepolia|Network fee|Paid by the testnet sponsor/);
 }
 for(const theme of ['light','dim','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:1000});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await select('Swap');assert.equal(await page.locator('.intent-lending').count(),0);assert.equal(await page.locator('.lending-supply-dialog').count(),0);
 assert(calls.every(c=>['snapshot','config','prepare'].includes(c.operation)));assert.deepEqual(walletCalls,[]);assert.deepEqual(errors,[]);
}));

test('the Wallet faucet opens the exact eligible Repay grant review without signing or losing the existing amount',()=>fixture(async({page,select,calls,walletCalls,errors})=>{
 await select('Repay');await page.locator('.intent-lending').waitFor();await page.getByRole('button',{name:'Open lending account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.intent-lending').getAttribute('aria-busy')==='false');await page.locator('[data-il=amount]').fill('0.25');
 await page.getByRole('tab',{name:'Tokens',exact:true}).click();await page.locator('#wallet-test-funds').click();await page.locator('#wallet-funding-dialog').waitFor();await page.locator('#wallet-funding-usdc').click();await page.locator('[data-irf=review]').waitFor();
 assert.match(await page.locator('[data-irf=review]').innerText(),/1 test USDC/);assert.match(await page.locator('[data-irf=review]').innerText(),/Sepolia testnet/);assert.equal(await page.locator('[data-il=amount]').inputValue(),'0.25');assert.equal(calls.filter(c=>c.operation==='repayment-funding/reconcile').length,1);assert(calls.every(c=>['snapshot','config','repayment-funding/reconcile'].includes(c.operation)));
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert(await page.locator('[data-irf=review]').isHidden());assert.equal(await page.locator('[data-il=amount]').inputValue(),'0.25');assert.deepEqual(walletCalls,[]);assert.deepEqual(errors,[]);
}));

test('the Wallet faucet shows the verified no-debt limit without opening a new USDC grant',()=>fixture(async({page,calls,walletCalls,errors})=>{
 await page.getByRole('tab',{name:'Tokens',exact:true}).click();await page.locator('#wallet-test-funds').click();await page.locator('#wallet-funding-dialog').waitFor();await page.locator('#wallet-funding-usdc').click();await page.locator('.intent-lending').waitFor();await page.getByRole('button',{name:'Open lending account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.intent-lending').getAttribute('aria-busy')==='false');
 assert.match(await page.locator('[data-il=status]').innerText(),/only for an outstanding loan/);assert(await page.locator('[data-irf=review]').isHidden());assert.equal(calls.filter(c=>c.operation==='repayment-funding/reconcile').length,0);assert(calls.every(c=>['snapshot','config'].includes(c.operation)));assert.deepEqual(walletCalls,[]);assert.deepEqual(errors,[]);
},{noDebt:true}));

test('late lending module cannot replace a newer Wallet action or create duplicate controllers',()=>fixture(async({page,select,moduleRequested,release,calls})=>{
 await select('Supply');await page.waitForFunction(()=>document.querySelector('.defi-action-menu>summary span').textContent==='Supply');
 const until=Date.now()+3000;while(!moduleRequested()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert(moduleRequested(),'Supply must load the real lending module');
 await select('Swap');release();await page.evaluate(()=>import('/intent-lending-markets.js'));
 assert.equal(await page.locator('.intent-lending').count(),0);assert(await page.locator('#defi-market-state').isHidden());
 await select('Borrow');await page.locator('.intent-lending').waitFor();await select('Repay');await page.locator('.intent-lending').waitFor();
 assert.equal(await page.locator('.intent-lending').count(),1);assert.equal(await page.locator('.lending-supply-dialog').count(),1);assert.equal(await page.locator('[data-il=review]').innerText(),'Review Repay');assert.equal(calls.length,0);
 await page.evaluate(async()=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Another account');});dispatchEvent(new Event('lenz-account-identity'));});
 await page.locator('.intent-lending').waitFor();assert.match(await page.locator('[data-il=position]').innerText(),/Collateral\s+—/);assert.equal(calls.length,0);
},{holdModule:true}));

test('leaving Wallet lending cancels an unfinished account read without creating custody or resurfacing the position',()=>fixture(async({page,select,calls,snapshotRequested,releaseSnapshot})=>{
 await select('Borrow');await page.locator('.intent-lending').waitFor();
 const before=await page.evaluate(async()=>{const s=await (await import('/chat-store.js')).readState();return {identity:s.identity.profile.id,lending:s.lendingOwnedAccount??null};});assert.equal(before.lending,null);
 await page.getByRole('button',{name:'Open lending account',exact:true}).click();
 const until=Date.now()+3000;while(!snapshotRequested()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert(snapshotRequested());
 await select('Swap');releaseSnapshot();
 assert.equal(await page.locator('.intent-lending').count(),0);assert(await page.locator('#defi-market-state').isHidden());
 const after=await page.evaluate(async()=>{const s=await (await import('/chat-store.js')).readState();return {identity:s.identity.profile.id,lending:s.lendingOwnedAccount??null};});assert.deepEqual(after,before);assert.equal(calls.length,1);assert.equal(calls[0].operation,'snapshot');
},{holdSnapshot:true}));

test('Wallet lending keeps missing borrowing capacity unknown and exposes liquidation risk',()=>fixture(async({page,select,calls,walletCalls})=>{
 await page.route('**/api/intents/lending/snapshot',async route=>{const response=await route.fetch(),value=await response.json();delete value.reserves.USDC.oraclePriceBase;value.account.position.accountData.healthFactorWad='950000000000000000';await route.fulfill({response,json:value});});
 await select('Borrow');await page.locator('.intent-lending').waitFor();await page.getByRole('button',{name:'Open lending account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.intent-lending').getAttribute('aria-busy')==='false'&&document.querySelector('[data-il=position]').textContent.includes('1 LINK'));
 assert.match(await page.locator('[data-il=position]').innerText(),/Borrow capacity\s+—\s+Health factor\s+0.95/);assert.match(await page.locator('[data-il=health-copy]').innerText(),/Liquidation risk/);
 assert(calls.every(c=>['snapshot','config'].includes(c.operation)));assert.deepEqual(walletCalls,[]);
}));
