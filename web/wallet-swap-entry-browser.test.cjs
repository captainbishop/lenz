const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.join(__dirname,'public');
const near={network:'testnet',contract:'swap-entry-fixture.lenz.testnet',ready:true},rhea={network:'testnet',adapter:'swap-entry-adapter.lenz.testnet',reserve:near.contract,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',ready:true};

test('Wallet offers funding for empty Swap and keeps Send and funded Swap choices usable without authorization',async()=>{
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
  await page.locator('#device-profile>summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  await page.locator('#private-swap-open').click();await page.locator('#rhea-dialog').waitFor({timeout:4000});assert.equal(await page.locator('#private-spend-dialog').isVisible(),false);assert(await page.locator('#swap-get-test-funds').isVisible());assert.equal(await page.locator('#rhea-use-public-route').isVisible(),false);await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();await page.locator('.wallet-markets a').filter({has:page.locator('strong',{hasText:/^Swap$/})}).click();await page.locator('#rhea-dialog').waitFor();
  assert(await page.getByRole('combobox',{name:'Funds to swap',exact:true}).isDisabled());assert(await page.getByRole('combobox',{name:'Asset to receive',exact:true}).isDisabled());
  assert(await page.locator('#swap-get-test-funds').isVisible(),'An empty Swap must offer a funding action');
  assert.match(await page.locator('#rhea-estimate').innerText(),/No funded assets.*faucet/);assert.equal(await page.locator('#swap-get-test-funds').innerText(),'');assert.equal(await page.locator('#swap-get-test-funds svg').count(),1);assert(await page.locator('#rhea-form button[type=submit]').isDisabled());
  for(const theme of ['light','dim','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);const box=await page.locator('#swap-get-test-funds').boundingBox();assert(box&&box.width>=44&&box.height>=44);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.locator('#swap-get-test-funds').click();await page.locator('#wallet-funding-dialog').waitFor();assert.equal(await page.locator('#rhea-dialog').isVisible(),false);assert.match(await page.locator('#wallet-funding-dialog').innerText(),/tUSD · Offline payments/);assert.equal(await page.locator('#wallet-funding-confirm').isVisible(),false);await page.waitForFunction(()=>document.querySelector('#wallet-funding-dialog').getAttribute('aria-busy')==='false');
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Tokens',exact:true}).click();await page.locator('#wallet-send').click();await page.locator('#evm-send-recipient').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'evm-send-recipient');
  const recipient='0x'+'34'.repeat(20);await page.locator('#evm-send-recipient').fill(recipient);await page.locator('#evm-send-amount').fill('0.1');
  await page.getByRole('combobox',{name:'Receiving network',exact:true}).click();await page.getByRole('option',{name:'Ethereum',exact:true}).click();
  await page.getByRole('button',{name:'Choose asset',exact:true}).click();assert(await page.locator('#evm-send-asset-menu').isVisible());await page.locator('#evm-send-assets').getByRole('button',{name:'USDC',exact:true}).click();assert.equal(await page.locator('#evm-send-symbol').innerText(),'USDC');assert.equal(await page.locator('#evm-send-recipient').inputValue(),recipient);assert.equal(await page.locator('#evm-send-amount').inputValue(),'0.1');
  await page.getByRole('button',{name:'Choose asset',exact:true}).click();await page.keyboard.press('Escape');assert(await page.locator('#evm-send-dialog').isVisible());assert.equal(await page.locator('#evm-send-asset-menu').isVisible(),false);await page.keyboard.press('Escape');
  // Synthetic backing initializes this disposable profile; no funding endpoint is called.
  await page.evaluate(async contract=>{const store=await import('/chat-store.js'),p=await import('/peer-crypto.js'),n=await import('/near-protocol.js');await store.updateState(async s=>{s.identity=await p.createIdentity('Swap entry fixture');const vault=n.emptyNearVault(contract),funding=await n.fundingRequest(s.identity,contract,'10');vault.roots.push({id:funding.id,amount:funding.amount,owner:funding.owner});await n.saveNearVault(s,vault);});},near.contract);
  await page.reload();await page.locator('#wallet-content').waitFor();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  await page.locator('#private-swap-open').click();await page.locator('#rhea-dialog').waitFor({timeout:4000});assert.equal(await page.locator('#swap-pay-asset').inputValue(),'lenz-tusd');assert.equal(await page.locator('#private-spend-dialog').isVisible(),false);await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'DeFi',exact:true}).click();if(!await page.locator('#wallet-defi-positions').evaluate(node=>node.open))await page.locator('#wallet-defi-positions>summary').click();await page.locator('#rhea-open').click();await page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  assert.equal(await page.locator('#rhea-dialog').evaluate(dialog=>dialog.open),true);assert.equal(await page.locator('.dex-settings').evaluate(node=>node.open),false);await page.locator('.dex-settings>summary').click();assert(await page.locator('#rhea-privacy-control').isVisible());assert(await page.locator('#rhea-slippage-control').isVisible());
  assert.equal(await page.locator('#swap-pay-asset').inputValue(),'lenz-tusd');assert.equal(await page.locator('#swap-receive-asset').inputValue(),'near-wrapped');
  const source=page.getByRole('combobox',{name:'Funds to swap',exact:true}),destination=page.getByRole('combobox',{name:'Asset to receive',exact:true});
  await source.click();assert(await page.getByRole('listbox',{name:'Funds to swap',exact:true}).isVisible());await page.getByRole('option',{name:/^tUSD ·/}).click();
  await destination.click();assert(await page.getByRole('listbox',{name:'Asset to receive',exact:true}).isVisible());await page.getByRole('option',{name:'LTT',exact:true}).click();assert.equal(await page.locator('#swap-receive-asset').inputValue(),'near-testnet-ltt');
  await destination.click();await page.getByRole('option',{name:'wNEAR',exact:true}).click();assert.equal(await page.locator('#swap-receive-asset').inputValue(),'near-wrapped');
  assert.equal(walletCalls.some(method=>/sign|sendTransaction|sendRawTransaction/.test(method)),false);assert.equal(calls.some(file=>/\/intent-zcash\/|\/(?:fund|add-funds|submit|execute|send|sponsor|authorize|broadcast)$/.test(file)),false);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
