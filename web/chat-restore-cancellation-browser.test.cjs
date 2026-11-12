const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createServer}=require('node:http');
(async()=>{
 const root=path.join(__dirname,'public'),server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;assert(!name.includes('..'));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/octet-stream');const override=name==='/chat-restore.js'?process.env.LENZ_RESTORE_SOURCE:name==='/recovery-ui.js'?process.env.LENZ_RECOVERY_UI_SOURCE:null;res.end(await fs.readFile(override??path.join(root,name)));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let browser;
 async function open(page,archive,phrase){await page.locator('#open-tab').click();await page.locator('#backup-file').setInputFiles({name:'chat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});await page.locator('#backup-phrase').fill(phrase);await page.locator('#open-backup').click();await page.locator('#backup-history').waitFor();}
 async function delaySave(page){await page.evaluate(()=>{
  const original=indexedDB.open.bind(indexedDB),setter=Object.getOwnPropertyDescriptor(IDBOpenDBRequest.prototype,'onsuccess')?.set??Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess').set;let opens=0;
  indexedDB.open=function(...args){const request=original(...args);if(++opens===2)Object.defineProperty(request,'onsuccess',{set(handler){setter.call(request,event=>{window.saveOpening=true;window.releaseSave=()=>handler.call(request,event);});}});return request;};
  window.restoreOpen=()=>{indexedDB.open=original;};
 });}
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const fixtureContext=await browser.newContext(),fixturePage=await fixtureContext.newPage();await fixturePage.goto(base+'/recovery.html');
  const fixture=await fixturePage.evaluate(async()=>{const c=await import('/identity-recovery.js'),p=await import('/peer-crypto.js'),owner=await c.createRecoverableIdentity('Amina'),peer=await p.createIdentity('Bola'),packet=await p.sealMessage(peer,owner.identity.profile,{kind:'chat',text:'Restorable conversation.'});return {phrase:owner.phrase,id:owner.identity.profile.id,archive:await c.sealChatArchive(owner.phrase,{profile:owner.identity.profile,contacts:[peer.profile],messages:[{packet}]})};});await fixtureContext.close();
  const modes=process.env.LENZ_RESTORE_CASE?[process.env.LENZ_RESTORE_CASE]:['review-cancel','page-exit','transaction-cancel','transaction-exit'];
  for(const mode of modes){
   const direct=mode==='review-cancel'||mode==='transaction-cancel',duringWrite=mode.startsWith('transaction-');
   const context=await browser.newContext(),page=await context.newPage();await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());await page.goto(base+'/recovery.html');
   if(direct)await page.evaluate(async({phrase,archive})=>{window.review=await(await import('/chat-restore.js')).stageChatRestore(phrase,new File([JSON.stringify(archive)],'chat.json'));},fixture);
   else await open(page,fixture.archive,fixture.phrase);
   if(duringWrite)await page.evaluate(direct=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=original.apply(this,args);window.writeReached=true;if(direct)window.review.cancel();else dispatchEvent(new PageTransitionEvent('pagehide'));return request;};window.restoreOpen=()=>{IDBObjectStore.prototype.put=original;};},direct);
   else await delaySave(page);
   if(direct)await page.evaluate(()=>{window.result=window.review.install().then(()=>'installed',error=>error.message);});
   else{await page.locator('#restore-chat-consent').check();await page.locator('#restore-chat').click();}
   if(duringWrite)await page.waitForFunction(()=>window.writeReached===true);
   else{await page.waitForFunction(()=>window.saveOpening===true);if(direct)await page.evaluate(()=>window.review.cancel());else await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));await page.evaluate(()=>window.releaseSave());}
   if(direct)assert.match(await page.evaluate(()=>window.result),/cancelled/);
   else{await page.waitForFunction(()=>document.querySelector('#backup-status')?.textContent.includes('cancelled')||location.pathname==='/chat.html');assert.equal(new URL(page.url()).pathname,'/recovery.html','Leaving the restore page must not complete installation');}
   assert.deepEqual(await page.evaluate(async()=>{window.restoreOpen();return(await import('/chat-store.js')).readState();}),{identity:null,contacts:[],messages:[]});
   await page.reload();assert.deepEqual(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState())),{identity:null,contacts:[],messages:[]});
   await open(page,fixture.archive,fixture.phrase);await page.locator('#restore-chat-consent').check();await page.locator('#restore-chat').click();await page.waitForURL('**/chat.html');
   assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),fixture.id);assert(await page.locator('#pay-tusd').isDisabled());
   console.log('PASS '+mode+' aborts the pending identity write, survives reload and allows a fresh chat-only restore');await context.close();
  }
  if(!process.env.LENZ_RESTORE_CASE){
   const context=await browser.newContext(),page=await context.newPage();await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());await page.goto(base+'/recovery.html');await open(page,fixture.archive,fixture.phrase);await delaySave(page);await page.evaluate(()=>addEventListener('pagehide',()=>window.releaseSave?.(),{once:true}));
   await page.locator('#restore-chat-consent').check();await page.locator('#restore-chat').click();await page.waitForFunction(()=>window.saveOpening===true);await page.goto(base+'/recovery.html?left');
   assert.deepEqual(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState())),{identity:null,contacts:[],messages:[]});await page.goBack();assert.deepEqual(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState())),{identity:null,contacts:[],messages:[]});console.log('PASS actual page exit and Back leave the account empty during a pending restore');await context.close();
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
