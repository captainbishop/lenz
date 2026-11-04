async function walletSettings(p){if(await p.locator('.wallet-settings').count()&&!await p.locator('.wallet-settings').evaluate(n=>n.open))await p.locator('.wallet-settings summary').click();}
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const checks=[],errors=[],base='http://127.0.0.1:4173';
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),p=await context.newPage();
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/api/**',r=>r.abort());
  const ready=()=>p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your wallet is ready'));
  await p.goto(base+'/money.html');await ready();await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill('Amina');await p.locator('#wallet-identity-form button[type=submit]').click();await p.locator('#wallet-content').waitFor();
  const snapshot=()=>p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {profile:s.identity.profile,nearBox:s.nearBox,messages:s.messages,contacts:s.contacts};});
  await check('wallet starts at zero with current tUSD actions and no simulation controls',async()=>{
   assert.equal(await p.locator('#near-total').innerText(),'0');
   for(const id of ['wallet-mode','wallet-enable-demo','wallet-balances','wallet-send-dialog'])assert.equal(await p.locator('#'+id).count(),0);
   for(const id of ['near-send','near-receive','near-fund'])assert(await p.locator('#'+id).isVisible());
  });
  await check('receive opens the same public contact card without starting a conversation',async()=>{
   await p.locator('#near-receive').click();await p.locator('#near-share-card').click();assert(await p.locator('#contact-qr').isVisible());await p.locator('[data-close=share-contact]').click();
   assert.equal(new URL(p.url()).pathname,'/money.html');
  });
  await check('wallet and conversation share the same keys and balances without a reset',async()=>{
   const before=await snapshot();await p.goto(base+'/chat.html');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));assert.deepEqual(await snapshot(),before);
   assert.equal(await p.locator('#chat-balance').innerText(),'0 tUSD');assert.equal(await p.locator('#chat-earlier').count(),0);
   await p.goto(base+'/money.html');await ready();assert.deepEqual(await snapshot(),before);
  });
  await check('offline reload preserves the account and payment actions',async()=>{
   await walletSettings(p);await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
   const before=await snapshot();await context.setOffline(true);await p.reload();await ready();assert.deepEqual(await snapshot(),before);
   await p.locator('#near-send').click();assert(await p.locator('#wallet-scan-recipient').isVisible());await p.locator('#near-send-amount').waitFor({state:'hidden'});await p.locator('[data-close=near-send-dialog]').click();
  });
  await check('wallet settings work by keyboard, and payment dialogs retain focus and terms',async()=>{
   assert(!await p.locator('#prepare-money-offline').isVisible());
   await p.locator('.wallet-settings summary').focus();await p.keyboard.press('Enter');assert(await p.locator('#prepare-money-offline').isVisible());
   assert(await p.locator('#carrier-open').isVisible());assert(await p.locator('#nearby-open').isVisible());
   await p.keyboard.press('Escape');assert(!await p.locator('#prepare-money-offline').isVisible());
   assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Wallet settings');
   await p.locator('#near-send').click();assert(await p.locator('#wallet-recipient-picker').isVisible());
   await p.keyboard.press('Escape');assert(!await p.locator('#near-send-dialog').isVisible());assert.equal(await p.evaluate(()=>document.activeElement.id),'near-send');
   assert(!await p.locator('.wallet-balance-details').evaluate(n=>n.open));
   await p.locator('.wallet-balance-details summary').click();
   for(const id of ['near-confirmed','near-pending','near-reserved'])assert.equal(await p.locator('#'+id).innerText(),'0');
   await p.locator('.wallet-balance-details summary').click();
  });
  await check('current wallet fits desktop and phone widths in both themes',async()=>{
   await p.waitForFunction(()=>document.querySelector('#status').textContent==='');
   for(const theme of ['light','dark'])for(const [label,width,height] of [['desktop',1280,900],['narrow',375,812]]){
    await p.setViewportSize({width,height});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await p.locator('#near-send').isVisible());assert(await p.locator('#near-receive').isVisible());
    await p.screenshot({path:path.join(__dirname,'evidence/wallet-'+label+(theme==='dark'?'-dark':'')+'.png'),fullPage:true});
   }
  });
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(__dirname,'money-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),passed:checks.length,failed:0,checks,scope:'Disposable Windows Edge account with zero balance; APIs blocked. Funded onward-transfer tests are in near-wallet-browser.test.cjs.'},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
