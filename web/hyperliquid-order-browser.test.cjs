const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const {Wallet}=await import('../aurora/node_modules/ethers/lib.esm/index.js');
  const {createHyperliquidCatalogReader}=await import('../integrations/hyperliquid-catalog.mjs'),{hyperliquidFixtureFetcher}=await import('../integrations/hyperliquid-fixtures.mjs');
  const catalog=await createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher})(),root=path.join(__dirname,'public');
  const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
  try{
    const context=await browser.newContext({viewport:{width:390,height:850},serviceWorkers:'block'}),page=await context.newPage(),signer=Wallet.createRandom();
    let submitted=[],orders=new Map(),signMode='normal',signatures=0,accountMode='disabled',funds='1000',statusDelay=0,positions=[];
    await page.exposeFunction('fixtureSign',async typed=>{signatures++;if(signMode==='decline')throw Error('User declined');if(signMode==='late'){await new Promise(r=>setTimeout(r,250));}if(signMode==='shrink')positions[0].position.szi='-0.01';const {EIP712Domain,...types}=typed.types;return signer.signTypedData(typed.domain,types,typed.message);});
    await page.addInitScript(({address})=>{
      const events=new Map();window.fixtureProvider={on(name,fn){events.set(name,fn);},removeListener(name){events.delete(name);},request:async({method,params})=>{
        if(['eth_accounts','eth_requestAccounts'].includes(method))return [address];if(method==='eth_chainId')return '0xa4b1';if(method==='eth_blockNumber')return '0x100';if(method==='eth_getBalance')return '0x1000000000000000';if(method==='eth_signTypedData_v4'){window.fixtureSigning=true;try{return await window.fixtureSign(JSON.parse(params[1]));}finally{window.fixtureSigning=false;}}throw Error(method);
      }};window.changeFixtureAccount=()=>events.get('accountsChanged')?.(['0x'+'22'.repeat(20)]);window.ethereum=window.fixtureProvider;
    },{address:signer.address.toLowerCase()});
    await page.route('**/api/markets/**',async route=>{if(route.request().url().includes('hyperliquid/catalog'))return route.fulfill({json:catalog});return route.fulfill({status:503,json:{error:'Fixture data unavailable'}});});
    await page.route('https://api.hyperliquid.xyz/**',async route=>{
      const body=route.request().postDataJSON();let value;
      if(route.request().url().endsWith('/exchange')){
        submitted.push(body);
        if(body.action.type==='order'){
          const o=body.action.orders[0];orders.set(o.c,{status:'order',order:{order:{coin:o.a===10107?'@107':'BTC',side:o.b?'B':'A',limitPx:o.p,sz:o.s,origSz:o.s,oid:123,timestamp:Date.now(),cloid:o.c},status:'open',statusTimestamp:Date.now()}});
          value={status:'ok',response:{type:'order',data:{statuses:[{resting:{oid:123}}]}}};
        }else{const order=orders.get(body.action.cancels[0].cloid);order.order.status='canceled';value={status:'ok',response:{type:'cancel',data:{statuses:['success']}}};}
      }else switch(body.type){
        case 'spotMeta':value={tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,name:'@107',tokens:[150,0]}]};break;
        case 'meta':value={collateralToken:0,universe:[{name:'BTC',szDecimals:5,maxLeverage:20}]};break;
        case 'userAbstraction':value=accountMode;break;
        case 'spotClearinghouseState':value={balances:[{token:0,coin:'USDC',total:funds,hold:'0'},{token:150,coin:'HYPE',total:'10',hold:'0'}]};break;
        case 'clearinghouseState':value={withdrawable:'1000',assetPositions:positions};break;
        case 'activeAssetData':value={user:body.user,coin:body.coin,leverage:{type:'cross',value:2},markPx:'100'};break;
        case 'userFees':value={userSpotCrossRate:'0.0007',userCrossRate:'0.00045'};break;
        case 'orderStatus':if(statusDelay)await new Promise(r=>setTimeout(r,statusDelay));value=orders.get(body.oid)??{status:'unknownOid'};break;
        default:throw Error('Unexpected request '+body.type);
      }
      await route.fulfill({json:value});
    });
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
    await page.goto(base+'/markets.html?view=spot');
    // The catalogue endpoint is same-origin; match its actual route without network access.
    if(!await page.locator('.hyper-action').count())await page.evaluate(value=>{localStorage.setItem('lenz-hyperliquid-catalog-v1',JSON.stringify(value));},catalog).then(()=>page.reload());
    await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();
    await page.getByText(/Available 1000 USDC/).waitFor();assert.equal(submitted.length,0);checks.push('Market selection survives wallet connection; connecting never signs or submits');
    assert(await page.locator('#hyper-order-review').isDisabled());await page.locator('#hyper-order-privacy').selectOption('public');
    await page.locator('#hyper-order-size').fill('1');await page.locator('#hyper-order-price').fill('20');
    await page.locator('[data-category="all"]').click();await page.locator('[data-category="spot"]').click();await page.getByText(/Available 1000 USDC/).waitFor();
    assert.equal(await page.locator('#hyper-order-size').inputValue(),'1');assert.equal(await page.locator('#hyper-order-price').inputValue(),'20');assert.equal(await page.locator('#hyper-order-privacy').inputValue(),'public');checks.push('Category navigation preserves the exact market draft and privacy choice');
    await page.locator('#hyper-order-review').click();
    await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(signatures,0);checks.push('Review and back preserve the chosen market and terms without signing');
    await page.locator('#hyper-order-review').click();await page.getByRole('button',{name:'Sign order in wallet',exact:true}).click();
    await page.locator('.hyper-saved-order').getByText('Open',{exact:true}).waitFor();assert.equal(submitted.length,1);assert.equal(submitted[0].action.orders[0].a,10107);checks.push('A reviewed limit order signs with an ephemeral test wallet and reaches matching open-order status');
    statusDelay=300;const beforeCancelledLookup=signatures;
    await page.locator('.hyper-saved-order').getByRole('button',{name:'Cancel order',exact:true}).click();await page.getByRole('button',{name:'Sign cancellation',exact:true}).click();await page.getByRole('button',{name:'Keep order',exact:true}).click();await page.waitForTimeout(450);assert.equal(signatures,beforeCancelledLookup);assert.equal(submitted.length,1);statusDelay=0;checks.push('Closing cancellation during status lookup prevents wallet signing');
    signMode='decline';await page.locator('.hyper-saved-order').getByRole('button',{name:'Cancel order',exact:true}).click();await page.getByRole('button',{name:'Sign cancellation',exact:true}).click();await page.getByRole('dialog',{name:'Cancel order',exact:true}).getByRole('status').filter({hasText:'User declined'}).waitFor();await page.getByRole('button',{name:'Keep order',exact:true}).click();signMode='normal';checks.push('Cancellation rejection stays visible inside its dialog');
    await page.locator('.hyper-saved-order').getByRole('button',{name:'Cancel order',exact:true}).click();await page.getByRole('button',{name:'Sign cancellation',exact:true}).click();await page.locator('.hyper-saved-order').getByText('Cancelled',{exact:true}).waitFor();checks.push('Cancellation signs only the saved order; status is re-read after submission');
    await page.reload();await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await page.locator('.hyper-saved-order').getByText('Cancelled',{exact:true}).waitFor();checks.push('Encrypted activity survives reload and reconnect');
    const recovery=await page.evaluate(async()=>{
      const {resolveOrderMarket,prepareOrder}=await import('/hyperliquid-order.js'),{reserveOrderAttempt,readHyperOrders,recordOrderState,updateHyperOrders}=await import('/hyperliquid-order-store.js'),{refreshTradingOrder}=await import('/hyperliquid-execution.js');
      const account=(await readHyperOrders())[0].review.account,market=resolveOrderMarket({id:'spot:107',kind:'spot',coin:'@107',quote:{index:0,symbol:'USDC'}},{spot:{tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,name:'@107',tokens:[150,0]}]},perps:{}});
      const funds={mode:'disabled',fee:'0.0007',spot:[{token:0,total:'1000',hold:'0'}]};
      const review=prepareOrder(market,account,{side:'buy',size:'1',price:'20',reduceOnly:false},funds);
      const attempt=await reserveOrderAttempt(review);
      await updateHyperOrders(rows=>{const row=rows.find(o=>o.id===attempt.id);row.review.nonce-=61000;row.review.expiresAt-=61000;});
      await refreshTradingOrder(attempt);const state=(await readHyperOrders()).find(o=>o.id===attempt.id).state;
      const next=await reserveOrderAttempt(prepareOrder(market,account,{side:'buy',size:'1',price:'20',reduceOnly:false},funds));await recordOrderState(next.id,'not_sent');return state;
    });assert.equal(recovery,'not_sent');checks.push('Expired pre-submission approvals recover safely and allow a fresh order');
    await page.locator('#hyper-order-privacy').selectOption('public');await page.locator('#hyper-order-size').fill('1');await page.locator('#hyper-order-price').fill('20');
    signMode='late';await page.locator('#hyper-order-review').click();await page.getByRole('button',{name:'Sign order in wallet',exact:true}).click();await page.waitForFunction(()=>window.fixtureSigning===true);await page.evaluate(()=>window.changeFixtureAccount());await page.waitForTimeout(400);assert.equal(submitted.length,2);checks.push('Account changes during approval invalidate the signature before exchange dispatch');
    await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Browser wallet',exact:true}).click();await page.getByText(/Available 1000 USDC/).waitFor();
    accountMode='portfolioMargin';await page.getByText('Add or withdraw funds',{exact:true}).click();await page.getByRole('button',{name:'Refresh funds',exact:true}).click();await page.getByText('Trading for this account mode is not connected in Lenz yet.',{exact:true}).waitFor();assert(await page.locator('#hyper-order-review').isDisabled());checks.push('Unsupported account modes fail closed without showing guessed spendable funds');
    accountMode='disabled';signMode='normal';
    positions=[{position:{coin:'BTC',szi:'0.25',entryPx:'90',unrealizedPnl:'2.5',liquidationPx:'55',marginUsed:'12.5'}}];
    await page.locator('[data-category="perpetuals"]').click();
    const positionPanel=page.getByRole('region',{name:'Your position',exact:true});
    await positionPanel.getByText('Long · 0.25 BTC',{exact:true}).waitFor();
    assert.match(await positionPanel.textContent(),/2.5 USDC/);assert.match(await positionPanel.textContent(),/55 USDC/);
    const beforeClose=signatures;
    await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#hyper-order-side')?.value==='sell');
    assert.equal(await page.locator('#hyper-order-side').inputValue(),'sell');assert.equal(await page.locator('#hyper-order-size').inputValue(),'0.25');
    assert.equal(await page.getByRole('combobox',{name:'Direction',exact:true}).textContent(),'Short / Sell');
    assert(await page.locator('#hyper-order-reduce').isChecked());assert.equal(await page.locator('#hyper-order-price').inputValue(),'');
    assert.equal(await page.locator('#hyper-order-privacy').inputValue(),'private');assert.equal(signatures,beforeClose);
    assert(await page.locator('#hyper-order-price').evaluate(n=>n===document.activeElement));
    checks.push('Selected position shows actual size and risk; closing prepares a reduce-only draft without signing or changing privacy');
    positions=[{position:{coin:'BTC',szi:'-0.1',entryPx:'100',unrealizedPnl:'-1',liquidationPx:null,marginUsed:'5'}}];
    await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#hyper-order-size')?.value==='0.1');
    assert.equal(await page.locator('#hyper-order-side').inputValue(),'buy');
    await positionPanel.getByText('Short · 0.1 BTC',{exact:true}).waitFor();
    assert.equal(await positionPanel.locator('dl>div').filter({hasText:'Liquidation price'}).locator('dd').textContent(),'Unavailable');
    checks.push('Closing refreshes position direction and size; absent liquidation data never becomes zero');
    await page.locator('#hyper-order-price').fill('100');await page.locator('#hyper-order-privacy').selectOption('public');await page.locator('#hyper-order-review').click();
    positions[0].position.szi='-0.05';
    await page.getByRole('button',{name:'Sign order in wallet',exact:true}).click();
    await page.getByRole('dialog',{name:'Review order',exact:true}).getByText('This order would not reduce the selected position.',{exact:true}).waitFor();
    assert.equal(signatures,beforeClose);await page.getByRole('button',{name:'Back',exact:true}).click();
    checks.push('A position that shrinks after review blocks signing until the closing amount is reviewed again');
    await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#hyper-order-size')?.value==='0.05');
    await page.locator('#hyper-order-price').fill('100');await page.locator('#hyper-order-review').click();
    signMode='shrink';const beforeShrinkingSubmit=submitted.length;
    await page.getByRole('button',{name:'Sign order in wallet',exact:true}).click();
    await page.getByRole('dialog',{name:'Review order',exact:true}).getByText('This order would not reduce the selected position.',{exact:true}).waitFor();
    assert.equal(submitted.length,beforeShrinkingSubmit);assert.equal(signatures,beforeClose+1);await page.getByRole('button',{name:'Back',exact:true}).click();
    checks.push('A position that shrinks while the wallet signs prevents the signed action from being submitted');
    signMode='normal';positions[0].position.szi='-0.05';
    await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#hyper-order-price')?.value==='');
    await page.locator('#hyper-order-price').fill('100');await page.locator('#hyper-order-review').click();
    const closeCount=submitted.length;await page.getByRole('button',{name:'Sign order in wallet',exact:true}).click();
    await page.locator('.hyper-saved-order').filter({hasText:'Buy 0.05 BTC'}).getByText('Open',{exact:true}).waitFor();
    assert.equal(submitted.length,closeCount+1);assert.deepEqual({...submitted.at(-1).action.orders[0],c:null},{a:0,b:true,p:'100',s:'0.05',r:true,t:{limit:{tif:'Gtc'}},c:null});
    checks.push('Reviewed closing order submits one reduce-only limit action and keeps its recoverable status');
    positions=null;await positionPanel.getByRole('button',{name:'Refresh position',exact:true}).click();
    await positionPanel.getByText('Position unavailable. Refresh to try again.',{exact:true}).waitFor();assert(!await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).isVisible());
    positions=[];await positionPanel.getByRole('button',{name:'Refresh position',exact:true}).click();await positionPanel.getByText('No open BTC position.',{exact:true}).waitFor();
    checks.push('Failed account reads stay unavailable; an explicit empty position list shows no open position');
    positions=[{position:{coin:'BTC',szi:'0.25',entryPx:'90',unrealizedPnl:'2.5',liquidationPx:'55',marginUsed:'12.5'}}];
    await positionPanel.getByRole('button',{name:'Refresh position',exact:true}).click();await positionPanel.getByText('Long · 0.25 BTC',{exact:true}).waitFor();
    await context.setOffline(true);await positionPanel.getByText('Offline · reconnect to refresh your position.',{exact:true}).waitFor();
    assert(!await positionPanel.getByRole('button',{name:'Close with limit',exact:true}).isVisible());assert(await page.locator('.hyper-saved-order').count()>0);
    await context.setOffline(false);await positionPanel.getByText('Long · 0.25 BTC',{exact:true}).waitFor();
    checks.push('Offline removes actionable position data while keeping saved orders; reconnect reads current positions');
    const stateChecks=await page.evaluate(async()=>{
      const {prepareOrder,resolveOrderMarket}=await import('/hyperliquid-order.js'),{reserveOrderAttempt,recordOrderState,readHyperOrders,updateHyperOrders,clearResolvedOrders}=await import('/hyperliquid-order-store.js'),{executeTradingOrder,refreshTradingOrder}=await import('/hyperliquid-execution.js');
      const original=await readHyperOrders(),account=original[0].review.account,market=original[0].review.market,results=[];
      try{
        const funds={mode:'disabled',fee:'0.0007',spot:[{token:0,total:'1000',hold:'0'}]},review=prepareOrder(market,account,{side:'buy',size:'1',price:'20',reduceOnly:false},funds);
        const row=await reserveOrderAttempt(review);await recordOrderState(row.id,'open',{state:'open',remaining:'1',filled:'0',oid:123,statusTime:50});await recordOrderState(row.id,'unknown');if((await readHyperOrders()).find(o=>o.id===row.id).state!=='open')throw Error('Local status replaced exchange observation');results.push('A delayed local submission response cannot replace an observed open order');
        const actualFetch=window.fetch;let count=0;
        window.fetch=async(url,options)=>{if(String(url).endsWith('/info')&&JSON.parse(options.body).type==='orderStatus'){
          const old=count++===0;await new Promise(r=>setTimeout(r,old?80:5));return new Response(JSON.stringify({status:'order',order:{order:{coin:'@107',side:'B',limitPx:'20',sz:old?'1':'0',origSz:'1',oid:123,timestamp:1,cloid:row.id},status:old?'open':'filled',statusTimestamp:old?100:200}}));
        }return actualFetch(url,options);};
        try{await Promise.all([refreshTradingOrder(row),refreshTradingOrder(row)]);}finally{window.fetch=actualFetch;}
        const after=(await readHyperOrders()).find(o=>o.id===row.id);if(after.state!=='filled'||after.observation.filled!=='1')throw Error('Status regressed');results.push('Older status responses cannot reverse fills or completed orders');
        const perp=resolveOrderMarket({id:'perp::0',kind:'perp',coin:'BTC',quote:{index:0,symbol:'USDC'}},{perps:{collateralToken:0,universe:[{name:'BTC',szDecimals:5,maxLeverage:20}]}}),perpFunds={mode:'disabled',fee:'0.00045',spot:[],perp:{withdrawable:'1000',assetPositions:[]},leverage:{type:'isolated',value:2},markPrice:'100'};
        const p=prepareOrder(perp,account,{side:'buy',size:'1',price:'100',reduceOnly:false},perpFunds);let signs=0,dispatches=0;
        try{await executeTradingOrder(p,{identity:{address:account},assertCurrent(){},async signHyperliquid(){signs++;}},{read:async()=>({market:perp,funds:{...perpFunds,leverage:{type:'cross',value:2}}}),submit:async()=>{dispatches++;}});throw Error('Mode switch was accepted');}catch(e){if(!e.message.includes('changed'))throw e;}
        if(signs||dispatches)throw Error('Unreviewed margin mode reached signer');results.push('A margin-mode change requires renewed review before signing');
        const record={...original[0],state:'filled'},history=Array.from({length:200},(_,i)=>{const clone=structuredClone(record),id='0x'+i.toString(16).padStart(32,'0');clone.id=id;clone.review.action.orders[0].c=id;return clone;});
        history[0].state='unknown';history[0].observation=null;await updateHyperOrders(rows=>rows.splice(0,rows.length,...history));await clearResolvedOrders(account);const retained=await readHyperOrders();if(retained.length!==1||retained[0].state!=='unknown')throw Error('Unresolved order was cleared');results.push('History cleanup frees terminal records while preserving uncertain orders');
        await recordOrderState(retained[0].id,'not_sent');await clearResolvedOrders(account);let duplicateBlocked=false;try{await reserveOrderAttempt(review);}catch{duplicateBlocked=true;}if(!duplicateBlocked)throw Error('Clearing history forgot the nonce');results.push('Clearing visible history preserves the nonce highwater');
      }finally{await updateHyperOrders(rows=>rows.splice(0,rows.length,...original));}
      return results;
    });checks.push(...stateChecks);
    for(const width of [320,390,1360])for(const theme of ['light','dim','dark']){await page.setViewportSize({width,height:850});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await positionPanel.screenshot({path:path.join(os.tmpdir(),`lenz-position-${theme}-${width}.png`)});}
    assert.deepEqual(errors,[]);checks.push('Phone layout fits all three themes without browser errors');
    await context.close();console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
