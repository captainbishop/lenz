const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {securityHeaders}=require('./security-policy.mjs');
const account='0x'+'ab'.repeat(20),other='0x'+'cd'.repeat(20),contract='reserve.lenz.testnet';
const server=http.createServer(async(req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname;
 for(const[k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[file==='/'?'.html':path.extname(file)]??'application/octet-stream');
 try{res.end(file==='/near-config.json'?JSON.stringify({network:'testnet',ready:true,contract}):await fs.readFile(path.join(__dirname,'public',file==='/'?'index.html':file)));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),p=await context.newPage(),errors=[],calls=[];let held=null,delay=false,invalid=false;
 p.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(({account})=>{
  const listeners={};window.testWallet={account,calls:[],change(value){this.account=value;for(const fn of listeners.accountsChanged??[])fn([value]);}};
  window.ethereum={on(name,fn){(listeners[name]??=[]).push(fn);},removeListener(name,fn){listeners[name]=(listeners[name]??[]).filter(value=>value!==fn);},async request({method}){testWallet.calls.push(method);if(['eth_requestAccounts','eth_accounts'].includes(method))return[testWallet.account];if(method==='eth_chainId')return'0x1';if(method==='eth_blockNumber')return'0x10';if(method==='eth_getBalance')return'0xde0b6b3a7640000';throw Error('Unexpected wallet request '+method);}};
 },{account});
 await context.route('https://api.hyperliquid-testnet.xyz/**',async route=>{
  const body=route.request().postDataJSON();calls.push(body);assert.equal(new URL(route.request().url()).pathname,'/info');
  if(body.type==='userFillsByTime'){
   if(delay)await new Promise(resolve=>held=resolve);
   const row=(tid,dir,closedPnl)=>({tid,coin:'HYPE',dir,closedPnl,fee:'1',feeToken:'USDC',px:'20',sz:'2',time:body.startTime+tid*1000});
   await route.fulfill({json:invalid?null:[row(1,'Open Long','0'),row(2,'Close Long','10'),row(3,'Close Short','-4'),row(4,'Close Long','0')]});
  }else if(body.type==='clearinghouseState')await route.fulfill({json:{marginSummary:{accountValue:'100.5'},withdrawable:'80',assetPositions:[{position:{coin:'HYPE',szi:'2',entryPx:'20',unrealizedPnl:'6',liquidationPx:'10',marginUsed:'12'}}]}});
  else if(body.type==='openOrders')await route.fulfill({json:[{coin:'NEAR',oid:123,side:'B',sz:'10',limitPx:'0.00012345',timestamp:Date.now()}]});else throw Error('Unexpected account lookup');
 });
 const load=p=>p.locator('#account-load-history').click();
 async function connect(){await p.locator('#account-connect-wallet').click();await p.locator('#account-wallet-options button').click();await p.waitForFunction(()=>document.querySelector('#account-funds-source').value!=='lenz');}
 try{
  await p.goto(base+'/account.html');await p.waitForFunction(()=>document.querySelector('#account-history-empty').textContent.includes('Create or restore'));
  assert.equal(calls.length,0);assert.equal(await p.locator('#account-pnl').innerText(),'—');await connect();assert.equal(calls.length,0);await p.waitForFunction(()=>document.querySelector('#account-funds').textContent==='1 ETH');assert((await p.locator('#account-panel-balances').innerText()).includes('1 ETH'));await p.locator('#toggle-balances').click();await p.locator('#toggle-balances').click();assert.equal(await p.locator('#account-chart-empty').innerText(),'Load activity to see performance.');
  await load(p);await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='+2.00 USDC');
  assert.equal(await p.locator('#account-volume').innerText(),'160.00 USDC');assert.equal(await p.locator('#account-win-rate').innerText(),'33.3%');assert.equal(await p.locator('#account-loss-rate').innerText(),'33.3%');assert.equal(await p.locator('#account-funds').innerText(),'100.50 USDC');assert.equal(calls.length,3);assert(calls.every(row=>row.user===account));
  assert((await p.locator('#account-panel-balances').innerText()).includes('80.00 USDC'));await p.getByRole('tab',{name:'Positions',exact:true}).click();assert.match(await p.locator('#account-panel-positions').innerText(),/HYPE \/ USDC\s+Long/);assert((await p.locator('#account-panel-positions').innerText()).includes('+6.00 USDC'));
  await p.getByRole('tab',{name:'Open orders',exact:true}).click();assert.match(await p.locator('#account-panel-orders').innerText(),/NEAR \/ USDC\s+Buy/);assert((await p.locator('#account-panel-orders').innerText()).includes('0.00012345 USDC'));await p.getByRole('tab',{name:'History',exact:true}).click();assert.equal(await p.locator('#account-history-list [data-record]').count(),4);assert.equal(calls.length,3);
  assert.deepEqual(await p.evaluate(async()=>Object.keys(await(await import('/chat-store.js')).readState()).sort()),['contacts','identity','messages']);
  const guest=await p.evaluate(async()=>{const m=await(await import('/account-keys.js')).accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer,'Amina');await(await import('/account-sync.js')).setUpAccount(m);return(await(await import('/chat-store.js')).readState()).identity.profile.id;});assert(guest);
  console.log('PASS explicit loading, exact figures and all four tabs, no spending calls, guest cache preserves account creation');
  await p.evaluate(async()=>{await(await import('/chat-store.js')).updateState(s=>{delete s.accountSync;});});
  await p.reload();await p.waitForFunction(()=>document.querySelector('#account-funds-source').options.length===1);
  await connect();await load(p);await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='+2.00 USDC');
  const sibling=await context.newPage();await sibling.goto(base+'/account.html');await sibling.locator('#toggle-balances').click();await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='••••');assert.equal(await p.locator('#account-pnl-chart svg').count(),0);await sibling.locator('#toggle-balances').click();await p.waitForFunction(()=>document.querySelector('#account-pnl-chart svg').children.length>0);await sibling.close();
  console.log('PASS changing identity hides guest history; amount hiding also removes the chart across tabs');
  delay=true;await load(p);await p.waitForFunction(()=>document.querySelector('#account-performance-status').textContent.includes('Loading'));while(!held)await p.waitForTimeout(10);await p.evaluate(()=>dispatchEvent(new Event('lenz-backup-status')));held();held=null;delay=false;await p.waitForFunction(()=>document.querySelector('#account-performance-status').textContent==='');assert.equal(await p.locator('#account-pnl').innerText(),'+2.00 USDC');
  delay=true;await load(p);await p.waitForFunction(()=>document.querySelector('#account-performance-status').textContent.includes('Loading'));while(!held)await p.waitForTimeout(10);await p.locator('#account-funds-source').selectOption('lenz');held();held=null;delay=false;await p.waitForTimeout(100);assert.equal(await p.locator('#account-pnl').innerText(),'—');assert.equal(await p.locator('#account-funds-source').inputValue(),'lenz');
  await p.locator('#account-funds-source').selectOption(account);await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='+2.00 USDC');invalid=true;await load(p);await p.waitForFunction(()=>document.querySelector('#account-performance-status').textContent.includes('could not'));assert.equal(await p.locator('#account-pnl').innerText(),'+2.00 USDC');invalid=false;
  console.log('PASS source switching rejects late responses; invalid refresh preserves saved history');
  await p.evaluate(async contract=>{
   const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),crypto=await import('/peer-crypto.js');
   await store.updateState(async s=>{const bob=await crypto.createIdentity('Bola'),root=await n.fundingRequest(s.identity,contract,'100'),vault=n.emptyNearVault(contract);vault.roots.push({id:root.id,owner:root.owner,amount:root.amount});const payment=await n.makeNearPayment(vault,s.identity,bob.profile,'25');await n.saveNearVault(s,payment.vault);});
   const cache=await caches.open('account-fixture');await cache.put('/near-config.json',new Response(JSON.stringify({network:'testnet',ready:true,contract}),{headers:{'Content-Type':'application/json'}}));
  },contract);
  await p.locator('#account-funds-source').selectOption('lenz');await p.waitForFunction(()=>document.querySelector('#account-funds').textContent==='75 tUSD');assert.equal(await p.locator('#account-pnl').innerText(),'—');assert.equal(await p.locator('#account-positions-list [data-record]').count(),0);assert.equal(await p.locator('#account-orders-list [data-record]').count(),0);
  const walletTab=await context.newPage();await walletTab.goto(base+'/account.html');await walletTab.evaluate(async contract=>{const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),crypto=await import('/peer-crypto.js');await store.updateState(async s=>{const vault=await n.readNearVault(s,contract),recipient=await crypto.createIdentity('Another recipient'),payment=await n.makeNearPayment(vault,s.identity,recipient.profile,'10');await n.saveNearVault(s,payment.vault);});const channel=new BroadcastChannel('proof-u-chat-refresh');channel.postMessage('changed');channel.close();},contract);await p.waitForFunction(()=>document.querySelector('#account-funds').textContent==='65 tUSD',null,{timeout:3000});await walletTab.close();
  console.log('PASS Lenz funds count only owned notes and follow wallet changes in another tab, separate from external USDC');
  await p.locator('#account-funds-source').selectOption(account);await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='+2.00 USDC');
  const deadline=Date.now()+30000;while(!await p.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/account.html'))?.active)){assert(Date.now()<deadline,'Account offline worker did not activate');await p.waitForTimeout(50);}
  const count=calls.length;await context.setOffline(true);await p.reload();await p.locator('#account-funds-source').selectOption(account);await p.waitForFunction(()=>document.querySelector('#account-pnl').textContent==='+2.00 USDC');assert(await p.locator('#account-load-history').isDisabled());assert((await p.locator('#account-performance-note').innerText()).includes('Offline'));assert.equal(calls.length,count);
  console.log('PASS saved Account shell and encrypted performance reload with HTTP offline and no wallet connection');
  for(const tab of ['Balances','Positions','Open orders','History']){await p.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await p.locator('#account-funds-source').inputValue(),account);}
  await p.getByRole('tab',{name:'History',exact:true}).press('Home');assert.equal(await p.getByRole('tab',{name:'Balances',exact:true}).getAttribute('aria-selected'),'true');await p.getByRole('tab',{name:'Balances',exact:true}).press('End');assert.equal(await p.getByRole('tab',{name:'History',exact:true}).getAttribute('aria-selected'),'true');
  for(const theme of ['light','dim','dark'])for(const width of [375,812,1280]){
   await p.setViewportSize({width,height:width===812?375:900});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(n=>[n.id,n.className,n.getBoundingClientRect().width,n.getBoundingClientRect().right]))));
   if(width===375)await p.screenshot({path:path.join(os.tmpdir(),'lenz-account-'+theme+'.png'),fullPage:true});
   if(width===1280){await p.getByRole('tab',{name:'Positions',exact:true}).click();await p.screenshot({path:path.join(os.tmpdir(),'lenz-account-desktop-'+theme+'.png'),fullPage:true});await p.getByRole('tab',{name:'History',exact:true}).click();}
  }
  await p.addStyleTag({content:'.account-page{font-size:24px}.account-stats dd{font-size:32px}'});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert((await p.evaluate(()=>testWallet.calls)).every(method=>!method.includes('sign')&&!method.includes('send')));
  await p.evaluate(()=>{const original=crypto.subtle.decrypt.bind(crypto.subtle);window.decryptHeld=false;window.releaseDecrypt=null;crypto.subtle.decrypt=async(...args)=>{const value=await original(...args);if(!decryptHeld&&new TextDecoder().decode(args[0].additionalData).startsWith('lenz-account-performance-v1:')){decryptHeld=true;await new Promise(resolve=>releaseDecrypt=resolve);}return value;};dispatchEvent(new Event('lenz-hyper-orders'));});
  await p.waitForFunction(()=>decryptHeld);await p.evaluate(async()=>{await(await import('/chat-store.js')).updateState(async s=>{s.identity=await(await import('/peer-crypto.js')).createIdentity('New profile');delete s.nearBox;delete s.nearKey;});dispatchEvent(new Event('lenz-account-identity'));});await p.waitForFunction(()=>document.querySelector('#account-funds-source').options.length===1);await p.evaluate(()=>releaseDecrypt());await p.waitForTimeout(100);
  assert.equal(await p.locator('#account-funds-source option').count(),1);assert.equal(await p.locator('#account-pnl').innerText(),'—');
  console.log('PASS delayed decrypted history cannot reappear under a different Lenz identity');
  console.log('PASS responsive Account in three themes, no browser errors or wallet signing');
 }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
