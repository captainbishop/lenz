const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');

(async()=>{
 const root=path.join(__dirname,'public'),errors=[];
 const recovery=await import('./public/identity-recovery.js'),crypto=await import('./public/peer-crypto.js'),receipts=await import('./public/delivery-receipts.js');
 const owner=await recovery.createRecoverableIdentity('Amina'),peer=await crypto.createIdentity('Bola');
 const packet=await crypto.sealMessage(owner.identity,peer.profile,{kind:'chat',text:'Keep this acknowledgement offline.'});
 const sender={identity:owner.identity,contacts:[peer.profile],messages:[{packet}]},receiver={identity:peer,contacts:[owner.identity.profile],messages:[{packet}]};
 await receipts.acceptDeliveryReceipt(sender,await receipts.prepareDeliveryReceipt(receiver,packet.id));
 const archive=await recovery.sealChatArchive(owner.phrase,{profile:owner.identity.profile,contacts:sender.contacts,messages:sender.messages});
 const server=http.createServer(async(req,res)=>{try{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/cache-test'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache installation</title>');return;}
  // Recovery does not execute the separately generated proof runtime.
  if(['/vendor/ffjavascript.js','/vendor/ffjavascript-worker.js'].includes(name)){res.setHeader('Content-Type','text/javascript');res.end('/* Unused proof runtime fixture. */');return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));assert(file.startsWith(root+path.sep));
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  res.end(await fs.readFile(name==='/sw.js'&&process.env.LENZ_RECOVERY_WORKER?process.env.LENZ_RECOVERY_WORKER:file));
 }catch{res.writeHead(404);res.end();}});
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/cache-test');
  await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.register('/sw.js'),worker=registration.installing??registration.waiting??registration.active;
   await new Promise((resolve,reject)=>{const check=()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(Error('Root cache installation failed'));};worker.addEventListener('statechange',check);check();});
  });
  await context.setOffline(true);await page.goto(base+'/recovery.html');await page.locator('#open-panel').waitFor({timeout:10000});
  await page.locator('#backup-file').setInputFiles({name:'chat-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
  await page.locator('#backup-phrase').fill(owner.phrase);await page.locator('#open-backup').click();await page.locator('#backup-history').waitFor();
  assert.match(await page.locator('#history-messages').innerText(),/Keep this acknowledgement offline/);
  assert.match(await page.locator('#restore-chat-fields').innerText(),/same Lenz ID/);assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),passed:1,checks:['A receipt-bearing backup opens offline after only the root worker was installed.'],scope:'Disposable Edge, real archive cryptography and root service worker. Unused generated proof bundles are inert fixtures; no proof execution, financial restore or physical-device test.'};
  if(process.env.LENZ_RECOVERY_OFFLINE_REPORT)await fs.writeFile(process.env.LENZ_RECOVERY_OFFLINE_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
