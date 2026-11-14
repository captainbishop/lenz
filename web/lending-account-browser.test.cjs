const {walletClick}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {Interface,MaxUint256}=require('../aurora/node_modules/ethers');
const abi=new Interface(['function ADDRESSES_PROVIDER() view returns(address)','function getPool() view returns(address)','function getPriceOracle() view returns(address)','function BASE_CURRENCY() view returns(address)','function BASE_CURRENCY_UNIT() view returns(uint256)','function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)']);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],calls=[];
 const screens=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-lending-account-review');await fs.mkdir(screens,{recursive:true});
 const from='0x'+'12'.repeat(20),provider='0x'+'34'.repeat(20),oracle='0x'+'56'.repeat(20),pool='0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();let failure=false,empty=false,hold=null;
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());
  await page.exposeBinding('fixtureLendingRpc',async(_,r)=>{
   calls.push(r);const basic={eth_requestAccounts:[from],eth_accounts:[from],eth_chainId:'0x1',eth_blockNumber:'0x2a',eth_getBalance:'0xde0b6b3a7640000',eth_getCode:'0x1234',eth_getBlockByNumber:{number:'0x2a',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}};
   if(Object.hasOwn(basic,r.method))return basic[r.method];assert.equal(r.method,'eth_call');assert.equal(r.params[1],'0x2a');
   const {name,args}=abi.parseTransaction({data:r.params[0].data});
   if(failure)throw Error('Fixture RPC unavailable');if(name==='getUserAccountData'){assert.equal(args[0].toLowerCase(),from);if(hold)await hold();}
   return abi.encodeFunctionResult(name,{ADDRESSES_PROVIDER:[provider],getPool:[pool],getPriceOracle:[oracle],BASE_CURRENCY:['0x'+'00'.repeat(20)],BASE_CURRENCY_UNIT:[100000000n],getUserAccountData:empty?[0n,0n,0n,0n,0n,MaxUint256]:[125050000000n,50000000000n,45000000000n,8000n,7600n,2000800000000000000n]}[name]);
  });
  await context.addInitScript(()=>{const handlers=new Map();window.fixtureLendingChange=()=>handlers.get('accountsChanged')?.();const provider={on:(e,f)=>handlers.set(e,f),removeListener:e=>handlers.delete(e),request:r=>fixtureLendingRpc(r)};addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Lending fixture'},provider}})));});
  await page.goto('http://127.0.0.1:4173/money.html');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.getByRole('tab',{name:'DeFi',exact:true}).click();assert.deepEqual(calls,[]);
  const account=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));const before=await account();
  const connect=async()=>{await page.locator('#lending-load').click();await page.getByRole('button',{name:'Lending fixture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#lending-load').textContent==='Load account');};
  await connect();assert(!calls.some(c=>c.method==='eth_call'));await page.locator('#lending-load').click();await page.locator('#lending-values').waitFor();
  assert.deepEqual(await page.locator('#lending-values dd').allTextContents(),['$1,250.50','$500.00','$450.00','2.00']);assert.match(await page.locator('#lending-observed').innerText(),/Read .*Public position/);assert.equal(await page.locator('#lending-network').innerText(),'Ethereum');
  assert(!calls.some(c=>/send|sign|switch/i.test(c.method)));checks.push('DeFi reads only after Load account, shows exact connected Aave values and makes no signing or switching requests');
  await page.locator('#toggle-balances').click();assert.deepEqual(await page.locator('#lending-values dd').allTextContents(),Array(4).fill('••••'));await page.locator('#toggle-balances').click();
  const readCount=calls.length;await page.getByRole('tab',{name:'Tokens',exact:true}).click();await page.getByRole('tab',{name:'DeFi',exact:true}).click();assert.equal(calls.length,readCount);assert.equal(await account(),before);
  checks.push('lending values follow balance masking; changing views does not repeat reads or modify the Lenz account');
  empty=true;await page.locator('#lending-refresh').click();await page.waitForFunction(()=>document.querySelector('#lending-values').textContent.includes('No debt'));assert.deepEqual(await page.locator('#lending-values dd').allTextContents(),['$0.00','$0.00','$0.00','No debt']);
  failure=true;await page.locator('#lending-refresh').click();await page.waitForFunction(()=>document.querySelector('#lending-status').textContent.includes('unavailable'));assert(!await page.locator('#lending-values').isVisible());assert.equal(await page.locator('#lending-values dd').count(),0);assert(await page.locator('#lending-load').isVisible());failure=false;empty=false;
  checks.push('an observed empty account differs from unavailable RPC data; a failed refresh removes old values and permits retry');
  await page.locator('#lending-load').click();await page.locator('#lending-values').waitFor();
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screens,`lending-${theme}-${width}.png`)});}
  let release,started;const ready=new Promise(r=>started=r);hold=()=>new Promise(r=>{release=r;started();});await page.locator('#lending-refresh').click();await ready;await page.evaluate(()=>fixtureLendingChange());hold=null;release();
  await page.waitForFunction(()=>document.querySelector('#lending-load').textContent==='Connect wallet');assert.equal(await page.locator('#lending-values dd').count(),0);assert.equal(await page.locator('#lending-account-address').innerText(),'');
  await connect();await page.locator('#lending-load').click();await page.locator('#lending-values').waitFor();await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#lending-status').textContent.includes('Offline'));assert.equal(await page.locator('#lending-values dd').count(),0);assert(await page.locator('#lending-load').isDisabled());
  checks.push('account changes reject late reads and clear account data; offline state removes current-position values');
  const offlineCalls=calls.length;await context.setOffline(false);
  await page.waitForFunction(()=>!document.querySelector('#lending-load').disabled,{},{timeout:3000});
  assert.equal(calls.length,offlineCalls);assert.equal(await page.locator('#lending-values dd').count(),0);
  assert.equal(await page.locator('#lending-load').innerText(),'Connect wallet');await connect();
  await page.locator('#lending-load').click();await page.locator('#lending-values').waitFor();
  checks.push('reconnecting enables an explicit fresh account read without automatically disclosing the account again');
  assert.equal(await account(),before);assert.deepEqual(errors,[]);const sources={};for(const file of ['web/public/lending-account.js','web/public/lending-account-ui.js','web/public/evm-wallet-ui.js','web/public/wallet-portfolio.js','web/public/wallet-portfolio.css','web/lending-account-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'lending-account-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sources,scope:'Disposable Edge, real UI/IndexedDB, ethers ABI encoding and synthetic wallet RPC; no live account, chain observation, funds or financial operation.'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
