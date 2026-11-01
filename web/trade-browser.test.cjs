const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const checks=[],errors=[],base='http://127.0.0.1:4173';
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
  for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));await p.route('**/api/**',r=>r.abort());await p.goto(base+'/chat.html');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));}
  const recipient=await b.evaluate(async()=>{const {createIdentity}=await import('/peer-crypto.js'),{updateState}=await import('/chat-store.js');return updateState(async s=>{s.identity=await createIdentity('Bola');return s.identity.profile;});});
  const fixture=await a.evaluate(async recipient=>{
   const {createIdentity}=await import('/peer-crypto.js'),{updateState}=await import('/chat-store.js'),{enableDemoMoney,prepareTrade}=await import('/trade-service.js');
   return updateState(async s=>{s.identity=await createIdentity('Amina');s.contacts.push(recipient);await enableDemoMoney(s);const packet=await prepareTrade(s,recipient.id,{mode:'payment',give:'2',giveAsset:'DEMO-USD'});return {packet,sender:s.identity.profile};});
  },recipient);
  await b.evaluate(async sender=>{await(await import('/chat-store.js')).updateState(s=>s.contacts.push(sender));},fixture.sender);
  const snapshot=p=>p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {profile:s.identity.profile,messages:s.messages,tradeBox:s.tradeBox,nearBox:s.nearBox};});
  await check('existing encrypted demo history stays readable with no trading controls',async()=>{
   const before=await snapshot(a);await a.reload();await a.getByText('Archived demo record',{exact:true}).waitFor();
   assert.deepEqual(await snapshot(a),before);for(const id of ['chat-earlier','enable-demo','trade-dialog','offer-trade','run-exchange'])assert.equal(await a.locator('#'+id).count(),0);
   assert.equal(await a.locator('#chat-balance').innerText(),'0 tUSD');
  });
  await check('archived packet export preserves the original encrypted bytes',async()=>{
   const pending=a.waitForEvent('download');await a.locator('.financial > button').click();const downloaded=JSON.parse(await fs.readFile(await(await pending).path(),'utf8'));assert.deepEqual(downloaded,fixture.packet);
  });
  await check('new demo imports are rejected without changing account, messages or balances',async()=>{
   await b.reload();await b.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));const before=await snapshot(b);
   await b.locator('#receive-message').click();await b.locator('#incoming-file').setInputFiles({name:'old-payment.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.packet))});
   await b.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');await b.locator('#open-message').click();await b.getByText('This demo payment format is no longer supported. Use a tUSD payment.',{exact:true}).first().waitFor();
   assert.deepEqual(await snapshot(b),before);assert.equal(await b.locator('#chat-balance').innerText(),'0 tUSD');
  });
  await check('the shared carrier receive path rejects new demo payments before state mutation',async()=>{
   const before=await snapshot(b);
   const error=await b.evaluate(async packet=>{const {updateState}=await import('/chat-store.js'),{receivePacket}=await import('/receive-packet.js'),config=await(await fetch('/near-config.json')).json();const errors=[];for(const contract of [config.contract,null]){try{await updateState(s=>receivePacket(s,packet,false,contract));errors.push(null);}catch(error){errors.push(error.message);}}return errors;},fixture.packet);
   assert.deepEqual(error,Array(2).fill('This demo payment format is no longer supported. Use a tUSD payment.'));assert.deepEqual(await snapshot(b),before);
  });
  await check('offline cache and wallet navigation retain archived data without exposing a simulation mode',async()=>{
   await a.locator('#prepare-offline').click();await a.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));const before=await snapshot(a);
   await ca.setOffline(true);await a.goto(base+'/money.html');await a.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your wallet is ready'));
   assert.equal(await a.locator('#wallet-mode').count(),0);assert.equal(await a.locator('#near-total').innerText(),'0');assert.deepEqual(await snapshot(a),before);
   await a.goto(base+'/chat.html');await a.getByText('Archived demo record',{exact:true}).waitFor();assert.deepEqual(await snapshot(a),before);
  });
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(__dirname,'trade-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:browser.version(),passed:checks.length,failed:0,checks,scope:'Two disposable Edge accounts, synthetic historical trade fixture, APIs blocked. Archived records are readable/exportable; new demo imports and actions are retired.'},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
