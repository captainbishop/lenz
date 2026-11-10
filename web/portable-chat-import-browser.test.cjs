const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {securityHeaders}=require('./security-policy.mjs');

async function run(){
 const root=path.join(__dirname,'public'),folder=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-chat-import-')),checks=[],errors=[],requests=[];
 let context,unavailable=false;
 const server=http.createServer(async(req,res)=>{try{
  const name=new URL(req.url,'http://localhost').pathname;
  if(unavailable||name.startsWith('/api/')){requests.push(name);res.writeHead(503);res.end();return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));assert(file.startsWith(root+path.sep));
  for(const [key,value] of Object.entries(securityHeaders(name)))res.setHeader(key,value);
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;
 async function launch(offline=false){
  context=await chromium.launchPersistentContext(path.join(folder,'profile'),{channel:'msedge',headless:true,viewport:{width:390,height:844}});
  await context.setOffline(offline);await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));return page;
 }
 const idle=page=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
 try{
  let page=await launch();await page.goto(base+'/recovery.html');await page.locator('#open-panel').waitFor();
  const fixture=await page.evaluate(async()=>{
   const recovery=await import('/identity-recovery.js'),crypto=await import('/peer-crypto.js'),receipts=await import('/delivery-receipts.js'),owner=await recovery.createRecoverableIdentity('Johnson'),peer=await crypto.createIdentity('Bola');
   const packet=await crypto.sealMessage(peer,owner.identity.profile,{kind:'chat',text:'The conversation from offline entry.'});
   const outgoing=await crypto.sealMessage(owner.identity,peer.profile,{kind:'chat',text:'An acknowledged offline-entry message.'});
   const state={identity:owner.identity,contacts:[peer.profile],messages:[{packet},{packet:outgoing}]},receiver={identity:peer,contacts:[owner.identity.profile],messages:[{packet:outgoing}]};
   await receipts.acceptDeliveryReceipt(state,await receipts.prepareDeliveryReceipt(receiver,outgoing.id));
   const retry=await receipts.prepareDeliveryReceipt(state,packet.id);
   return {phrase:owner.phrase,id:owner.identity.profile.id,receiptId:retry.id,archive:await recovery.sealChatArchive(owner.phrase,{profile:owner.identity.profile,contacts:state.contacts,messages:state.messages})};
  });
  async function openArchive(archive=fixture.archive,phrase=fixture.phrase){
   await page.locator('#backup-file').setInputFiles({name:'lenz-chat-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
   await page.locator('#backup-phrase').fill(phrase);await page.locator('#open-backup').click();
   await page.waitForFunction(()=>!document.querySelector('#open-backup').disabled);
  }
  await openArchive();assert.equal(await page.locator('#backup-history').isVisible(),true,await page.locator('#backup-status').textContent());
  assert.match(await page.locator('#history-messages').innerText(),/The conversation from offline entry/);
  assert.match(await page.locator('#restore-chat-fields').innerText(),/same Lenz ID/);
  if(process.env.LENZ_CHAT_IMPORT_SCREENSHOTS){
   await fs.mkdir(process.env.LENZ_CHAT_IMPORT_SCREENSHOTS,{recursive:true});
   for(const theme of ['light','dim','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);for(const width of [390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(process.env.LENZ_CHAT_IMPORT_SCREENSHOTS,`recovery-${theme}-${width}.png`),fullPage:true});}}
   await page.setViewportSize({width:390,height:844});
  }
  await page.locator('#restore-chat-consent').check();await page.locator('#restore-chat').click();await page.waitForURL('**/chat.html');await page.locator('#status').filter({hasText:'Private chat is ready'}).waitFor();
  assert.equal(await page.locator('#my-name').innerText(),'Johnson');assert.match(await page.locator('#messages').innerText(),/The conversation from offline entry/);assert(await page.locator('#pay-tusd').isDisabled());
  assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),fixture.id);
  checks.push('offline-entry backup opens in main recovery and continues chat with the same Lenz ID, without restoring payment authority');
  assert.match(await page.locator('#messages').innerText(),/Receipt received/);
  await page.locator('#messages').getByRole('button',{name:'Share receipt',exact:true}).click();await idle(page);
  assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).messages[0].receiptToShare.id),fixture.receiptId);
  if(await page.locator('#handover').isVisible())await page.locator('[data-close="handover"]').click();
  checks.push('restored messages keep their verified acknowledgement and reuse the previously prepared receipt');
  await page.locator('#message').fill('A new reply from the main app.');await page.locator('#prepare-message').click();await idle(page);
  if(await page.locator('#handover').isVisible())await page.locator('[data-close="handover"]').click();
  await page.evaluate(async()=>await(await import('/save-offline.js')).saveOffline());
  await context.close();context=null;unavailable=true;requests.length=0;page=await launch(true);
  await page.goto(base+'/chat.html');await page.locator('#status').filter({hasText:'Private chat is ready'}).waitFor();
  assert.match(await page.locator('#messages').innerText(),/The conversation from offline entry/);assert.match(await page.locator('#messages').innerText(),/A new reply from the main app/);
  assert.match(await page.locator('#messages').innerText(),/Receipt received/);
  if(process.env.LENZ_CHAT_IMPORT_SCREENSHOTS)await page.screenshot({path:path.join(process.env.LENZ_CHAT_IMPORT_SCREENSHOTS,'chat-after-offline-restart.png'),fullPage:true});
  assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),fixture.id);assert(await page.locator('#pay-tusd').isDisabled());
  checks.push('new messages save automatically and survive a full browser restart with networking disabled');
  await page.goto(base+'/recovery.html');await page.locator('#saved-phrase-field').waitFor();await page.locator('#saved-backup-phrase').fill(fixture.phrase);await page.locator('#prepare-backup').click();
  await page.waitForFunction(()=>!document.querySelector('#prepare-backup').disabled);assert(await page.locator('#backup-prepared').isVisible(),await page.locator('#backup-status').textContent());
  assert.match(await page.locator('#backup-counts').innerText(),/3 text messages/);
  const words=fixture.phrase.split(' ');for(const index of [1,9,17])await page.locator('#backup-word-'+index).fill(words[index]);
  const downloaded=page.waitForEvent('download');await page.locator('#download-backup').click();const exported=JSON.parse(await fs.readFile(await(await downloaded).path(),'utf8'));
  const savedReceipts=await page.evaluate(async({phrase,archive})=>{const restored=await(await import('/identity-recovery.js')).openChatArchive(phrase,archive);return {acknowledged:await(await import('/delivery-receipts.js')).deliveryAcknowledged(restored,restored.messages[1]),retry:restored.messages[0].receiptToShare.id};},{phrase:fixture.phrase,archive:exported});
  assert.equal(savedReceipts.acknowledged,true);assert.equal(savedReceipts.retry,fixture.receiptId);
  checks.push('a fresh backup includes the restored conversation and new replies under the existing recovery phrase');
  await page.locator('#open-tab').click();await openArchive(exported);assert.match(await page.locator('#history-messages').innerText(),/A new reply from the main app/);assert(await page.locator('#restore-chat-fields').isHidden());assert(await page.locator('#restore-existing').isVisible());
  await page.locator('#close-history').click();await openArchive(fixture.archive,'wrong phrase');assert(await page.locator('#backup-history').isHidden());
  const altered=(Number.parseInt(fixture.archive.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0');
  await page.locator('#backup-phrase').fill(fixture.phrase);await openArchive({...fixture.archive,ciphertext:altered+fixture.archive.ciphertext.slice(2)});assert(await page.locator('#backup-history').isHidden());
  assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).messages.length),3);
  checks.push('existing account preservation, wrong recovery words and tampered backups keep saved chat intact');
  assert.deepEqual(errors,[]);assert(requests.every(name=>/^\/(?:chat-sw|sw)\.js$/.test(name)));
  const result={checkedAt:new Date().toISOString(),checks,scope:'Real main dApp recovery/chat, cryptography, IndexedDB and persistent Edge restart with network disabled. Disposable identities; no physical Android sharing or funds.'};
  if(process.env.LENZ_CHAT_IMPORT_REPORT)await fs.writeFile(process.env.LENZ_CHAT_IMPORT_REPORT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
