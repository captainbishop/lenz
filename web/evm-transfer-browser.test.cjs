const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],screens=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-wallet-send-review');await fs.mkdir(screens,{recursive:true});
 const from='0x'+'12'.repeat(20),to='0x'+'34'.repeat(20),word=n=>BigInt(n).toString(16).padStart(64,'0');
 async function fixture(){
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),calls=[],transactions=new Map(),receipts=new Map(),state={sends:0,nonce:0n,final:false,lost:false,decline:false,hook:null};
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());
  if(process.env.LENZ_TRANSFER_MUTATION){const mutation=JSON.parse(await fs.readFile(process.env.LENZ_TRANSFER_MUTATION,'utf8'));await page.route('**/'+mutation.file,r=>r.fulfill({contentType:'text/javascript',body:mutation.source}));}
  await page.exposeBinding('fixtureWalletRpc',async(_,request)=>{
   calls.push(request);const {method,params}=request;
   if(state.hook){const value=await state.hook(method,params);if(value!==undefined)return {ok:true,value};}
   if(method==='eth_requestAccounts'||method==='eth_accounts')return {ok:true,value:[from]};if(method==='eth_chainId')return {ok:true,value:'0x1'};if(method==='eth_blockNumber')return {ok:true,value:'0x29'};
   if(method==='eth_getBalance')return {ok:true,value:'0x56bc75e2d63100000'};if(method==='eth_getTransactionCount')return {ok:true,value:'0x'+state.nonce.toString(16)};
   if(method==='eth_gasPrice')return {ok:true,value:'0x3b9aca00'};if(method==='eth_estimateGas')return {ok:true,value:params[0].data==='0x'?'0x5208':'0x186a0'};
   if(method==='eth_getCode')return {ok:true,value:'0x1234'};if(method==='eth_call')return {ok:true,value:'0x'+word(params[0].data==='0x313ce567'?6:10000000)};
   if(method==='eth_sendTransaction'){
    state.sends++;if(state.decline)return {ok:false,message:'Declined in fixture wallet',code:4001};
    const tx=params[0],id='0x'+word(state.sends),blockHash='0x'+word(state.sends+100),blockNumber='0x'+(state.sends+40).toString(16);state.nonce++;
    transactions.set(id,{...tx,input:tx.data,hash:id,blockHash,blockNumber,transactionIndex:'0x0'});
    receipts.set(id,{transactionHash:id,from:tx.from,to:tx.to,blockHash,blockNumber,transactionIndex:'0x0',status:'0x1',gasUsed:'0x5208',effectiveGasPrice:tx.gasPrice,logs:tx.data==='0x'?[]:[{address:tx.to,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+tx.from.slice(2).padStart(64,'0'),'0x'+tx.data.slice(10,74)],data:'0x'+tx.data.slice(74)}]});
    return state.lost?{ok:false,message:'Fixture response lost'}:{ok:true,value:id};
   }
   if(method==='eth_getTransactionByHash')return {ok:true,value:transactions.get(params[0])??null};if(method==='eth_getTransactionReceipt')return {ok:true,value:receipts.get(params[0])??null};
   if(method==='eth_getBlockByNumber'){if(params[0]==='finalized')return {ok:true,value:state.final?{hash:'0x'+word(999),number:'0xff'}:null};const tx=[...transactions.values()].find(t=>t.blockNumber===params[0]);return {ok:true,value:tx?{number:tx.blockNumber,hash:tx.blockHash,transactions:[tx.hash]}:null};}
   throw Error('Unexpected wallet call '+method);
  });
  await context.addInitScript(()=>{
   const handlers=new Map();window.fixtureEmit=event=>handlers.get(event)?.();
   const provider={on(e,fn){handlers.set(e,fn);},removeListener(e,fn){if(handlers.get(e)===fn)handlers.delete(e);},async request(value){const r=await window.fixtureWalletRpc(value);if(!r.ok)throw Object.assign(Error(r.message),{code:r.code});return r.value;}};
   addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Transfer fixture'},provider}})));
  });
  const connect=async()=>{await page.locator('#evm-connect').click();await page.getByRole('button',{name:'Transfer fixture',exact:true}).click();await page.locator('#evm-account').waitFor();};
  await page.goto('http://127.0.0.1:4173/money.html');await connect();
  const review=async(asset='ETH')=>{await page.locator('#evm-send').click();await page.locator('#evm-send-assets').getByRole('button',{name:asset,exact:true}).click();await page.locator('#evm-send-recipient').fill(to);await page.getByRole('combobox',{name:'Receiving network',exact:true}).click();await page.getByRole('option',{name:'Ethereum',exact:true}).click();await page.locator('#evm-send-amount').fill(asset==='ETH'?'1.25':'2.500001');await page.locator('#evm-send-consent').check();await page.locator('#evm-send-review').click();await page.locator('#evm-send-approve').waitFor();};
  return {context,page,state,calls,connect,review,transactions,receipts};
 }
 try{
  const f=await fixture(),{page:p}=f;const lenzState=()=>p.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));const initial=await lenzState();
  await p.locator('#evm-send').click();await p.locator('#evm-send-recipient').fill(to);await p.locator('#evm-send-amount').fill('1.25');assert(await p.locator('#evm-send-review').isDisabled());assert.equal(f.calls.filter(c=>c.method==='eth_estimateGas').length,0);await p.keyboard.press('Escape');
  await f.review();assert.equal(f.state.sends,0);assert((await p.locator('#evm-send-summary').innerText()).includes(to));await p.locator('#evm-send-edit').click();await p.locator('#evm-send-amount').fill('2');assert.equal(await p.locator('#evm-send-approve').isVisible(),false);await p.keyboard.press('Escape');
  checks.push('public disclosure precedes transfer queries; reviewed terms are exact and editing removes approval');
  await f.review();for(const theme of ['light','dark'])for(const width of [320,390,768,1280]){await p.setViewportSize({width,height:900});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(200);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(screens,`send-${theme}-${width}.png`)});}
  await p.evaluate(()=>{window.originalTransferPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='lenz-evm-transfers-v1')throw Error('Fixture storage failure');return originalTransferPut.apply(this,args);};});
  await p.locator('#evm-send-approve').click();await p.waitForFunction(()=>document.querySelector('#evm-send-status').textContent.includes('Fixture storage failure'));assert.equal(f.state.sends,0);await p.evaluate(()=>IDBObjectStore.prototype.put=originalTransferPut);await p.keyboard.press('Escape');
  checks.push('failed durable storage prevents wallet dispatch; review fits phone and desktop in both themes');
  await f.review();let release,started;const ready=new Promise(r=>started=r);f.state.hook=method=>method==='eth_getTransactionCount'?new Promise(r=>{release=r;started();}):undefined;
  await p.locator('#evm-send-approve').click();await ready;await p.keyboard.press('Escape');f.state.hook=null;release('0x0');await p.waitForFunction(()=>!document.querySelector('#evm-send-review').disabled);assert.equal(f.state.sends,0);
  checks.push('closing review during preflight prevents a later wallet prompt');
  await f.review();await p.locator('#evm-send-approve').click();await p.waitForFunction(()=>document.querySelector('#evm-send-status').textContent==='Sent · waiting for confirmation');await p.keyboard.press('Escape');assert.equal(f.state.sends,1);assert(await p.locator('#evm-send').isDisabled());
  await p.locator('.evm-transfer-row').getByRole('button',{name:'Check status'}).click();await p.waitForFunction(()=>document.querySelector('#evm-transfer-list').textContent.includes('Confirming transfer'));assert(await p.locator('#evm-send').isDisabled());
  const stored=await p.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-evm-transfers-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('state'),q=tx.objectStore('state').get('transfers');q.onsuccess=()=>{const s=q.result;resolve({fields:Object.keys(s).sort(),extractable:s.key.extractable,plaintext:new TextDecoder().decode(s.box)});db.close();};q.onerror=()=>reject(q.error);};}));assert.deepEqual(stored.fields,['box','iv','key']);assert.equal(stored.extractable,false);assert(!stored.plaintext.includes(to));assert.equal(await lenzState(),initial);
  await p.reload();await f.connect();await p.locator('.evm-transfer-row').waitFor();assert((await p.locator('#evm-transfer-list').innerText()).includes('Confirming transfer'));f.state.final=true;await p.locator('.evm-transfer-row').getByRole('button',{name:'Check status'}).click();await p.waitForFunction(()=>document.querySelector('#evm-transfer-list').textContent.includes('Transfer confirmed'));assert.equal(f.state.sends,1);assert.equal(await lenzState(),initial);
  checks.push('encrypted journal survives reload, preserves Lenz identity, distinguishes inclusion from finality and never resends');
  await f.review('USDC');f.state.lost=true;await p.locator('#evm-send-approve').click();await p.waitForFunction(()=>document.querySelector('#evm-send-status').textContent.includes('Wallet response lost · check before trying again'));await p.keyboard.press('Escape');assert.equal(f.state.sends,2);assert(await p.locator('#evm-send').isDisabled());
  await p.reload();await f.connect();const recovery=p.locator('.evm-transfer-row').filter({has:p.locator('input')});await recovery.locator('input').fill('0x'+word(1));await recovery.getByRole('button',{name:'Check status'}).click();await p.waitForFunction(()=>[...document.querySelectorAll('.evm-transfer-row p')].some(n=>n.textContent.includes('does not match')));assert(await p.locator('#evm-send').isDisabled());
  await recovery.locator('input').fill('0x'+word(2));await recovery.getByRole('button',{name:'Check status'}).click();await p.waitForFunction(()=>[...document.querySelectorAll('.evm-transfer-row')].every(n=>n.textContent.includes('Transfer confirmed')));assert.equal(f.state.sends,2);assert.equal(await lenzState(),initial);
  checks.push('lost ERC20 send reply recovers from the exact wallet hash; unrelated hash cannot confirm or unlock another send');
  await f.review();await p.evaluate(()=>fixtureEmit('chainChanged'));await p.locator('#evm-send-dialog').waitFor({state:'hidden'});assert.equal(f.state.sends,2);await f.connect();
  await p.locator('.wallet-settings summary').click();await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await f.context.setOffline(true);await p.reload();await p.locator('#evm-connect').waitFor();assert(await p.locator('#evm-connect').isDisabled());assert.equal(f.state.sends,2);await f.context.setOffline(false);await f.connect();await p.waitForFunction(()=>document.querySelectorAll('.evm-transfer-row').length===2);
  checks.push('network changes invalidate review; offline reload preserves encrypted history without prompting or sending');
  assert.deepEqual(errors,[]);const sources={};for(const file of ['web/public/evm-wallet.js','web/public/evm-wallet-ui.js','web/public/evm-transfer.js','web/public/evm-transfer-store.js','web/public/evm-transfer-service.js','web/public/evm-transfer-ui.js','web/public/workspace-layout.css','web/public/money.css','web/public/chat-sw.js','web/public/evm-vendor/address.js','web/evm-transfer-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'evm-transfer-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sources,scope:'Disposable Edge with injected wallet/chain fixture and actual IndexedDB, QR/cache and UI. No installed wallet, live chain, funds, signature or external transaction.'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
