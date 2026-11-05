const {openWalletSection}=require('./wallet-test-ui.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],base='http://127.0.0.1:4173';
 try{
  const ca=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
  for(const [p,name]of [[a,'Amina'],[b,'Bola']]){p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your wallet is ready'));await p.locator('#device-profile > summary').click();await p.locator('#wallet-name').fill(name);await p.locator('#wallet-identity-form button[type=submit]').click();await p.locator('#wallet-content').waitFor();}
  const read=p=>p.evaluate(async()=>await(await import('/chat-store.js')).readState());
  const before=await read(a);await a.bringToFront();await openWalletSection(a,'people');await a.locator('#show-card').click();
  assert.equal(await a.locator('#share-title').innerText(),'Your Lenz ID');
  const id=await a.locator('#my-lenz-id').inputValue();await a.locator('#copy-lenz-id').click();
  assert.equal(await a.evaluate(()=>navigator.clipboard.readText()),id);
  checks.push('Lenz ID is the primary share action and copies as an address');
  await b.bringToFront();await openWalletSection(b,'people');await b.locator('#show-add-contact').click();await b.locator('#contact-card').fill(id);await b.locator('#review-contact').click();
  await b.locator('#contact-label').fill('Amina');await b.locator('#verified').check();await b.locator('#confirm-contact').click();await b.locator('#add-contact').waitFor({state:'hidden'});
  const saved=(await read(b)).contacts[0];assert.equal(saved.id,before.identity.profile.id);assert.equal(saved.name,'Amina');
  const roundtrip=await b.evaluate(async other=>{const crypto=await import('/peer-crypto.js'),s=await(await import('/chat-store.js')).readState();const packet=await crypto.sealMessage(s.identity,s.contacts[0],{kind:'chat',text:'Shared by Lenz ID'});return{packet,profile:s.identity.profile};});
  const text=await a.evaluate(async({packet,profile})=>{const s=await(await import('/chat-store.js')).readState();return(await(await import('/peer-crypto.js')).openMessage(s.identity,profile,packet)).text;},roundtrip);
  assert.equal(text,'Shared by Lenz ID');checks.push('pasting and verifying a Lenz ID enables encrypted messages with the existing keys');
  for(const theme of ['light','dark']){await a.evaluate(t=>document.documentElement.dataset.theme=t,theme);await a.setViewportSize({width:375,height:812});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await a.locator('#share-name').evaluate(n=>getComputedStyle(n).color),'rgb(23, 63, 53)');await a.locator('#share-contact').evaluate(n=>n.scrollTop=0);await a.locator('#share-contact').screenshot({path:path.join(__dirname,'evidence/lenz-id-'+theme+'.png')});}
  assert.deepEqual((await read(a)).identity.profile,before.identity.profile);assert.deepEqual((await read(a)).nearBox,before.nearBox);assert.deepEqual(errors,[]);
  checks.push('Lenz ID sharing fits both themes without changing keys or wallet storage');
  await fs.writeFile(path.join(__dirname,'lenz-id-wallet-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:'Two disposable Edge profiles; clipboard, typed address, existing WebCrypto keys and actual encrypted message round trip. No financial API or account recovery.'},null,2)+'\n');
  checks.forEach(c=>console.log('PASS '+c));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
