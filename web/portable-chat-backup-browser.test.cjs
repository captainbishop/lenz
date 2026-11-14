const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
async function run(){
 const root=path.join(__dirname,'public'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-portable-backup-'));
 const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable backup check</title>');return;}const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;
 let context;const passed=[];
 async function launch(){context=await chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true});await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());const page=context.pages()[0];await page.goto(base);return page;}
 try{
  let page=await launch();
  const fixture=await page.evaluate(async()=>{
   const c=await import('/peer-crypto.js'),r=await import('/identity-recovery.js'),b=await import('/portable-chat-backup.js');
   const owner=await r.createRecoverableIdentity('Portable owner'),peer=await c.createIdentity('Amina');
   const packet=await c.sealMessage(peer,owner.identity.profile,{kind:'chat',text:'Keep this newest message automatically.'});
   const snapshot={profile:owner.identity.profile,contacts:[peer.profile],messages:[{packet}]};
   const revision=await b.savePortableBackup(owner.phrase,snapshot,null);
   return {phrase:owner.phrase,id:owner.identity.profile.id,revision};
  });
  await context.close();context=null;page=await launch();
  const reopened=await page.evaluate(async({phrase})=>{
   const b=await import('/portable-chat-backup.js'),c=await import('/peer-crypto.js'),a=await import('/chat-access.js');const restored=await b.openPortableBackup(phrase);
   let paymentBlocked=false;try{a.requirePaymentAccess(restored.identity);}catch{paymentBlocked=true;}
   return {id:restored.identity.profile.id,text:(await c.openMessage(restored.identity,restored.contacts[0],restored.messages[0].packet)).text,contacts:restored.contacts.length,paymentBlocked,nonextractable:!restored.identity.signingPrivate.extractable&&!restored.identity.boxPrivate.extractable};
  },fixture);
  assert.equal(reopened.id,fixture.id);assert.equal(reopened.text,'Keep this newest message automatically.');assert.equal(reopened.contacts,1);assert(reopened.paymentBlocked&&reopened.nonextractable);passed.push('latest encrypted chat survives browser restart without a manual export');
  const parallel=await context.newPage();await parallel.goto(base);
  const updates=await Promise.all([page,parallel].map((p,index)=>p.evaluate(async({phrase,revision,index})=>{const b=await import('/portable-chat-backup.js'),r=await b.openPortableBackup(phrase);try{return {revision:await b.savePortableBackup(phrase,{profile:{...r.identity.profile,name:'Writer '+index},contacts:r.contacts,messages:r.messages},revision)};}catch(e){return {error:e.message};}},{...fixture,index})));
  assert.equal(updates.filter(v=>v.revision).length,1);assert.equal(updates.filter(v=>/newer automatic backup/.test(v.error)).length,1);passed.push('stale tabs cannot overwrite a newer saved conversation');
  const failure=await page.evaluate(async({phrase})=>{const b=await import('/portable-chat-backup.js'),before=await b.readPortableBackup(),restored=await b.openPortableBackup(phrase),original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};let rejected=false;try{await b.savePortableBackup(phrase,{profile:{...restored.identity.profile,name:'Must not save'},contacts:restored.contacts,messages:restored.messages},before.revision);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}return {rejected,unchanged:JSON.stringify(await b.readPortableBackup())===JSON.stringify(before)};},fixture);
  assert(failure.rejected&&failure.unchanged);passed.push('failed storage leaves the previous backup intact');
  const privacy=await page.evaluate(async({phrase})=>{const b=await import('/portable-chat-backup.js'),raw=await b.readPortableBackup();const text=JSON.stringify(raw);let wrongPhraseRejected=false;try{await b.openPortableBackup('wrong phrase');}catch{wrongPhraseRejected=true;}return {keys:Object.keys(raw).sort(),plaintext:text.includes('Keep this newest')||text.includes('Portable owner')||text.includes(phrase),wrongPhraseRejected};},fixture);
  assert.deepEqual(privacy.keys,['archive','revision']);assert.equal(privacy.plaintext,false);assert(privacy.wrongPhraseRejected);passed.push('saved record contains ciphertext and revision only; recovery words remain necessary');
  const result={checkedAt:new Date().toISOString(),passed:passed.length,tests:passed,scope:'Disposable persistent Edge profile with real IndexedDB and browser restart. Localhost module fixture; physical Android storage and file-origin availability require a separate run.'};
  if(process.env.LENZ_PORTABLE_BACKUP_REPORT)await fs.writeFile(process.env.LENZ_PORTABLE_BACKUP_REPORT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
