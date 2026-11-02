// Disposable browser state and local fixture backing; no chain or financial API calls.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],base='http://127.0.0.1:4173';
 try{
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1280,height:900}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await context.route('**/api/**',r=>r.abort());
  const ready=async p=>{await p.goto(base+'/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');};
  await ready(page);await page.waitForFunction(()=>document.querySelector('#status').textContent==='');assert(!await page.locator('#status').isVisible());
  checks.push('startup readiness disappears and its empty space collapses');
  await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  await page.evaluate(async()=>{
   const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),config=await(await fetch('/near-config.json')).json(),rhea=await(await fetch('/rhea-config.json')).json(),peer=await import('/peer-crypto.js');
   const contact=await peer.createIdentity('Bola');
   await updateState(async s=>{
    s.contacts.push(contact.profile);
    const r=await n.fundingRequest(s.identity,config.contract,'12.345'),v=n.emptyNearVault(config.contract);v.roots.push({id:r.id,owner:r.owner,amount:r.amount});
    const swap=await(await import('/rhea-protocol.js')).prepareRheaSwap(v,s.identity,rhea,{text:'2',minOutput:'1250000000000000000000000',receiver:'fixture.testnet',deadlineMs:Date.now()+3600000});
    await n.saveNearVault(s,swap.vault);
   });
  });
  await ready(page);await page.waitForFunction(()=>document.querySelector('#near-total').textContent==='10.345');
  const snapshot=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
  const before=await snapshot();
  await page.locator('#toggle-balances').focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('#toggle-balances').getAttribute('aria-pressed'),'true');
  for(const target of ['#near-total','#near-payments','#rhea-orders'])if(await page.locator(target).count()){
   const text=await page.locator(target).innerText();assert(!text.includes('10.345'));assert(!text.includes('1.25'));assert(!text.includes('2 tUSD'));
  }
  assert.equal(await page.locator('#near-total').getAttribute('aria-label'),'Amount hidden');
  assert.equal(await snapshot(),before);
  const other=await context.newPage();await ready(other);assert.equal(await other.locator('#toggle-balances').getAttribute('aria-pressed'),'true');
  await other.locator('#toggle-balances').click();await page.waitForFunction(()=>document.querySelector('#near-total').textContent==='10.345');
  await other.locator('#toggle-balances').click();await page.waitForFunction(()=>document.querySelector('#near-total').textContent==='••••');await other.close();
  await page.evaluate(()=>{const c=new BroadcastChannel('proof-u-chat-refresh');c.postMessage('changed');c.close();});
  await page.waitForTimeout(200);assert.equal(await page.locator('#near-total').innerText(),'••••');assert.equal(await snapshot(),before);
  checks.push('keyboard toggle masks available, payment and saved-swap amounts; tabs and rerenders preserve the preference and vault');
  await page.locator('#show-card').click();const id=await page.locator('#my-lenz-id').inputValue();
  await page.locator('#copy-lenz-id').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),id);
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedId=data;}}));await page.locator('#share-card').click();
  assert.deepEqual(await page.evaluate(()=>window.sharedId),{title:'My Lenz ID',text:id});
  const pending=page.waitForEvent('download');await page.locator('#save-qr').click();const file=await pending;assert.equal(file.suggestedFilename(),'lenz-id.png');
  assert.equal((await fs.readFile(await file.path())).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  for(const theme of ['light','dark'])for(const width of [320,375,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const button of ['share-card','copy-lenz-id','save-qr']){
    const node=page.locator('#'+button);assert(await node.getAttribute('aria-label'));assert.equal(await node.innerText(),'');const box=await node.boundingBox();assert(box.width>=48&&box.height>=48);
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.locator('[data-close=share-contact]').click();
  checks.push('share/copy/download icons retain accessible names, 48px targets, clipboard text and PNG output in both themes at 320/375/1280px');
  await ready(page);await page.locator('#near-send').click();await page.locator('#near-recipient').selectOption({label:'Bola'});await page.locator('#near-send-amount').fill('999');
  assert.equal(await page.locator('#near-send-amount').inputValue(),'999');await page.locator('#near-send-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));const error=await page.locator('#status').innerText();assert(error);
  await page.waitForTimeout(4000);assert.equal(await page.locator('#status').innerText(),error);assert.equal(await snapshot(),before);await page.locator('[data-close=near-send-dialog]').click();
  checks.push('a later payment error survives the readiness timer; entered transaction amounts stay visible and failed sends preserve the vault');
  await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  assert.equal(await page.locator('#near-total').innerText(),'••••');assert.equal(await snapshot(),before);
  for(const theme of ['light','dark']){
   await page.setViewportSize({width:375,height:812});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForFunction(()=>document.querySelector('#status').textContent==='');
   await page.screenshot({path:path.join(__dirname,'evidence/wallet-hidden-'+theme+'.png'),fullPage:true});
  }
  await page.locator('#toggle-balances').click();assert.equal(await page.locator('#near-total').innerText(),'10.345');assert.equal(await snapshot(),before);
  checks.push('offline reload retains masking and exactly restores shown amounts without changing keys, history or reserved money');
  assert.deepEqual(errors,[]);checks.forEach(c=>console.log('PASS '+c));
  await fs.writeFile(path.join(__dirname,'wallet-visibility-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),passed:checks.length,failed:0,checks,errors,scope:'Disposable Windows Edge profiles, local fixture root and saved-swap reservation; API requests blocked. UI masking only, no funding, chain privacy, device recovery or iPhone evidence.'},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
