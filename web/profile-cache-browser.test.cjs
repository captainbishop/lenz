const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');

async function run(){
 const root=path.join(__dirname,'public'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-profile-caches-')),checks=[];let context;
 const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable profile cache check</title>');return;}const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;
 async function launch(){context=await chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true});await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());const page=context.pages()[0];await page.goto(base);return page;}
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  let page=await launch();
  const fixture=await page.evaluate(async()=>{
   const recovery=await import('/identity-recovery.js'),legacy=await import('/chat-store.js'),performance=await import('/account-performance.js'),portable=await import('/portable-chat-backup.js');
   window.ownerA=await recovery.createRecoverableIdentity('Profile A');window.ownerB=await recovery.createRecoverableIdentity('Profile B');
   await legacy.updateState(state=>{state.identity=ownerA.identity;});window.originalState=await legacy.readState();
   const end=1780000000000;window.historyFixture=equity=>({account:'0x1111111111111111111111111111111111111111',observedAt:end,start:end-30*86400000,end,fills:[],equity,withdrawable:'1',positions:[],openOrders:[]});
   await performance.savePerformance(historyFixture('17'),ownerA.identity.profile.id);
   window.snapshotA={profile:ownerA.identity.profile,contacts:[],messages:[]};window.snapshotB={profile:ownerB.identity.profile,contacts:[],messages:[]};
   window.originalBackup=await portable.savePortableBackup(ownerA.phrase,snapshotA,null);
   window.sessions=await import('/workspace-session.js');window.stores=await import('/workspace-store.js');window.leaseA=await sessions.initializeWorkspaces();
   window.storeA=await stores.createWorkspaceStore(leaseA);window.performanceA=performance.createPerformanceStore(storeA);
   window.idB=await sessions.stageWorkspace({identity:ownerB.identity,contacts:[],messages:[]},leaseA);
   return {a:ownerA.identity.profile.id,b:ownerB.identity.profile.id,aPhrase:ownerA.phrase,bPhrase:ownerB.phrase,bWorkspace:idB};
  });
  const isolated=await page.evaluate(async()=>{
   const p=await import('/account-performance.js');const migrated=(await performanceA.read())[0].equity;await performanceA.save(historyFixture('23'));
   const b=await sessions.activateWorkspace(idB,leaseA),storeB=await stores.createWorkspaceStore(b),performanceB=p.createPerformanceStore(storeB),empty=(await performanceB.read()).length;await performanceB.save(historyFixture('41'));
   let stale=false;try{await performanceA.save(historyFixture('999'));}catch{stale=true;}
   window.currentLease=await sessions.activateWorkspace(leaseA.workspaceId,b);window.currentStore=await stores.createWorkspaceStore(currentLease);window.currentPerformance=p.createPerformanceStore(currentStore);
   return {migrated,empty,stale,a:(await currentPerformance.read())[0].equity,legacy:(await p.savedPerformance(originalState))[0].equity};
  });
  assert.deepEqual(isolated,{migrated:'17',empty:0,stale:true,a:'23',legacy:'17'});pass('profile history is independent, original history is preserved, and stale writers are rejected');
  const backups=await page.evaluate(async()=>{
   const p=await import('/portable-chat-backup.js'),a=p.createPortableBackupStore(currentStore),empty=(await a.read())===null;
   const revision=await a.save(ownerA.phrase,snapshotA,null),opened=await a.open(ownerA.phrase);
   const b=await sessions.activateWorkspace(idB,currentLease),storeB=await stores.createWorkspaceStore(b),backupB=p.createPortableBackupStore(storeB),bEmpty=(await backupB.read())===null;
   await backupB.save(ownerB.phrase,snapshotB,null);let stale=false;try{await a.save(ownerA.phrase,snapshotA,revision);}catch{stale=true;}
   const bName=(await backupB.open(ownerB.phrase)).identity.profile.name;
   window.currentLease=await sessions.activateWorkspace(leaseA.workspaceId,b);window.currentStore=await stores.createWorkspaceStore(currentLease);window.currentBackup=p.createPortableBackupStore(currentStore);
   const reopened=await currentBackup.open(ownerA.phrase);
   return {empty,bEmpty,stale,a:opened.identity.profile.name,b:bName,reopened:reopened.identity.profile.name,restricted:reopened.identity.access,legacy:(await p.readPortableBackup()).revision===originalBackup};
  });
  assert.deepEqual(backups,{empty:true,bEmpty:true,stale:true,a:'Profile A',b:'Profile B',reopened:'Profile A',restricted:'lenz/recovered-chat/v1',legacy:true});pass('portable backups have separate profile slots and retain unassigned legacy recovery evidence');
  const guests=await page.evaluate(async()=>{
   const p=await import('/account-performance.js'),backup=await import('/portable-chat-backup.js'),empty={identity:null,contacts:[],messages:[]};
   const first=await sessions.stageWorkspace(empty,currentLease),second=await sessions.stageWorkspace(empty,currentLease),firstLease=await sessions.activateWorkspace(first,currentLease),firstStore=await stores.createWorkspaceStore(firstLease),firstHistory=p.createPerformanceStore(firstStore);
   const firstEmpty=(await firstHistory.read()).length;await firstHistory.save(historyFixture('61'));
   let unrelatedBackup=false;try{await backup.createPortableBackupStore(firstStore).save(ownerA.phrase,snapshotA,null);}catch{unrelatedBackup=true;}
   const secondLease=await sessions.activateWorkspace(second,firstLease),secondHistory=p.createPerformanceStore(await stores.createWorkspaceStore(secondLease)),secondEmpty=(await secondHistory.read()).length;await secondHistory.save(historyFixture('79'));
   const reopened=await sessions.activateWorkspace(first,secondLease),value=(await p.createPerformanceStore(await stores.createWorkspaceStore(reopened)).read())[0].equity;
   window.currentLease=await sessions.activateWorkspace(leaseA.workspaceId,reopened);window.currentStore=await stores.createWorkspaceStore(currentLease);window.currentPerformance=p.createPerformanceStore(currentStore);window.currentBackup=backup.createPortableBackupStore(currentStore);
   return {firstEmpty,secondEmpty,value,unrelatedBackup};
  });
  assert.deepEqual(guests,{firstEmpty:0,secondEmpty:0,value:'61',unrelatedBackup:true});pass('external-only workspaces have independent histories and cannot adopt another profile backup');
  const cancelled=await page.evaluate(async()=>{
   const originalPut=IDBObjectStore.prototype.put,beforeHistory=JSON.stringify(await currentPerformance.read()),beforeBackup=JSON.stringify(await currentBackup.read()),rejected=[];
   for(const kind of ['history','backup']){
    const controller=new AbortController();let attempted=false;
    IDBObjectStore.prototype.put=function(...args){const result=originalPut.apply(this,args);if(this.name===kind&&Array.isArray(args[1])){attempted=true;controller.abort(Error('Cancelled during storage.'));}return result;};
    try{if(kind==='history')await currentPerformance.save(historyFixture('999'),{signal:controller.signal});else await currentBackup.save(ownerA.phrase,{...snapshotA,profile:{...snapshotA.profile,name:'Cancelled'}},(await currentBackup.read()).revision,{signal:controller.signal});rejected.push(false);}catch{rejected.push(attempted);}finally{IDBObjectStore.prototype.put=originalPut;}
   }
   return {rejected,history:JSON.stringify(await currentPerformance.read())===beforeHistory,backup:JSON.stringify(await currentBackup.read())===beforeBackup};
  });
  assert.deepEqual(cancelled,{rejected:[true,true],history:true,backup:true});pass('cancellation after an actual put aborts each auxiliary transaction without replacing its prior record');
  const quota=await page.evaluate(async()=>{
   const originalPut=IDBObjectStore.prototype.put,beforeHistory=JSON.stringify(await currentPerformance.read()),beforeBackup=JSON.stringify(await currentBackup.read()),rejected=[];
   IDBObjectStore.prototype.put=function(...args){if(['history','backup'].includes(this.name))throw new DOMException('Storage full','QuotaExceededError');return originalPut.apply(this,args);};
   try{for(const operation of [()=>currentPerformance.save(historyFixture('999')),()=>currentBackup.save(ownerA.phrase,snapshotA,JSON.parse(beforeBackup).revision)]){try{await operation();rejected.push(false);}catch{rejected.push(true);}}}finally{IDBObjectStore.prototype.put=originalPut;}
   return {rejected,history:JSON.stringify(await currentPerformance.read())===beforeHistory,backup:JSON.stringify(await currentBackup.read())===beforeBackup};
  });
  assert.deepEqual(quota,{rejected:[true,true],history:true,backup:true});pass('quota failures preserve both profile caches');
  const other=await context.newPage();await other.goto(base);
  for(const kind of ['performance','backup']){
   await page.evaluate(async kind=>{
    const native=SubtleCrypto.prototype.decrypt;window.cacheReadPaused=false;
    SubtleCrypto.prototype.decrypt=function(algorithm,...args){const label=new TextDecoder().decode(algorithm.additionalData??new Uint8Array()),matches=label.includes(kind==='performance'?'lenz-account-performance-v1':'lenz/chat-archive/v2');if(matches&&!cacheReadPaused){window.cacheReadPaused=true;return new Promise(resolve=>window.releaseCacheRead=resolve).then(()=>native.call(this,algorithm,...args));}return native.call(this,algorithm,...args);};
    window.restoreDecrypt=()=>{SubtleCrypto.prototype.decrypt=native;};window.delayedCacheRead=(kind==='performance'?currentPerformance.read():currentBackup.open(ownerA.phrase)).then(()=>false,()=>true);
   },kind);
   await page.waitForFunction(()=>window.cacheReadPaused);
   await other.evaluate(async()=>{const s=await import('/workspace-session.js'),old=await s.workspaceSession(),closed=await s.signOutWorkspace(old);await s.activateWorkspace(old.workspaceId,closed);});
   assert.equal(await page.evaluate(async()=>{restoreDecrypt();releaseCacheRead();return delayedCacheRead;}),true);
   await page.evaluate(async()=>{window.currentLease=await sessions.workspaceSession();window.currentStore=await stores.createWorkspaceStore(currentLease);window.currentPerformance=(await import('/account-performance.js')).createPerformanceStore(currentStore);window.currentBackup=(await import('/portable-chat-backup.js')).createPortableBackupStore(currentStore);});
   pass('late '+kind+' decryption is rejected after two-tab sign-out and same-profile reopening');
  }
  await page.evaluate(async()=>{
   const native=SubtleCrypto.prototype.encrypt;window.backupSavePaused=false;window.beforeDelayedBackup=JSON.stringify(await currentBackup.read());
   SubtleCrypto.prototype.encrypt=function(algorithm,...args){const label=new TextDecoder().decode(algorithm.additionalData??new Uint8Array());if(label.includes('lenz/chat-archive/v2')&&!backupSavePaused){window.backupSavePaused=true;return new Promise(resolve=>window.releaseBackupSave=resolve).then(()=>native.call(this,algorithm,...args));}return native.call(this,algorithm,...args);};
   window.restoreEncrypt=()=>{SubtleCrypto.prototype.encrypt=native;};window.delayedBackupSave=currentBackup.save(ownerA.phrase,{...snapshotA,profile:{...snapshotA.profile,name:'Late change'}},JSON.parse(beforeDelayedBackup).revision).then(()=>false,()=>true);
  });
  await page.waitForFunction(()=>window.backupSavePaused);
  await other.evaluate(async()=>{const s=await import('/workspace-session.js'),old=await s.workspaceSession(),closed=await s.signOutWorkspace(old);await s.activateWorkspace(old.workspaceId,closed);});
  assert.equal(await page.evaluate(async()=>{restoreEncrypt();releaseBackupSave();return delayedBackupSave;}),true);
  assert.equal(await page.evaluate(async()=>{window.currentLease=await sessions.workspaceSession();window.currentStore=await stores.createWorkspaceStore(currentLease);window.currentBackup=(await import('/portable-chat-backup.js')).createPortableBackupStore(currentStore);return JSON.stringify(await currentBackup.read())===beforeDelayedBackup;}),true);pass('sign-out does not wait on archive preparation and its late save cannot replace a reopened profile backup');
  const revision=await page.evaluate(async()=>(await currentBackup.read()).revision);
  const writes=await Promise.all([page,other].map((p,index)=>p.evaluate(async({phrase,revision,index})=>{const s=await import('/workspace-session.js'),w=await import('/workspace-store.js'),b=await import('/portable-chat-backup.js'),workspace=await w.createWorkspaceStore(await s.workspaceSession()),store=b.createPortableBackupStore(workspace),state=await workspace.readState();try{await store.save(phrase,{profile:{...state.identity.profile,name:'Writer '+index},contacts:state.contacts,messages:state.messages},revision);return true;}catch{return false;}},{phrase:fixture.aPhrase,revision,index})));
  assert.equal(writes.filter(Boolean).length,1);pass('two bound tabs cannot overwrite the same portable backup revision');
  await context.close();context=null;page=await launch();
  const reopened=await page.evaluate(async({aPhrase,bPhrase,bWorkspace})=>{
   const s=await import('/workspace-session.js'),w=await import('/workspace-store.js'),p=await import('/account-performance.js'),b=await import('/portable-chat-backup.js'),a=await s.workspaceSession(),storeA=await w.createWorkspaceStore(a);
   const historyA=(await p.createPerformanceStore(storeA).read())[0].equity,backupA=await b.createPortableBackupStore(storeA).open(aPhrase);
   const next=await s.activateWorkspace(bWorkspace,a),storeB=await w.createWorkspaceStore(next),historyB=(await p.createPerformanceStore(storeB).read())[0].equity,backupB=await b.createPortableBackupStore(storeB).open(bPhrase);
   return {historyA,historyB,backupA:backupA.identity.profile.name,backupB:backupB.identity.profile.name,restricted:backupA.identity.access===backupB.identity.access&&backupA.identity.access==='lenz/recovered-chat/v1'};
  },fixture);
  assert.equal(reopened.historyA,'23');assert.equal(reopened.historyB,'41');assert.match(reopened.backupA,/^Writer [01]$/);assert.equal(reopened.backupB,'Profile B');assert(reopened.restricted);pass('both profile histories and restricted backups survive full browser restart');
  const result={checkedAt:new Date().toISOString(),passed:checks.length,tests:checks,scope:'Disposable Edge profile and real IndexedDB; no actual wallet or user data.'};
  if(process.env.LENZ_PROFILE_CACHE_REPORT)await fs.writeFile(process.env.LENZ_PROFILE_CACHE_REPORT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
