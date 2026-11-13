const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');

(async()=>{
 const publicRoot=path.join(process.env.LENZ_SOURCE_ROOT??path.join(__dirname,'..'),'web/public'),report=process.env.LENZ_TEST_REPORT_DIR??await fs.mkdtemp(path.join(os.tmpdir(),'lenz-workspace-performance-'));
 await fs.mkdir(report,{recursive:true});const profile=await fs.mkdtemp(path.join(report,'browser-')),checks=[],files=new Set(['/fixture.html']);let context,serverStopped=false;
 async function dependencies(file){if(files.has('/'+file))return;files.add('/'+file);const source=await fs.readFile(path.join(publicRoot,file),'utf8');for(const m of source.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g))await dependencies(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));}
 await dependencies('workspace-store.js');await dependencies('account-performance.js');
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Performance workspace fixture</title><script type="module">await navigator.serviceWorker.register("/fixture-sw.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));window.fixtureReady=true;</script>');return;}
  if(req.url==='/fixture-sw.js'){res.setHeader('Content-Type','text/javascript');res.end('self.addEventListener("install",e=>e.waitUntil(caches.open("performance-workspace-v1").then(c=>c.addAll('+JSON.stringify([...files])+')).then(()=>self.skipWaiting())));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));');return;}
  try{const file=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname);assert(file.startsWith(publicRoot+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 async function page(){const p=await context.newPage();await p.goto(base+'/fixture.html');await p.waitForFunction(()=>window.fixtureReady);return p;}
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});const p=await page();
  const adopted=await p.evaluate(async()=>{
   window.performanceModule=await import('/account-performance.js');window.m=await import('/workspace-session.js');window.createStore=(await import('/workspace-store.js')).createWorkspaceStore;
   window.snapshot=(account,equity)=>({account:'0x'+account.repeat(40),observedAt:1780000000000,start:1780000000000-30*86400000,end:1780000000000,fills:[],positions:[],openOrders:[],equity,withdrawable:equity});
   window.records=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-account-performance-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history'),store=tx.objectStore('history'),keys=store.getAllKeys(),values=store.getAll();tx.oncomplete=()=>{db.close();resolve(values.result.map((value,i)=>({key:keys.result[i],value})));};tx.onerror=()=>{db.close();reject(tx.error);};};});
   window.recordEvidence=async()=>Promise.all((await records()).map(async({key,value})=>{
    const aad=typeof key==='string'?'lenz-account-performance-v1:'+value.owner:JSON.stringify(['lenz-account-performance-v1',key[1],value.owner]);
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv,additionalData:new TextEncoder().encode(aad)},value.key,value.box);
    return {key,owner:value.owner,iv:Array.from(value.iv),box:Array.from(new Uint8Array(value.box)),plaintext:new TextDecoder().decode(clear),extractable:value.key.extractable};
   }));
   await performanceModule.savePerformance(snapshot('a','11'),'guest');window.rawBefore=await recordEvidence();
   window.lease=await m.initializeWorkspaces();window.store=await createStore(lease);window.performanceStore=performanceModule.createPerformanceStore(store);
   await performanceStore.save(snapshot('b','22'));const guest=(await performanceStore.read()).map(r=>r.equity);window.guestBefore=await recordEvidence();
   window.identity=(await import('/peer-crypto.js')).createIdentity;await store.updateState(async state=>{state.identity=await identity('Performance A');});
   const fresh=await performanceStore.read();await performanceStore.save(snapshot('c','33'));const named=(await performanceStore.read()).map(r=>r.equity),after=await recordEvidence();
   return {guest,fresh:fresh.length,named,preserved:guestBefore.every(before=>after.some(row=>JSON.stringify(row)===JSON.stringify(before))),rawPreserved:rawBefore.every(before=>after.some(row=>JSON.stringify(row)===JSON.stringify(before))),encrypted:after.every(row=>row.extractable===false)};
  });
  assert.deepEqual(adopted,{guest:['11','22'],fresh:0,named:['33'],preserved:true,rawPreserved:true,encrypted:true});pass('initial profile adoption keeps guest and raw encrypted history intact while starting separate named history');
  const corruption=await p.evaluate(async()=>{
   const currentId=(await store.readState()).identity.profile.id,currentKey=['workspace',store.workspaceId,currentId],priorKey=['workspace',store.workspaceId],initial=await records();
   const current=initial.find(row=>JSON.stringify(row.key)===JSON.stringify(currentKey)).value,raw=initial.find(row=>row.key==='saved').value;
   const put=(key,value)=>new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-account-performance-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history','readwrite'),s=tx.objectStore('history');if(value===undefined)s.delete(key);else s.put(value,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});
   const bytes=async()=>JSON.stringify((await records()).map(({key,value})=>({key,value:value===null?null:{fields:Object.keys(value).sort(),owner:value.owner,keyType:value.key?.type,extractable:value.key?.extractable,algorithm:value.key?.algorithm,usages:value.key?.usages,iv:value.iv instanceof Uint8Array?Array.from(value.iv):value.iv,box:value.box instanceof ArrayBuffer?Array.from(new Uint8Array(value.box)):value.box}})));
   const missing={...current};delete missing.owner;const foreign=initial.find(row=>Array.isArray(row.key)&&row.key[1]===store.workspaceId&&row.value.owner==='guest').value,invalid={...raw,owner:'not-a-profile'};
   const brokenBox=raw.box.slice(0);new Uint8Array(brokenBox)[0]^=1;
   const cases=[['current-null',currentKey,null],['current-missing-owner',currentKey,missing],['current-foreign-owner',currentKey,foreign],['prior-null',priorKey,null],['prior-invalid-owner',priorKey,invalid],['prior-corrupt-foreign-box',priorKey,{...raw,box:brokenBox}],['raw-null','saved',null],['raw-invalid-owner','saved',invalid],['raw-corrupt-foreign-box','saved',{...raw,box:brokenBox}]],results=[];
   try{for(const[name,key,value]of cases){
    await put(currentKey,undefined);await put(priorKey,undefined);await put('saved',raw);await put(key,value);const before=await bytes();let read=false,save=false;
    try{await performanceStore.read();}catch{read=true;}try{await performanceStore.save(snapshot('c','99'));}catch{save=true;}
    results.push({name,read,save,preserved:before===await bytes()});
   }}finally{await put(currentKey,current);await put(priorKey,undefined);await put('saved',raw);}
   return results;
  });
  assert(corruption.every(row=>row.read&&row.save&&row.preserved),JSON.stringify(corruption));pass('malformed or foreign owner-slot records and damaged prior evidence reject reads and writes without replacement');
  const olderScoped=await p.evaluate(async()=>{
   window.aId=store.workspaceId;window.bId=await m.stageWorkspace({identity:null,contacts:[],messages:[]},await m.workspaceSession());
   window.select=async id=>{store?.close();const lease=await m.activateWorkspace(id,await m.workspaceSession());window.store=await createStore(lease);window.performanceStore=performanceModule.createPerformanceStore(store);};await select(bId);
   const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
   const box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify(['lenz-account-performance-v1',bId,'guest']))},key,new TextEncoder().encode(JSON.stringify([snapshot('d','44')])));
   // Previous scoped records had one slot per workspace, with the recorded owner in their authenticated data.
   await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-account-performance-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history','readwrite');tx.objectStore('history').put({owner:'guest',key,iv,box},['workspace',bId]);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};});
   const before=await recordEvidence(),old=(await performanceStore.read()).map(row=>row.equity);await performanceStore.save(snapshot('e','55'));const guest=(await performanceStore.read()).map(row=>row.equity),guestRecords=await recordEvidence();
   await store.updateState(async state=>{state.identity=await identity('Performance B');});const fresh=await performanceStore.read();await performanceStore.save(snapshot('f','66'));
   const named=(await performanceStore.read()).map(row=>row.equity),after=await recordEvidence();await select(aId);const a=(await performanceStore.read()).map(row=>row.equity);
   return {old,guest,fresh:fresh.length,named,a,originalPreserved:before.every(row=>after.some(item=>JSON.stringify(item)===JSON.stringify(row))),guestPreserved:guestRecords.every(row=>after.some(item=>JSON.stringify(item)===JSON.stringify(row))),defaultRead:(await performanceModule.savedPerformance({identity:null})).map(row=>row.equity)};
  });
  assert.deepEqual(olderScoped,{old:['44'],guest:['44','55'],fresh:0,named:['66'],a:['33'],originalPreserved:true,guestPreserved:true,defaultRead:['11']});pass('previous scoped history is read without rewriting it and retained separately after guest adoption');
  const cancelled=await p.evaluate(async()=>{
   const before=await recordEvidence(),controller=new AbortController(),put=IDBObjectStore.prototype.put;let reached=false,rejected=false;
   IDBObjectStore.prototype.put=function(value,...args){const result=put.call(this,value,...args);if(this.name==='history'){reached=true;controller.abort(Error('Closed saved history'));}return result;};
   try{await performanceStore.save(snapshot('c','99'),{signal:controller.signal});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   const after=await recordEvidence(),prior=performanceStore,old=await m.workspaceSession();await m.signOutWorkspace(old);await select(old.workspaceId);let read=false,write=false;
   try{await prior.read();}catch{read=true;}try{await prior.save(snapshot('c','99'));}catch{write=true;}
   return {reached,rejected,unchanged:JSON.stringify(before)===JSON.stringify(after),read,write,current:(await performanceStore.read()).map(row=>row.equity)};
  });
  assert.deepEqual(cancelled,{reached:true,rejected:true,unchanged:true,read:true,write:true,current:['33']});pass('actual put cancellation and stale adapters preserve all retained history');
  const retained=await p.evaluate(()=>recordEvidence()),ids=await p.evaluate(async()=>{await m.signOutWorkspace(await m.workspaceSession());return {aId,bId};});
  await context.close();context=null;await new Promise(resolve=>server.close(resolve));serverStopped=true;
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,offline:true});const reopened=await page();
  const offline=await reopened.evaluate(async ids=>{
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),module=await import('/account-performance.js'),saved=await m.workspaceSession();
   const aLease=await m.activateWorkspace(ids.aId,saved),a=module.createPerformanceStore(await createWorkspaceStore(aLease));const first=(await a.read()).map(row=>row.equity);
   const bLease=await m.activateWorkspace(ids.bId,aLease),b=module.createPerformanceStore(await createWorkspaceStore(bLease)),second=(await b.read()).map(row=>row.equity);
   const records=await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-account-performance-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history'),store=tx.objectStore('history'),keys=store.getAllKeys(),values=store.getAll();tx.oncomplete=()=>{db.close();resolve(values.result.map((value,i)=>({key:keys.result[i],value})));};tx.onerror=()=>{db.close();reject(tx.error);};};});
   const evidence=await Promise.all(records.map(async({key,value})=>{const aad=typeof key==='string'?'lenz-account-performance-v1:'+value.owner:JSON.stringify(['lenz-account-performance-v1',key[1],value.owner]),clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv,additionalData:new TextEncoder().encode(aad)},value.key,value.box);return {key,owner:value.owner,iv:Array.from(value.iv),box:Array.from(new Uint8Array(value.box)),plaintext:new TextDecoder().decode(clear),extractable:value.key.extractable};}));
   return {signedOut:saved.workspaceId===null,first,second,evidence};
  },ids);
  assert.deepEqual(offline,{signedOut:true,first:['33'],second:['66'],evidence:retained});pass('full offline browser restart retains sign-out, independent profile history and exact guest/source ciphertexts');
  await fs.writeFile(path.join(report,'results.json'),JSON.stringify({passed:checks.length,checks},null,2));
 }catch(error){await fs.writeFile(path.join(report,'failure.json'),JSON.stringify({passed:checks.length,checks,error:error.stack},null,2));throw error;}
 finally{await context?.close();if(!serverStopped)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
