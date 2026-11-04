// Runs the Meteor popup adapter and official Borsh encoder; wallet/RPC/chain are fixtures.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {securityHeaders}=require('./security-policy.mjs');
const c={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',refundPayer:'sponsor.testnet',ready:true};
let order,root=null,mode='cancel',walletAccount='receiver.testnet',signCalls=0,localCalls=0,checkCalls=0,returnedRequest,encodedTx;
const checks=[];
const server=http.createServer(async(req,res)=>{try{
  const f=new URL(req.url,'http://localhost').pathname;
  for(const [name,value]of Object.entries(securityHeaders(f)))res.setHeader(name,value);
  if(f.startsWith('/api/rhea/')){const chunks=[];for await(const ch of req)chunks.push(ch);const input=JSON.parse(Buffer.concat(chunks));res.setHeader('Content-Type','application/json');
    if(f.endsWith('/order')){res.end(JSON.stringify({finality:'FINAL',order}));return;}
    if(f.endsWith('/return')){localCalls++;throw Error('External account cannot use the local sponsor');}
    if(f.endsWith('/deposit-check')){checkCalls++;returnedRequest=input.request;if(!root)throw Error('No final deposit yet');res.end(JSON.stringify({finality:'FINAL',root,spent:null}));return;}
  }
  if(['/near-config.json','/rhea-config.json'].includes(f)){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f.startsWith('/near-')?{network:'testnet',contract:c.reserve,ready:true}:c));return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]??'application/octet-stream');res.end(await fs.readFile(path.join(__dirname,'public',f)));
}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function prepare(p){await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.locator('#near-return-dialog').waitFor({state:'visible'});await idle(p);}
async function submit(p){await p.locator('#near-return-sign').click();await idle(p);}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage(),errors=[],outbound=[];
  p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(!r.url().startsWith(base))outbound.push(r.url());});
  await ctx.route('https://test.rpc.fastnear.com/**',route=>{const data=route.request().postDataJSON();return route.fulfill({json:{jsonrpc:'2.0',id:data.id,result:data.method==='block'?{header:{hash:'11111111111111111111111111111111'}}:{status:{SuccessValue:''},transaction:{hash:'fixture-transaction'}}}});});
  await ctx.exposeBinding('fixtureApproval',async(source,data)=>{
    assert.equal(new URL(source.page.url()).origin,'https://wallet.meteorwallet.app');
    assert.equal(data.network,'testnet');
    if(data.actionType==='login'){
      assert.deepEqual(data.inputs,{methods:[]});return {status:'closed_success',payload:{accountId:walletAccount}};
    }else if(data.actionType==='sign'){
      signCalls++;encodedTx=data.inputs.transactions;assert(encodedTx);
      // The encrypted request must be committed before wallet approval is possible.
      returnedRequest=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState();return (await(await import('/near-protocol.js')).readNearVault(s,c.reserve)).rheaOrders[0].returnRequest;},c);assert(returnedRequest?.id);
      if(mode==='confirm')root={id:returnedRequest.id,owner:returnedRequest.owner,amount:returnedRequest.amount};
      if(mode==='wrong-root')root={id:returnedRequest.id,owner:returnedRequest.owner,amount:'9000000'};
      return mode==='cancel'?{status:'closed_fail'}:{status:'closed_success',payload:{executionOutcomes:[{transaction:{hash:'fixture-transaction'}}]}};
    }else throw Error('Unexpected wallet action: '+data.actionType);
  });
  await ctx.route('https://wallet.meteorwallet.app/**',async route=>{
    const url=new URL(route.request().url());assert(['/connect/testnet/login','/connect/testnet/sign'].includes(url.pathname));
    assert.equal(url.searchParams.get('source'),'wpm');assert.equal(decodeURIComponent(url.searchParams.get('pageUri')),base+'/wallet-lab.html');
    await route.fulfill({contentType:'text/html',body:`<!doctype html><title>Fixture Meteor wallet</title><script>
      let handled=false;const uid=${JSON.stringify(url.searchParams.get('connectionUid'))},origin=${JSON.stringify(base)};
      addEventListener('message',async event=>{
        const data=event.data;if(event.origin!==origin||event.source!==opener||data.uid!==uid||data.status!=='initializing'||handled)return;
        handled=true;opener.postMessage({uid,status:'connected'},origin);
        const result=await fixtureApproval(data);opener.postMessage({uid,...result},origin);
      });</script>`});
  });
  await p.goto(base+'/wallet-lab.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill('External signer test');await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);
  const identityId=await p.evaluate(async c=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),r=await import('/rhea-protocol.js');return updateState(async s=>{const v=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'1');v.roots.push({id:f.id,owner:f.owner,amount:f.amount});const x=await r.prepareRheaSwap(v,s.identity,c,{text:'1',minOutput:'1',receiver:'receiver.testnet',deadlineMs:Date.now()+3600000});x.vault.rheaOrders[0].status={id:x.packet.id,stage:'refunded',instruction:x.packet.instruction};await n.saveNearVault(s,x.vault);return s.identity.profile.id;});},c);
  order=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState();return (await(await import('/near-protocol.js')).readNearVault(s,c.reserve)).rheaOrders[0].status;},c);
  await p.reload();await p.getByRole('button',{name:'Return to Lenz',exact:true}).waitFor();
  await check('page load and forged callback query neither connect nor credit',async()=>{
    assert.equal(outbound.length,0);await p.goto(base+'/wallet-lab.html?transactionHashes=forged&account_id=receiver.testnet');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');assert.equal(await p.locator('#near-total').innerText(),'0');assert.equal(checkCalls,0);assert.equal(await p.locator('#near-signer-disconnect').isVisible(),false);
  });
  await check('testnet login uses the pinned popup adapter without requesting an access key',async()=>{
    await p.locator('#near-signer-connect').click();await p.waitForFunction(()=>document.querySelector('#near-signer-account').textContent.includes('receiver.testnet'));await idle(p);
    assert(outbound.some(u=>u.startsWith('https://wallet.meteorwallet.app/connect/testnet/login')));assert(!outbound.some(u=>u.includes('mainnet')||u.includes('githubusercontent')));
    await p.locator('#rhea-open').click();await p.locator('#rhea-use-account').click();await idle(p);assert.equal(await p.locator('#rhea-receiver').inputValue(),'receiver.testnet');await p.locator('#rhea-close').click();
  });
  await check('failed persistence cannot expose a signing request',async()=>{
    await p.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Commit failed');};});
    await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('could not save'));await idle(p);assert.equal(signCalls,0);await p.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut;});
  });
  await check('wallet cancellation preserves the exact saved request across reload',async()=>{
    await prepare(p);await submit(p);assert.equal(signCalls,1);assert.match(await p.locator('#rhea-feedback').innerText(),/Approval was cancelled/);assert.equal(await p.locator('#near-total').innerText(),'0');const id=returnedRequest.id;
    await p.reload();await p.getByRole('button',{name:'Check refund',exact:true}).waitFor();
    assert.equal(await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState();return (await(await import('/near-protocol.js')).readNearVault(s,c.reserve)).rheaOrders[0].returnRequest.id;},c),id);
  });
  await check('wrong account blocks signing and disconnect retains the Lenz identity',async()=>{
    await p.locator('#near-signer-disconnect').click();await idle(p);walletAccount='other.testnet';await p.locator('#near-signer-connect').click();await idle(p);await prepare(p);await submit(p);assert.equal(signCalls,1);assert.match(await p.locator('#rhea-feedback').innerText(),/Connect the wallet/);
    await p.locator('#near-signer-disconnect').click();await idle(p);walletAccount='receiver.testnet';await p.locator('#near-signer-connect').click();await idle(p);
    assert.equal(await p.evaluate(async()=> (await(await import('/chat-store.js')).readState()).identity.profile.id),identityId);
  });
  await check('wallet success without a matching final root cannot credit value',async()=>{
    mode='success-only';await prepare(p);await submit(p);assert.equal(await p.locator('#near-total').innerText(),'0');assert.match(await p.locator('#rhea-feedback').innerText(),/has not arrived/);
    mode='wrong-root';await prepare(p);await submit(p);assert.equal(await p.locator('#near-total').innerText(),'0');assert.match(await p.locator('#rhea-feedback').innerText(),/could not verify/);root=null;
  });
  await check('wallet transaction serializes the exact bounded action; final root credits once',async()=>{
    mode='confirm';await prepare(p);await submit(p);assert.equal(await p.locator('#near-total').innerText(),'1');assert.equal(localCalls,0);
    const {createRequire}=require('node:module'),r=createRequire(path.join(__dirname,'../contracts/package.json'));const near=r('near-api-js');
    const tx=near.decodeTransaction(Buffer.from(encodedTx,'base64'));assert.equal(tx.signerId,'receiver.testnet');assert.equal(tx.receiverId,c.reserve);assert.equal(tx.actions.length,1);
    const a=tx.actions[0].functionCall;assert.equal(a.methodName,'deposit_offline');assert.equal(a.gas.toString(),'50000000000000');assert.equal(a.deposit.toString(),'30000000000000000000000');assert.deepEqual(JSON.parse(Buffer.from(a.args).toString()),{owner:returnedRequest.owner,amount:'1000000',source:returnedRequest.source,signature:returnedRequest.signature});
    await p.getByRole('button',{name:'Check refund',exact:true}).click();await idle(p);assert.equal(await p.locator('#near-total').innerText(),'1');
  });
  await check('offline reload keeps funds, disconnect works, and narrow layout fits',async()=>{
    await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);
    // Routing fixtures still serve intercepted endpoints in offline mode; block them explicitly.
    await ctx.unroute('https://wallet.meteorwallet.app/**');await ctx.unroute('https://test.rpc.fastnear.com/**');await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='1');await p.locator('#near-signer-disconnect').click();await idle(p);assert.equal(await p.locator('#near-total').innerText(),'1');
    await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  assert.deepEqual(errors,[]);await p.screenshot({path:path.join(__dirname,'evidence/near-signer-fixture.png'),fullPage:true});
  await fs.writeFile(path.join(__dirname,'near-signer-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,signCalls,localCalls,scope:'Isolated Edge, Lenz Meteor popup adapter and near-api-js 7.4.0 Borsh serialization; popup, RPC, and chain responses are controlled fixtures. No live chain transaction or real wallet authorization.'},null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
