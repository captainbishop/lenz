const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.join(__dirname,'public');
const near={network:'testnet',contract:'swap-entry-fixture.lenz.testnet',ready:true},rhea={network:'testnet',adapter:'swap-entry-adapter.lenz.testnet',reserve:near.contract,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',ready:true};

test('Wallet New swap opens with themed labels without signing or starting a financial request',async()=>{
 const calls=[],walletCalls=[],errors=[];
 const server=http.createServer(async(req,res)=>{const file=new URL(req.url,'http://local').pathname;
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   if(file.startsWith('/api/')){calls.push(file);res.writeHead(503);res.end(JSON.stringify({error:'No financial provider in this fixture'}));return;}
   res.end(file==='/near-config.json'?JSON.stringify(near):file==='/rhea-config.json'?JSON.stringify(rhea):await fs.readFile(file==='/intent-near-ui.js'&&process.env.LENZ_NEAR_INTENT_UI_SOURCE?process.env.LENZ_NEAR_INTENT_UI_SOURCE:path.join(root,file)));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('recordSwapWalletCall',method=>walletCalls.push(method));await page.addInitScript(()=>{window.ethereum={request:async({method})=>{await recordSwapWalletCall(method);throw Error('No external wallet authority in this fixture');},on(){},removeListener(){}};});
  await page.goto('http://127.0.0.1:'+server.address().port+'/money.html');
  // Synthetic backing initializes this disposable profile; no funding endpoint is called.
  await page.evaluate(async contract=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),n=await import('/near-protocol.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Swap entry fixture');const vault=n.emptyNearVault(contract),funding=await n.fundingRequest(s.identity,contract,'10');vault.roots.push({id:funding.id,amount:funding.amount,owner:funding.owner});await n.saveNearVault(s,vault);});},near.contract);
  await page.reload();await page.locator('#wallet-content').waitFor();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();await page.locator('#wallet-defi-positions>summary').click();await page.locator('#rhea-open').click();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  assert.equal(await page.locator('#rhea-dialog').evaluate(dialog=>dialog.open),true);assert(await page.locator('#rhea-privacy-control').isVisible());assert(await page.locator('#rhea-slippage-control').isVisible());
  assert.equal(await page.locator('#swap-pay-asset').inputValue(),'lenz-tusd');assert.equal(await page.locator('#swap-receive-asset').inputValue(),'near-wrapped');
  assert.equal(walletCalls.some(method=>/sign|sendTransaction|sendRawTransaction/.test(method)),false);assert.equal(calls.some(file=>/\/intent-zcash\/|\/(?:fund|add-funds|submit|execute|send|sponsor|authorize|broadcast)$/.test(file)),false);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
