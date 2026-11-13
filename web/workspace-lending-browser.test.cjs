const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');

(async()=>{
 const publicRoot=path.join(process.env.LENZ_SOURCE_ROOT??path.join(__dirname,'..'),'web/public'),report=process.env.LENZ_TEST_REPORT_DIR??await fs.mkdtemp(path.join(os.tmpdir(),'lenz-workspace-lending-'));
 await fs.mkdir(report,{recursive:true});const profile=await fs.mkdtemp(path.join(report,'browser-')),checks=[],files=new Set(['/fixture.html']);let context,serverStopped=false;
 const {positionFixture}=await import(pathToFileURL(path.join(__dirname,'lending-position-fixture.mjs'))),{readLendingPosition}=await import(pathToFileURL(path.join(publicRoot,'lending-position.js'))),fixture=positionFixture(),snapshot=await readLendingPosition(fixture.lease,fixture.row);
 async function dependencies(file){if(files.has('/'+file))return;files.add('/'+file);const source=await fs.readFile(path.join(publicRoot,file),'utf8');for(const m of source.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g))await dependencies(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));}
 await dependencies('workspace-store.js');await dependencies('lending-position-store.js');
 const prior=file=>execFileSync('git',['show','14315064100bd7ed9f3ad360f120c64435e1b027:web/public/'+file],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true});
 const legacyStore=prior('chat-store.js'),legacyPositions=prior('lending-position-store.js').replace("'./chat-store.js'","'./legacy-chat-store.js'");
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/legacy-chat-store.js'||req.url==='/legacy-lending-position-store.js'){res.setHeader('Content-Type','text/javascript');res.end(req.url==='/legacy-chat-store.js'?legacyStore:legacyPositions);return;}
  if(req.url==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Lending workspace fixture</title><script type="module">await navigator.serviceWorker.register("/fixture-sw.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));window.fixtureReady=true;</script>');return;}
  if(req.url==='/fixture-sw.js'){res.setHeader('Content-Type','text/javascript');res.end('self.addEventListener("install",e=>e.waitUntil(caches.open("lending-workspace-v1").then(c=>c.addAll('+JSON.stringify([...files])+')).then(()=>self.skipWaiting())));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));');return;}
  try{const file=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname);assert(file.startsWith(publicRoot+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 async function open(offline=false){return chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,offline});}
 async function page(){const p=await context.newPage();await p.goto(base+'/fixture.html');await p.waitForFunction(()=>window.fixtureReady);return p;}
 try{
  context=await open();let p=await page();
  const migrated=await p.evaluate(async snapshot=>{
   const {createIdentity}=await import('/peer-crypto.js'),legacy=await import('/chat-store.js'),module=await import('/lending-position-store.js');window.identityA=await createIdentity('Lending A');
   await legacy.updateState(state=>{state.identity=identityA;});await module.saveLendingPosition(snapshot,identityA.profile.id);
   window.m=await import('/workspace-session.js');window.createStore=(await import('/workspace-store.js')).createWorkspaceStore;window.createPositions=module.createLendingPositionStore;
   window.readRecords=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-lending-positions-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('snapshots'),request=tx.objectStore('snapshots').getAll();tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onerror=()=>{db.close();reject(tx.error);};};});
   window.legacyRecord=(await readRecords())[0];window.leaseA=await m.initializeWorkspaces();window.store=await createStore(leaseA);window.positions=createPositions(store);window.original=snapshot;
   const before=await positions.read();await positions.save({...snapshot,observedAt:snapshot.observedAt+1});const after=await positions.read();
   return {before:before[0].supplied,after:after[0].supplied,at:after[0].observedAt,workspace:store.workspaceId};
  },snapshot);
  assert.deepEqual(migrated,{before:'1250.5',after:'1250.5',at:snapshot.observedAt+1,workspace:'legacy'});pass('legacy position remains readable and a workspace save retains the same observed amount');
  const isolated=await p.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js');window.workspaceA=store.workspaceId;window.stalePositions=positions;
   window.workspaceB=await m.stageWorkspace({identity:await createIdentity('Lending B'),contacts:[],messages:[]},await m.workspaceSession());
   window.select=async id=>{store?.close();const lease=await m.activateWorkspace(id,await m.workspaceSession());window.store=await createStore(lease);window.positions=createPositions(store);};
   await select(workspaceB);const empty=await positions.read();await positions.save({...original,suppliedUnits:'77000000',supplied:'77'});const b=(await positions.read())[0];
   let stale=false;try{await stalePositions.read();}catch{stale=true;}
   await select(workspaceA);const a=(await positions.read())[0],records=await readRecords();
   const preserved=records.some(r=>Array.from(new Uint8Array(r.box)).join()===Array.from(new Uint8Array(legacyRecord.box)).join()&&Array.from(r.iv).join()===Array.from(legacyRecord.iv).join());
   return {empty:empty.length,a:a.supplied,b:b.supplied,stale,preserved,encrypted:records.every(r=>r.key.extractable===false&&r.box instanceof ArrayBuffer&&!Object.hasOwn(r,'suppliedUnits'))};
  });
  assert.deepEqual(isolated,{empty:0,a:'1250.5',b:'77',stale:true,preserved:true,encrypted:true});pass('two Lenz profiles retain separate encrypted positions for the same external wallet and preserve the original row');
  const guests=await p.evaluate(async()=>{
   const first=await m.stageWorkspace({identity:null,contacts:[],messages:[]},await m.workspaceSession());await select(first);
   await positions.save({...original,suppliedUnits:'31000000',supplied:'31'});
   const second=await m.stageWorkspace({identity:null,contacts:[],messages:[]},await m.workspaceSession());await select(second);const empty=await positions.read();
   await positions.save({...original,suppliedUnits:'42000000',supplied:'42'});const b=(await positions.read())[0].supplied;await select(first);const a=(await positions.read())[0].supplied;await select(workspaceA);
   return {empty:empty.length,a,b};
  });
  assert.deepEqual(guests,{empty:0,a:'31',b:'42'});pass('external-only workspaces do not share guest position history');
  const adoption=await p.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),id=await m.stageWorkspace({identity:null,contacts:[],messages:[]},await m.workspaceSession());await select(id);
   await positions.save({...original,suppliedUnits:'9000000',supplied:'9'});const before=await readRecords(),boxes=before.map(r=>Array.from(new Uint8Array(r.box)).join());
   const identity=await createIdentity('External profile adoption');await store.updateState(state=>{state.identity=identity;});
   const empty=await positions.read();await positions.save({...original,suppliedUnits:'11000000',supplied:'11'});const amount=(await positions.read())[0].supplied,after=(await readRecords()).map(r=>Array.from(new Uint8Array(r.box)).join());await select(workspaceA);
   return {empty:empty.length,amount,preserved:boxes.every(box=>after.includes(box))};
  });
  assert.deepEqual(adoption,{empty:0,amount:'11',preserved:true});pass('initial Lenz identity adoption preserves earlier guest evidence without attributing it to the new identity');
  const replay=await p.evaluate(async()=>{
   const saved=(await positions.read())[0],failures=[];
   for(const change of [{block:'0x29'},{blockHash:'0x'+'cd'.repeat(32)},{suppliedUnits:'1',supplied:'0.000001'},{variableDebtUnits:'1',variableDebt:'0.000001'},{collateral:false},{reserveId:4},{blockTime:saved.blockTime+1000},{stableDebtStatus:'unknown'}]){
    try{await positions.save({...saved,...change});failures.push(false);}catch{failures.push(true);}
   }
   return {failures,retained:(await positions.read())[0].supplied};
  });
  assert.deepEqual(replay,{failures:Array(8).fill(true),retained:'1250.5'});pass('workspace saves reject older observations and conflicting data at the same canonical block');
  const aborted=await p.evaluate(async()=>{
   const saved=(await positions.read())[0],controller=new AbortController(),put=IDBObjectStore.prototype.put;let entered=false,rejected=false;
   IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.transaction.db.name==='lenz-lending-positions-v1'){entered=true;queueMicrotask(()=>controller.abort(Error('Cancelled position save')));}return result;};
   try{await positions.save({...saved,observedAt:saved.observedAt+1},{signal:controller.signal});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   return {entered,rejected,at:(await positions.read())[0].observedAt,previous:saved.observedAt};
  });
  assert(aborted.entered&&aborted.rejected);assert.equal(aborted.at,aborted.previous);pass('cancellation after an actual IndexedDB put aborts the transaction and preserves prior history');
  const failed=await p.evaluate(async()=>{
   const saved=(await positions.read())[0],put=IDBObjectStore.prototype.put;let rejected=false;
   IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='lenz-lending-positions-v1')throw new DOMException('Full test storage','QuotaExceededError');return put.apply(this,args);};
   try{await positions.save({...saved,observedAt:saved.observedAt+1});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   return {rejected,at:(await positions.read())[0].observedAt,previous:saved.observedAt};
  });
  assert(failed.rejected);assert.equal(failed.at,failed.previous);pass('failed storage preserves the previous observation and rejects the save');
  const other=await page();
  await p.evaluate(()=>{
   const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);window.decryptEntered=false;window.delayedPositions=positions;let release;const gate=new Promise(resolve=>release=resolve);window.releaseDecrypt=release;
   crypto.subtle.decrypt=async(...args)=>{window.decryptEntered=true;await gate;return decrypt(...args);};window.restoreDecrypt=()=>crypto.subtle.decrypt=decrypt;
   window.delayedRead=positions.read().then(()=>false,()=>true);
  });
  await p.waitForFunction(()=>window.decryptEntered);
  await other.evaluate(async()=>{const m=await import('/workspace-session.js'),lease=await m.workspaceSession(),closed=await m.signOutWorkspace(lease);await m.activateWorkspace(lease.workspaceId,closed);});
  const late=await p.evaluate(async()=>{
   restoreDecrypt();releaseDecrypt();const rejected=await delayedRead;let save=false;try{await delayedPositions.save(original);}catch{save=true;}
   window.store=await createStore(await m.workspaceSession());window.positions=createPositions(store);return {rejected,save,retained:(await positions.read())[0].supplied};
  });
  assert.deepEqual(late,{rejected:true,save:true,retained:'1250.5'});pass('sign-out and same-profile reopen reject an earlier decrypt result and save across real tabs');
  const serialization=await p.evaluate(async()=>{
   const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let release,entered=false;const gate=new Promise(resolve=>release=resolve);
   crypto.subtle.encrypt=async(...args)=>{entered=true;await gate;return encrypt(...args);};
   const saved=(await positions.read())[0],leaseBefore=await m.workspaceSession(),saving=positions.save({...saved,observedAt:saved.observedAt+1});
   while(!entered)await new Promise(resolve=>setTimeout(resolve,0));let finished=false;const closing=m.signOutWorkspace(leaseBefore).then(value=>{finished=true;return value;});
   await new Promise(resolve=>setTimeout(resolve,30));const waited=!finished;crypto.subtle.encrypt=encrypt;release();
   // A completed durable write may still reject its return if the subsequent sign-out wins the notification race.
   try{await saving;}catch{}const closed=await closing;const lease=await m.activateWorkspace(workspaceA,closed);window.store=await createStore(lease);window.positions=createPositions(store);
   return {waited,at:(await positions.read())[0].observedAt,expected:saved.observedAt+1};
  });
  assert(serialization.waited);assert.equal(serialization.at,serialization.expected);pass('sign-out waits for an already fenced position transaction before closing access');
  const wrongScope=await p.evaluate(async()=>{
   const registry=await m.listWorkspaces(),id=['workspace',workspaceA,registry.find(r=>r.id===workspaceA).profileId],foreign=['workspace',workspaceB,registry.find(r=>r.id===workspaceB).profileId];
   const copied=await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-lending-positions-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('snapshots','readwrite'),s=tx.objectStore('snapshots'),old=s.get(id),other=s.get(foreign);let original;old.onsuccess=()=>{original=old.result;};other.onsuccess=()=>s.put(other.result,id);tx.oncomplete=()=>{db.close();resolve(original);};tx.onerror=()=>{db.close();reject(tx.error);};};});
   let rejected=false;try{await positions.read();}catch{rejected=true;}
   await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-lending-positions-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(copied,id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});
   return {rejected,retained:(await positions.read())[0].supplied};
  });
  assert.deepEqual(wrongScope,{rejected:true,retained:'1250.5'});pass('a record copied from another workspace fails authenticated decryption');
  const corrupt=await p.evaluate(async()=>{
   const key=['workspace',store.workspaceId,(await store.readState()).identity.profile.id];
   const exchange=value=>new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-lending-positions-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('snapshots','readwrite'),s=tx.objectStore('snapshots'),old=s.get(key);let prior;old.onsuccess=()=>{prior=old.result;s.put(value,key);};tx.oncomplete=()=>{db.close();resolve(prior);};tx.onerror=()=>{db.close();reject(tx.error);};};});
   const retained=await exchange(null);let read=false,save=false;
   try{await positions.read();}catch{read=true;}try{await positions.save(original);}catch{save=true;}const damaged=await exchange(retained);
   return {read,save,untouched:damaged===null,amount:(await positions.read())[0].supplied};
  });
  assert.deepEqual(corrupt,{read:true,save:true,untouched:true,amount:'1250.5'});pass('a damaged scoped record blocks fallback and replacement while original evidence is retained');
  await p.evaluate(async()=>{
   const legacy=await import('/legacy-lending-position-store.js');window.oldLockEntered=false;let release;const wait=new Promise(resolve=>release=resolve);window.releaseOldLock=release;
   window.oldBlocker=navigator.locks.request('lenz-lending-positions-v1',async()=>{window.oldLockEntered=true;await wait;});
   window.startLegacySave=()=>legacy.saveLendingPosition(original,identityA.profile.id).then(()=>({ok:true}),error=>({ok:false,error:error.name}));
  });
  await p.waitForFunction(()=>window.oldLockEntered);
  await p.evaluate(()=>{window.legacySave=startLegacySave();});
  await p.waitForFunction(async()=>(await navigator.locks.query()).pending.some(r=>r.name==='lenz-lending-positions-v1'));
  await p.evaluate(async()=>{const saved=(await positions.read())[0];window.scopedFinished=false;window.scopedSave=positions.save({...saved,observedAt:saved.observedAt+1}).then(()=>{window.scopedFinished=true;return {ok:true};},error=>{window.scopedFinished=true;return {ok:false,error:error.name};});});
  await p.waitForFunction(async()=>{const locks=await navigator.locks.query();return window.scopedFinished||locks.held.some(r=>r.name==='proof-u-private-chat-v1')&&locks.pending.filter(r=>r.name==='lenz-lending-positions-v1').length>=2;});
  const overlap=await p.evaluate(async()=>{
   releaseOldLock();let timeout;try{return await Promise.race([Promise.all([legacySave,scopedSave]),new Promise(resolve=>timeout=setTimeout(()=>resolve('deadlocked'),2000))]);}finally{clearTimeout(timeout);}
  });
  assert.deepEqual(overlap,[{ok:false,error:'VersionError'},{ok:true}]);pass('a pinned old save rejects after migration while the scoped save completes without a lock cycle');
  const expected=await p.evaluate(async()=>({a:workspaceA,b:workspaceB,id:(await store.readState()).identity.profile.id}));
  await context.close();context=null;await new Promise(resolve=>server.close(resolve));serverStopped=true;context=await open(true);p=await page();
  const reopened=await p.evaluate(async expected=>{
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),{createLendingPositionStore}=await import('/lending-position-store.js');
   let lease=await m.workspaceSession(),store=await createWorkspaceStore(lease),positions=createLendingPositionStore(store);const a=(await positions.read())[0].supplied,id=(await store.readState()).identity.profile.id;store.close();
   lease=await m.activateWorkspace(expected.b,lease);store=await createWorkspaceStore(lease);positions=createLendingPositionStore(store);const b=(await positions.read())[0].supplied;store.close();
   await m.activateWorkspace(expected.a,lease);return {a,b,id,offline:!navigator.onLine};
  },expected);
  assert.deepEqual(reopened,{a:'1250.5',b:'77',id:expected.id,offline:true});pass('full offline browser restart after server shutdown preserves both profiles and their distinct observations');
  await fs.writeFile(path.join(report,'results.json'),JSON.stringify({checks,count:checks.length},null,2));
 }finally{await context?.close();if(!serverStopped)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
