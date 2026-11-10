const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {createServer}=require('node:http');
(async()=>{
 const root=path.join(__dirname,'public'),server=createServer(async(req,res)=>{
   try{const name=new URL(req.url,'http://localhost').pathname;
     if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recovery fixture</title>');return;}
     assert(/^\/[a-z0-9/-]+\.js$/.test(name)&&!name.includes('..'));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,name)));
   }catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
   browser=await chromium.launch({channel:'msedge',headless:true});const source=await browser.newContext(),p=await source.newPage();await p.goto(base);
   const archive=await p.evaluate(async()=>{
     const r=await import('/identity-recovery.js'),c=await import('/peer-crypto.js');
     const created=await r.createRecoverableIdentity('Amina'),peer=await c.createIdentity('Bola');
     const packet=await c.sealMessage(peer,created.identity.profile,{kind:'chat',text:'A saved conversation.'});
     return {phrase:created.phrase,archive:await r.sealChatArchive(created.phrase,{profile:created.identity.profile,contacts:[peer.profile],messages:[{packet}]}),id:created.identity.profile.id};
   });await source.close();
   for(let copy=0;copy<2;copy++){
     const ctx=await browser.newContext(),page=await ctx.newPage();await page.goto(base);
     const legacyId=await page.evaluate(async()=>{
       const c=await import('/peer-crypto.js'),s=await import('/chat-store.js');window.recovery=await import('/identity-recovery.js');window.chatCrypto=c;window.chatStore=s;
       await s.updateState(async state=>{state.identity=await c.createIdentity('Existing account');});return (await s.readState()).identity.profile.id;
     });
     await ctx.setOffline(true);const requests=[];page.on('request',r=>requests.push(r.url()));
     const result=await page.evaluate(async input=>{
       const restored=await recovery.openChatArchive(input.phrase,input.archive);
       const payload=await chatCrypto.openMessage(restored.identity,restored.contacts[0],restored.messages[0].packet);
       let corruptRejected=false;try{const altered=(Number.parseInt(input.archive.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0');await recovery.openChatArchive(input.phrase,{...input.archive,ciphertext:altered+input.archive.ciphertext.slice(2)});}catch{corruptRejected=true;}
       return {id:restored.identity.profile.id,text:payload.text,financialState:restored.recovery.financialState,existing:(await chatStore.readState()).identity.profile.id,nonextractable:!restored.identity.signingPrivate.extractable&&!restored.identity.boxPrivate.extractable,corruptRejected};
     },archive);
     assert.equal(result.id,archive.id);assert.equal(result.text,'A saved conversation.');assert.equal(result.financialState,'not-restored');assert.equal(result.existing,legacyId);assert(result.nonextractable&&result.corruptRejected);assert.equal(requests.length,0);await ctx.close();
   }
   const sources={};for(const file of ['web/public/identity-recovery.js','web/public/delivery-receipts.js','web/public/evm-vendor/identity-recovery.js','web/public/peer-crypto.js','web/public/chat-store.js','web/identity-recovery-browser.test.cjs'])sources[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
   const reportDirectory=process.env.LENZ_RECOVERY_REPORT_DIR??__dirname;await fs.mkdir(reportDirectory,{recursive:true});
   await fs.writeFile(path.join(reportDirectory,'identity-recovery-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:1,sources,evidence:{freshBrowserRestore:true,twoOfflineCopies:true,historicalDecryption:true,existingIdentityUnchanged:true,noRestoreNetworkRequests:true,activeKeysNonextractable:true},scope:'Disposable Edge contexts; original source context closed before restoration. Staged chat-only recovery, no active restore, financial state, production onboarding or device migration.'},null,2)+'\n');console.log('PASS fresh-browser offline recovery, two copies and existing-account preservation');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
