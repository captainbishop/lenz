const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

(async()=>{
 const {AccountStore}=await import('./account-store.mjs'),{createAccountRoute}=await import('./account-relay.mjs');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-recovered-aurora-journal-')),store=new AccountStore(folder),root=path.join(__dirname,'public');let accounts,financialRequests=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/accounts/'))return accounts(req,res);
  if(req.url.startsWith('/api/')){financialRequests++;res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"No financial service is configured in this journal recovery test."}');return;}
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recovered private swap journal</title>');return;}
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type',path.extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://localhost:'+server.address().port;accounts=createAccountRoute({origin,store});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true,defaultBackupEligibility:true,defaultBackupState:true}});await page.goto(origin);
  await page.evaluate(async()=>{
   const {useAccountPasskey}=await import('/account-keys.js'),{setUpAccount,backupNow}=await import('/account-sync.js'),{createNearIntentSource}=await import('/intent-near-route.js'),{createAuroraIntentSource}=await import('/intent-aurora-source.js');
   const material=await useAccountPasskey(true,'Recovered private swap journal');await setUpAccount(material);const near=createNearIntentSource(material.identity.profile.id);await near.connect();const source=createAuroraIntentSource(material.identity.profile.id,{nearSource:near});await source.connect();await source.createNote();await backupNow();source.dispose();near.dispose();
  });
  await cdp.send('Storage.clearDataForOrigin',{origin,storageTypes:'all'});await page.reload();
  await page.evaluate(async()=>{const {useAccountPasskey}=await import('/account-keys.js'),{retrieveAccount}=await import('/account-sync.js');await retrieveAccount(await useAccountPasskey(false));});
  const result=await page.evaluate(async()=>{
   const {readState,updateState}=await import('/chat-store.js'),{createAuroraOwnedAccount}=await import('/intent-aurora-account.js'),{snapshotIntentRecovery}=await import('/intent-account-recovery.js'),{createIntentActionStore}=await import('/intent-action-store.js'),{auroraSwapSelection}=await import('/intent-aurora-plan.js'),{intentOwner}=await import('/intent-workspace.js'),{implicitNearOwner}=await import('/intent-near-plan.js'),{digest}=await import('/peer-crypto.js'),{requirePaymentAccess}=await import('/chat-access.js');
   const before=await readState(),original=await snapshotIntentRecovery(before),account=createAuroraOwnedAccount(before.identity.profile.id),receiver=await account.connectReceiving(),note=original.auroraNotes.records[0].note,owner=implicitNearOwner(original.nearSource.publicKey);
   const selection=auroraSwapSelection({chainId:'eip155:1313161555',asset:'0xafa88fe18a46dda58e79d8f89abda51c13411590',accountId:owner,commitment:note.commitment,units:'1000000'},{recipient:receiver.address}),actions=createIntentActionStore(before.identity.profile.id),sourceOwner=intentOwner(selection.source);
   await actions.update(sourceOwner,journal=>{journal.draft=selection;return journal;});
   const saved=await actions.read(sourceOwner),latest=await readState(),nearCertification=structuredClone(latest.nearIntentSource.recoveryVerified),accountCertification=structuredClone(latest.auroraOwnedAccount.recoveryVerified),rejected=[];
   async function deny(label,{source=sourceOwner,draft=selection,change,restore}={}){
    if(change)await updateState(change,{markBackup:false});let blocked=false,called=false;
    try{await actions.update(source,journal=>{called=true;journal.draft=draft;return journal;});}catch{blocked=true;}finally{if(restore)await updateState(restore,{markBackup:false});}
    rejected.push({label,blocked,called,unchanged:JSON.stringify(await actions.read(sourceOwner))===JSON.stringify(saved)});
   }
   const restoreNear=s=>{s.nearIntentSource.recoveryVerified=nearCertification;},restoreAccount=s=>{s.auroraOwnedAccount.recoveryVerified=accountCertification;};
   await deny('missing NEAR recovery certification',{change:s=>{delete s.nearIntentSource.recoveryVerified;},restore:restoreNear});
   await deny('changed NEAR recovery certification',{change:s=>{s.nearIntentSource.recoveryVerified.publicKey='ed25519:changed';},restore:restoreNear});
   await deny('missing Aurora recovery certification',{change:s=>{delete s.auroraOwnedAccount.recoveryVerified;},restore:restoreAccount});
   await deny('changed Aurora recovery certification',{change:s=>{s.auroraOwnedAccount.recoveryVerified.address='0x'+'2'.repeat(40);},restore:restoreAccount});
   await deny('other funding owner',{source:JSON.stringify(['eip155:1313161555','4'.repeat(64)])});
   await deny('other private note',{draft:{...selection,source:{...selection.source,commitment:'0x'+'1'.repeat(64)}}});
   await deny('other receiving account',{draft:{...selection,destination:{...selection.destination,accountId:'0x'+'2'.repeat(40)}}});
   await deny('unrelated native payment owner',{source:JSON.stringify(['zcash:testnet','native-zcash:fixture'])});
   const final=await readState(),recovery=await snapshotIntentRecovery(final);account.dispose();let offlineBlocked=false;try{requirePaymentAccess(final.identity);}catch{offlineBlocked=true;}
   return {access:final.identity.access,sourceAmount:saved.draft.source.amount,minimum:saved.draft.destination.minAmount,commitment:saved.draft.source.commitment,originalCommitment:note.commitment,recipient:saved.draft.destination.accountId,address:receiver.address,attempts:saved.attempts.length,review:saved.review,notesUnchanged:await digest(original.auroraNotes)===await digest(recovery.auroraNotes),sourceUnchanged:await digest(original.nearSource)===await digest(recovery.nearSource),offlineBlocked,rejected};
  });
  assert.equal(result.access,'lenz/recovered-chat/v1');assert.equal(result.sourceAmount,'1000000');assert.equal(result.minimum,'2000000');assert.equal(result.commitment,result.originalCommitment);assert.equal(result.recipient,result.address);assert.equal(result.attempts,0);assert.equal(result.review,null);assert.equal(result.notesUnchanged,true);assert.equal(result.sourceUnchanged,true);assert.equal(result.offlineBlocked,true);assert.equal(financialRequests,0);
  assert.equal(result.rejected.length,8);for(const row of result.rejected){assert.equal(row.blocked,true,row.label);assert.equal(row.unchanged,true,row.label);if(!['other private note','other receiving account'].includes(row.label))assert.equal(row.called,false,row.label);}
  console.log(JSON.stringify({passed:9,failed:0,scope:'Actual Edge/WebCrypto/passkey encrypted archive recovery and public action-store update, plus missing/changed recovery certification and other owner/note/recipient/native-route rejection. One disposable unsigned note; no proof, funding, financial signature or financial service call.'}));await context.close();
 }finally{await browser.close();store.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(folder);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('lenz-recovered-aurora-journal-'));await fs.rm(resolved,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
