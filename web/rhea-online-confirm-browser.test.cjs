const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');

test('online Rhea confirmation submits the retained request and fences interrupted signing, replies and account changes',async t=>{
 const root=path.join(__dirname,'public'),near={network:'testnet',contract:'online-confirm.testnet',ready:true},config={network:'testnet',adapter:'online-adapter.testnet',reserve:near.contract,exchange:'ref-finance-101.testnet',poolId:1,tokenOut:'wrap.testnet',ready:true};
 let mode='complete',release=null;const requests=[];
 const server=http.createServer(async(req,res)=>{
  const name=new URL(req.url,'http://local').pathname;
  const reply=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(name==='/fixture'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/chat.css"><link rel="stylesheet" href="/money.css"><link rel="stylesheet" href="/form-controls.css"><link rel="stylesheet" href="/intent-near-ui.css"><script type="module" src="/form-controls.js"></script><body class="money-page"><main><div id="wallet-content"><div class="wallet-lower"></div></div></main></body></html>');return;}
  if(name==='/near-config.json'){reply(near);return;}if(name==='/rhea-config.json'){reply(config);return;}
  if(name.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
   if(name==='/api/defi/rhea/quote'){const amountOut=(BigInt(data.amountIn)*2000000000000000n).toString();reply({request:data,amountOut,minAmountOut:(BigInt(amountOut)*BigInt(10000-data.slippageBps)/10000n).toString()});return;}
   requests.push({name,data});
   if(name==='/api/rhea/signed-submit'){
    if(mode==='held')await new Promise(resolve=>{release=resolve;});
    if(mode==='lost'){reply({error:'Original response lost'},503);return;}
    reply({finality:'FINAL',order:{id:data.packet.id,instruction:mode==='forged'?{...data.packet.instruction,receiver_id:'changed.testnet'}:data.packet.instruction,stage:mode==='held'?'checking':'complete'}});return;
   }
   reply({error:'No other financial action in this fixture'},503);return;
  }
  try{const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));const body=await fs.readFile(file);res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream'});res.end(body);}catch{if(!res.headersSent)res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 async function visitor(){
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(6000);await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
  await page.evaluate(async contract=>{
   const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js'),n=await import('/near-protocol.js'),wallet=await import('/near-wallet.js');
   await store.updateState(async s=>{s.identity=await peer.createIdentity('Online confirm fixture');const vault=n.emptyNearVault(contract),fund=await n.fundingRequest(s.identity,contract,'10');vault.roots.push({id:fund.id,owner:fund.owner,amount:fund.amount});await n.saveNearVault(s,vault);});
   localStorage.setItem('lenz-meteor-testnet-v1:accountId','online-receiver.testnet');globalThis.signs=0;const sign=crypto.subtle.sign.bind(crypto.subtle);crypto.subtle.sign=(...args)=>{signs++;return sign(...args);};
   wallet.mountNearWallet({action:async op=>{try{await op();}catch(e){document.querySelector('#rhea-feedback').textContent=e.message;}finally{await wallet.renderNearWallet(await store.readState());}},status:()=>{}});await wallet.loadNearConfig();await wallet.renderNearWallet(await store.readState());
  },near.contract);
  await page.locator('#rhea-open').click();await page.locator('#rhea-use-public-route').click();await page.locator('#rhea-amount').fill('0.25');await page.waitForFunction(()=>document.querySelector('#rhea-minimum').value==='0.000495');
  return {context,page};
 }
 async function review(page){await page.locator('#rhea-form button[type=submit]').click();await page.locator('#rhea-save-review').waitFor();assert.equal(await page.evaluate(()=>signs),0);}
 try{
  await t.test('online review is unsigned, explicit confirmation starts one swap immediately',async()=>{
   requests.length=0;mode='complete';const {context,page}=await visitor();await review(page);assert.equal(await page.locator('#rhea-save-confirm').innerText(),'Confirm swap');assert.match(await page.locator('#rhea-save-review').innerText(),/starts.*Rhea/);assert.deepEqual(requests,[]);
   await page.locator('#rhea-save-confirm').evaluate(button=>{button.click();button.click();});await page.getByText('Swap complete',{exact:true}).first().waitFor();assert.equal(requests.length,1);assert.equal(requests[0].name,'/api/rhea/signed-submit');assert.equal(requests[0].data.packet.instruction.amount,'250000');assert.equal(await page.evaluate(()=>signs),3);await context.close();
  });
  await t.test('failed encrypted commit produces no execution request',async()=>{
   requests.length=0;const {context,page}=await visitor();await review(page);await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Swap storage failed');};});await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('could not save'));assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('identity invalidation during signing saves no dispatched authority',async()=>{
   requests.length=0;const {context,page}=await visitor();await review(page);await page.evaluate(()=>{const sign=crypto.subtle.sign.bind(crypto.subtle);crypto.subtle.sign=async(...args)=>{const value=await sign(...args);dispatchEvent(new Event('lenz-account-identity'));return value;};});await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('late submit response cannot update another account or advance the old request',async()=>{
   requests.length=0;mode='held';release=null;const {context,page}=await visitor();await review(page);await page.locator('#rhea-save-confirm').click();for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,20));assert(release);
   await page.evaluate(async()=>{const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');await store.updateState(async s=>{globalThis.originalOwner=s.identity;s.identity=await peer.createIdentity('Changed account');});dispatchEvent(new Event('lenz-account-identity'));});release();await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.equal(requests.length,1);
   await page.evaluate(async()=>{const store=await import('/chat-store.js');await store.updateState(s=>{s.identity=originalOwner;});await(await import('/near-wallet.js')).renderNearWallet(await store.readState());});assert.equal(await page.getByText('Swap complete',{exact:true}).count(),0);assert(await page.getByText('Saved · money set aside',{exact:true}).isVisible());await context.close();
  });
  await t.test('lost reply retains the original packet and retry uses that exact permission',async()=>{
   requests.length=0;mode='lost';const {context,page}=await visitor();await review(page);await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('Check the original swap'));assert.equal(requests.length,1);const original=requests[0].data;
   mode='complete';await page.getByRole('button',{name:'Start swap',exact:true}).click();await page.getByText('Swap complete',{exact:true}).first().waitFor();assert.equal(requests.length,2);assert.deepEqual(requests[1].data,original);assert.equal(await page.evaluate(()=>signs),3);await context.close();
  });
  await t.test('offline confirmation stays saved after reconnection without dispatch',async()=>{
   requests.length=0;const {context,page}=await visitor();await context.setOffline(true);await review(page);assert.equal(await page.locator('#rhea-save-confirm').innerText(),'Authorize and save');await page.locator('#rhea-save-confirm').click();await page.getByText('Saved · money set aside',{exact:true}).waitFor();await context.setOffline(false);await page.locator('#rhea-open').click();await page.locator('#rhea-dialog').waitFor();assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('account change while reading the retained signed request blocks dispatch',async()=>{
   requests.length=0;mode='complete';const {context,page}=await visitor();await review(page);
   await page.evaluate(()=>{const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=async(...args)=>{const value=await decrypt(...args);let vault;try{vault=JSON.parse(new TextDecoder().decode(value));}catch{}if(vault?.rheaOrders?.length&&!globalThis.preSubmitHeld){globalThis.preSubmitHeld=true;await new Promise(resolve=>globalThis.releasePreSubmit=resolve);}return value;};});
   await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>globalThis.preSubmitHeld);
   await page.evaluate(async()=>{const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await peer.createIdentity('Changed before submit');});dispatchEvent(new Event('lenz-account-identity'));releasePreSubmit();});
   await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('a start deadline reached during signed-request loading cannot dispatch',async()=>{
   requests.length=0;mode='complete';const {context,page}=await visitor();await review(page);
   await page.evaluate(()=>{const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=async(...args)=>{const value=await decrypt(...args);let vault;try{vault=JSON.parse(new TextDecoder().decode(value));}catch{}if(vault?.rheaOrders?.length){const expiry=Number(vault.rheaOrders[0].packet.instruction.deadline_ms);Date.now=()=>expiry+1;}return value;};});
   await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('pagehide during retained-request decryption invalidates dispatch without changing stored identity',async()=>{
   requests.length=0;mode='complete';const {context,page}=await visitor();await review(page);
   await page.evaluate(()=>{const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=async(...args)=>{const value=await decrypt(...args);let vault;try{vault=JSON.parse(new TextDecoder().decode(value));}catch{}if(vault?.rheaOrders?.length&&!globalThis.preSubmitHeld){globalThis.preSubmitHeld=true;await new Promise(resolve=>globalThis.releasePreSubmit=resolve);}return value;};});
   await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>globalThis.preSubmitHeld);
   await page.evaluate(()=>{dispatchEvent(new Event('pagehide'));releasePreSubmit();});
   await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('a changed persisted owner is checked after decryption before its UI identity event arrives',async()=>{
   requests.length=0;mode='complete';const {context,page}=await visitor();await review(page);
   await page.evaluate(()=>{const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=async(...args)=>{const value=await decrypt(...args);let vault;try{vault=JSON.parse(new TextDecoder().decode(value));}catch{}if(vault?.rheaOrders?.length&&!globalThis.preSubmitHeld){globalThis.preSubmitHeld=true;await new Promise(resolve=>globalThis.releasePreSubmit=resolve);}return value;};});
   await page.locator('#rhea-save-confirm').click();await page.waitForFunction(()=>globalThis.preSubmitHeld);
   await page.evaluate(async()=>{const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await peer.createIdentity('Persisted owner changed');});releasePreSubmit();});
   await page.waitForFunction(()=>!document.querySelector('#rhea-save-confirm').disabled);assert.deepEqual(requests,[]);await context.close();
  });
  await t.test('a forged final reply cannot replace signed terms or consume the retained reservation',async()=>{
   requests.length=0;mode='forged';const {context,page}=await visitor();await review(page);await page.locator('#rhea-save-confirm').click();
   await page.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('Check the original swap'));
   assert.equal(requests.length,1);const original=requests[0].data;
   const saved=await page.evaluate(async contract=>{const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),vault=await n.readNearVault(await store.readState(),contract);return vault.rheaOrders[0];},near.contract);
   assert.deepEqual(saved.packet,original.packet);assert.equal(saved.status,null);assert(await page.getByText('Saved · money set aside',{exact:true}).isVisible());
   mode='complete';await page.getByRole('button',{name:'Start swap',exact:true}).click();await page.getByText('Swap complete',{exact:true}).first().waitFor();assert.deepEqual(requests[1].data,original);assert.equal(await page.evaluate(()=>signs),3);await context.close();
  });
 }finally{release?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
