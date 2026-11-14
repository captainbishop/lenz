const {walletClick}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],calls=[];
 const screens=process.env.LENZ_WALLET_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-send-entry-review');await fs.mkdir(screens,{recursive:true});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const from='0x'+'12'.repeat(20),to='0x'+'34'.repeat(20);let hold=null,decline=false,chain='0x1',pauseDecode=null;
 try{
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',r=>r.abort());
  const contactSource=await fs.readFile(path.join(__dirname,'public/contact-card.js'),'utf8');
  assert(contactSource.includes('export async function decodeLenzId(value) {'));
  await page.route('**/contact-card.js',r=>r.fulfill({contentType:'text/javascript',body:contactSource.replace('export async function decodeLenzId(value) {','export async function decodeLenzId(value) { await globalThis.fixtureDecode?.();')}));
  await page.exposeBinding('fixtureDecode',()=>pauseDecode?.());
  await page.exposeBinding('fixtureRpc',async(_,request)=>{
   calls.push(request);if(request.method==='eth_requestAccounts'){if(hold)await hold();if(decline)return {error:'Declined',code:4001};}
   const values={eth_requestAccounts:[from],eth_accounts:[from],eth_chainId:chain,eth_blockNumber:'0x2a',eth_getBalance:'0xde0b6b3a7640000',eth_getTransactionCount:'0x0',eth_gasPrice:'0x3b9aca00',eth_estimateGas:'0x5208'};
   if(!Object.hasOwn(values,request.method))throw Error('Unexpected request '+request.method);return {value:values[request.method]};
  });
  await context.addInitScript(()=>{
   const listeners=new Map();window.fixtureEmit=e=>listeners.get(e)?.();
   const provider={on:(e,f)=>listeners.set(e,f),removeListener:e=>listeners.delete(e),request:async r=>{const result=await fixtureRpc(r);if(result.error)throw Object.assign(Error(result.error),{code:result.code});return result.value;}};
   addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'Entry fixture'},provider}})));
  });
  await page.goto('http://127.0.0.1:4173/money.html');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  const open=async()=>{await page.locator('#wallet-send').click();await page.locator('#evm-send-recipient').waitFor();};
  const network=async name=>{await page.getByRole('combobox',{name:'Receiving network',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();};
  const connect=async()=>{await page.getByRole('button',{name:'Entry fixture',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#evm-account').hidden);};
  await open();assert.equal(await page.evaluate(()=>document.activeElement.id),'evm-send-recipient');assert(!await page.locator('#wallet-asset-dialog').isVisible());assert(!await page.locator('#evm-connect-dialog').isVisible());
  assert.equal(await page.locator('#wallet-send').innerText(),'');assert.equal(await page.locator('#wallet-receive').innerText(),'');
  await page.locator('#evm-send-recipient').fill(to);await network('Ethereum');await page.locator('#evm-send-amount').fill('0.1');await page.locator('#evm-send-consent').check();assert.deepEqual(calls,[]);
  await page.locator('#evm-send-review').click();await page.locator('#evm-connect-dialog').waitFor();await page.locator('#evm-connect-close').click();assert.equal(await page.locator('#evm-send-recipient').inputValue(),to);assert.equal(await page.locator('#evm-send-amount').inputValue(),'0.1');assert.deepEqual(calls,[]);
  checks.push('Send opens focused recipient entry and icon actions; entering terms and cancelling selection make no wallet requests');
  let release,started;const ready=new Promise(r=>started=r);hold=()=>new Promise(r=>{release=r;started();});
  await page.locator('#evm-send-review').click();await page.getByRole('button',{name:'Entry fixture',exact:true}).click();await ready;await page.locator('#evm-connect-close').click();hold=null;release();
  await page.waitForFunction(()=>document.querySelector('#evm-connect-status').textContent.includes('cancelled'));assert(!await page.locator('#evm-account').isVisible());assert(await page.locator('#evm-send-dialog').isVisible());assert.equal(calls.length,1);
  decline=true;await page.locator('#evm-send-review').click();await page.getByRole('button',{name:'Entry fixture',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#evm-connect-status').textContent.includes('declined'));await page.locator('#evm-connect-close').click();decline=false;
  await page.locator('#evm-send-review').click();await connect();assert(await page.locator('#evm-send-dialog').isVisible());assert.equal(await page.locator('#evm-send-recipient').inputValue(),to);assert.equal(await page.locator('#evm-send-amount').inputValue(),'0.1');assert(!await page.locator('#evm-send-approve').isVisible());assert(!calls.some(r=>r.method==='eth_estimateGas'));
  await page.locator('#evm-send-review').click();await page.locator('#evm-send-approve').waitFor();assert((await page.locator('#evm-send-summary').innerText()).includes(to));assert(!calls.some(r=>r.method==='eth_sendTransaction'));
  checks.push('cancelled and declined connections preserve entered terms; late replies cannot restore a cancelled wallet; successful connection requires a new review');
  await page.keyboard.press('Escape');await walletClick(page,'evm-disconnect');await open();await page.locator('#evm-send-recipient').fill('ethereum:'+to+'@8453');await page.waitForFunction(()=>document.querySelector('#evm-recipient-network').value==='0x2105');await page.locator('#evm-send-amount').fill('0.1');await page.locator('#evm-send-consent').check();await page.locator('#evm-send-review').click();await connect();
  const before=calls.length;await page.locator('#evm-send-review').click();await page.waitForFunction(()=>document.querySelector('#evm-send-status').textContent.includes('Receiving network differs'));assert.deepEqual(calls.slice(before).map(r=>r.method),['eth_accounts','eth_chainId']);assert(!await page.locator('#evm-send-approve').isVisible());await page.keyboard.press('Escape');
  checks.push('a network-qualified recipient survives connection and wrong-chain funding is rejected before transfer reads or switching');
  await walletClick(page,'evm-disconnect');
  const id=await page.evaluate(async()=>{const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),card=await import('/contact-card.js');const person=await crypto.createIdentity('Ada');await store.updateState(s=>s.contacts.push(person.profile));return card.encodeLenzId(person.profile);});
  await open();await page.locator('#evm-send-recipient').fill(id);await page.locator('#evm-send-lenz').waitFor();await page.evaluate(()=>dispatchEvent(new Event('lenz-transfers-changed')));
  assert(!await page.locator('#evm-send-funding').isVisible());assert(!await page.locator('#evm-send-assets').isVisible());assert.match(await page.locator('#evm-send-lenz-name').innerText(),/Ada/);
  await page.locator('#evm-send-lenz-continue').click();await page.locator('#near-send-dialog').waitFor();await page.keyboard.press('Escape');
  checks.push('a saved Lenz recipient enters the existing offline test-payment flow without showing external funding controls');
  const unsaved=await page.evaluate(async()=>{const person=await(await import('/peer-crypto.js')).createIdentity('New person');return(await import('/contact-card.js')).encodeLenzId(person.profile);});
  await open();await page.locator('#evm-send-recipient').fill(unsaved);await page.locator('#evm-send-lenz').waitFor();await page.locator('#evm-send-lenz-continue').click();await page.locator('#contact-review').waitFor();await page.keyboard.press('Escape');
  await page.locator('#evm-send-dialog').waitFor({timeout:3000});assert.equal(await page.locator('#evm-send-recipient').inputValue(),unsaved);await page.keyboard.press('Escape');
  checks.push('cancelling verification of a new Lenz recipient returns to Send with the pasted ID intact');
  let decodeRelease,decodeStarted;const decoding=new Promise(r=>decodeStarted=r);pauseDecode=()=>new Promise(r=>{decodeRelease=r;decodeStarted();});
  await open();await page.locator('#evm-send-recipient').fill(id);await decoding;await page.keyboard.press('Escape');await open();pauseDecode=null;decodeRelease();
  await page.waitForTimeout(150);assert.equal(await page.locator('#evm-send-recipient').inputValue(),'');assert(!await page.locator('#evm-send-lenz').isVisible());
  checks.push('a recipient lookup from a closed Send cannot populate a newly opened Send');
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screens,`send-entry-${theme}-${width}.png`)});}
  await page.keyboard.press('Escape');await page.evaluate(()=>localStorage.setItem('lenz-evm-networks-v1',JSON.stringify({version:1,networks:[{chainId:'0x89',name:'Polygon',symbol:'POL',decimals:18,rpcUrl:'https://polygon-rpc.com'}]})));chain='0x89';
  await open();await page.locator('#evm-send-recipient').fill(to);await network('Ethereum');await page.locator('#evm-send-amount').fill('0.1');await page.locator('#evm-send-consent').check();await page.locator('#evm-send-review').click();await connect();
  assert(await page.locator('#evm-send-review').isDisabled());await page.keyboard.press('Escape');await open();assert.match(await page.locator('#evm-send-status').innerText(),/custom network/);assert(await page.locator('#evm-send-review').isDisabled());
  checks.push('the main Send entry cannot enable transfers for a custom wallet network');
  assert.deepEqual(errors,[]);const sources={};for(const file of ['web/public/evm-transfer-ui.js','web/public/evm-wallet-ui.js','web/public/money.js','web/public/wallet-portfolio.js','web/public/wallet-portfolio.css','web/wallet-send-entry-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
  await fs.writeFile(path.join(__dirname,'wallet-send-entry-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,sources,scope:'Disposable Edge with synthetic wallet/provider and real local contact storage; decode scheduling delayed in test context. No real wallet, funds, signing or transaction.'},null,2)+'\n');console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
