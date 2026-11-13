const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{execFileSync}=require('node:child_process');

(async()=>{
 const root=path.resolve(process.env.LENZ_SOURCE_ROOT??path.join(__dirname,'..')),publicRoot=path.join(root,'web/public'),report=process.env.LENZ_FINANCIAL_WORKSPACE_REPORT_DIR??await fs.mkdtemp(path.join(os.tmpdir(),'lenz-workspace-review-'));
 await fs.mkdir(report,{recursive:true});const checks=[],profile=await fs.mkdtemp(path.join(report,'browser-'));let context;
 const prior=file=>execFileSync('git',['show','14315064100bd7ed9f3ad360f120c64435e1b027:web/public/'+file],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true});
 const legacyChat=prior('chat-store.js'),legacyFinancial=prior('financial-reconciliation-store.js').replace("'./chat-store.js'","'./legacy-chat-store.js'");
 const server=http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',route.endsWith('.html')?'text/html':'text/javascript');
  if(route==='/fixture.html')return res.end('<!doctype html><title>Financial workspace fixture</title><script type="module">await navigator.serviceWorker.register("/fixture-sw.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));window.fixtureReady=true;</script>');
  if(route==='/fixture-sw.js')return res.end('self.addEventListener("install",e=>e.waitUntil(caches.open("workspace-review-v1").then(c=>c.add("/fixture.html")).then(()=>self.skipWaiting())));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>e.respondWith(caches.open("workspace-review-v1").then(async c=>{const prior=await c.match(e.request);if(prior)return prior;const response=await fetch(e.request);if(response.ok&&e.request.method==="GET")await c.put(e.request,response.clone());return response;})));');
  if(route==='/legacy-financial-review-store.js')return res.end(legacyFinancial);
  if(route==='/legacy-chat-store.js')return res.end(legacyChat);
  if(['/vendor/ffjavascript.js','/vendor/ffjavascript-worker.js'].includes(route))return res.end('/* Proof execution is outside this storage fixture. */');
  try{const target=path.resolve(publicRoot,'.'+route);assert(target.startsWith(publicRoot+path.sep));res.end(await fs.readFile(route==='/financial-reconciliation-store.js'&&process.env.LENZ_FINANCIAL_STORE_SOURCE?process.env.LENZ_FINANCIAL_STORE_SOURCE:target));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 async function page(){const p=await context.newPage();await p.goto(base+'/fixture.html');await p.waitForFunction(()=>window.fixtureReady);return p;}
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});let p=await page();
  const initial=await p.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),legacy=await import('/chat-store.js'),f=await import('/financial-reconciliation-store.js'),core=await import('/financial-reconciliation.js');
   const identity=await createIdentity('Review A');identity.access='lenz/recovered-chat/v1';await legacy.updateState(state=>{state.identity=identity;});
   window.reviewFor=(id,digit,quantity)=>({type:core.FINANCIAL_REVIEW,identity:id,createdAt:1700000000000,financialState:'unreconciled',executable:false,rows:[{domain:'evm',scope:'eip155:1',kind:'transfer',owner:'0x'+'1'.repeat(40),asset:'eip155:1/native',quantity,nonce:'7',input:'',destination:'0x'+'2'.repeat(40),state:'unknown',observedAt:1700000000000,bindingDigest:digit.repeat(64),evidenceDigest:digit.repeat(64)}],gaps:core.FINANCIAL_GAPS.map(domain=>({domain,reason:'unavailable'}))});
   window.first=reviewFor(identity.profile.id,'a','17');await f.saveFinancialReview(first);
   window.identityB=await createIdentity('Review B');await legacy.updateState(state=>{state.identity=identityB;});await f.saveFinancialReview(reviewFor(identityB.profile.id,'e','99'));await legacy.updateState(state=>{state.identity=identity;});
   window.legacyArchive=await new Promise((resolve,reject)=>{const request=indexedDB.open('lenz-financial-reviews-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('reviews'),read=tx.objectStore('reviews').get(identity.profile.id);tx.oncomplete=()=>{db.close();resolve(JSON.stringify(read.result));};};});
   const m=await import('/workspace-session.js');window.leaseA=await m.initializeWorkspaces();window.bind=async lease=>{const store=await(await import('/workspace-store.js')).createWorkspaceStore(lease);return f.createFinancialReviewStore(store);};window.reviews=await bind(leaseA);
   const before=await reviews.read();await reviews.save(reviewFor(identity.profile.id,'b','23'));const after=await reviews.read();return {before,after,access:(await m.readWorkspace(leaseA)).state.identity.access};
  });
  assert.deepEqual(initial.before.rows.map(row=>row.quantity),['17']);assert.deepEqual(initial.after.rows.map(row=>row.quantity),['17','23']);assert.equal(initial.after.executable,false);assert.equal(initial.after.financialState,'unreconciled');assert.equal(initial.access,'lenz/recovered-chat/v1');pass('legacy encrypted review remains readable and merges into the captured workspace without changing recovered access');
  const files=await p.evaluate(async()=>{
   const archive=await reviews.file(reviewFor(first.identity,'8','73')),file=new File([JSON.stringify(archive)],'review.json'),merged=await reviews.mergeFile(file);
   window.exported=archive;return {archive:archive.type,rows:merged.rows.map(row=>row.quantity),saved:(await reviews.read()).rows.map(row=>row.quantity),executable:merged.executable};
  });
  assert.deepEqual(files,{archive:'lenz/encrypted-financial-review/v1',rows:['73','17','23'],saved:['17','23'],executable:false});pass('explicit file export and checked import keep the portable encrypted format and do not save or authorize actions');
  const mixed=await p.evaluate(async()=>{
   const legacy=await import('/legacy-financial-review-store.js');let entered=false,release;const blocker=navigator.locks.request('lenz-financial-reviews-v1',async()=>{entered=true;await new Promise(resolve=>release=resolve);});while(!entered)await new Promise(resolve=>setTimeout(resolve,0));
   let newSettled=false;const old=legacy.saveFinancialReview(first).then(()=>({rejected:false}),error=>({rejected:true,name:error.name})),scoped=reviews.save(first).then(()=>{newSettled=true;return true;},()=>{newSettled=true;return false;});
   const deadline=Date.now()+3000;let staged=false;
   while(Date.now()<deadline){const locks=await navigator.locks.query();if(newSettled||locks.held.some(row=>row.name==='proof-u-private-chat-v1')&&locks.pending.filter(row=>row.name==='lenz-financial-reviews-v1').length>=2){staged=true;break;}await new Promise(resolve=>setTimeout(resolve,5));}
   release();await blocker;if(!staged)throw Error('The overlapping save fixture did not reach its lock boundary.');
   let timeout;try{return await Promise.race([Promise.all([old,scoped]).then(([legacy,newSave])=>({legacy,newSave})),new Promise(resolve=>timeout=setTimeout(()=>resolve({deadlocked:true}),3000))]);}finally{clearTimeout(timeout);}
  });
  assert.deepEqual(mixed,{legacy:{rejected:true,name:'VersionError'},newSave:true});pass('a Git-pinned legacy save rejects incompatible storage while a concurrent workspace save finishes');
  const isolation=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js');window.oldReviews=reviews;
   window.profileB=identityB.profile.id;window.workspaceB=await m.stageWorkspace({identity:identityB,contacts:[],messages:[]},await m.workspaceSession());
   window.leaseB=await m.activateWorkspace(workspaceB,await m.workspaceSession());window.reviews=await bind(leaseB);const empty=await reviews.read(),rejected=[];
   for(const operation of [()=>reviews.save(first),()=>reviews.file(first),()=>reviews.mergeFile(new File([JSON.stringify(exported)],'other-profile.json')),()=>oldReviews.read(),()=>oldReviews.save(first),()=>oldReviews.file(first),()=>oldReviews.mergeFile(new File([JSON.stringify(exported)],'old-session.json'))]){try{await operation();rejected.push(false);}catch{rejected.push(true);}}
   await reviews.save(reviewFor(profileB,'c','31'));const b=await reviews.read();window.leaseA=await m.activateWorkspace(leaseA.workspaceId,await m.workspaceSession());window.reviews=await bind(leaseA);const a=await reviews.read();
   const original=await new Promise((resolve,reject)=>{const request=indexedDB.open('lenz-financial-reviews-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('reviews'),read=tx.objectStore('reviews').get(first.identity);tx.oncomplete=()=>{db.close();resolve(JSON.stringify(read.result));};};});
   return {empty,rejected,a:a.rows.map(row=>row.quantity),b:b.rows.map(row=>row.quantity),legacyUnchanged:original===legacyArchive};
  });
  assert.deepEqual(isolation,{empty:null,rejected:[true,true,true,true,true,true,true],a:['17','23'],b:['31'],legacyUnchanged:true});pass('two profiles keep separate encrypted evidence; only the original workspace adopts legacy history, and foreign files and stale adapters reject');
  const other=await page();
  for(const kind of ['read','file','mergeFile']){
   await p.evaluate(async kind=>{
    window.delayed=false;window.release=null;const wait=new Promise(resolve=>window.release=resolve);
    if(kind==='mergeFile'){window.pending=reviews.mergeFile({size:JSON.stringify(exported).length,text:async()=>{window.delayed=true;await wait;return JSON.stringify(exported);}}).then(()=>false,()=>true);}
    else{const method=kind==='read'?'decrypt':'encrypt',original=crypto.subtle[method].bind(crypto.subtle);window.restoreCrypto=()=>crypto.subtle[method]=original;crypto.subtle[method]=async(...args)=>{if(args[0].name==='AES-GCM'){window.restoreCrypto();window.delayed=true;await wait;}return original(...args);};window.pending=(kind==='read'?reviews.read():reviews.file(first)).then(()=>false,()=>true);}
   },kind);
   await p.waitForFunction(()=>window.delayed);
   await other.evaluate(async()=>{const m=await import('/workspace-session.js'),before=await m.workspaceSession(),closed=await m.signOutWorkspace(before);await m.activateWorkspace(before.workspaceId,closed);});
   await p.evaluate(()=>release());assert.equal(await p.evaluate(()=>pending),true);
   const rows=await p.evaluate(async()=>{const m=await import('/workspace-session.js');window.reviews=await bind(await m.workspaceSession());return (await reviews.read()).rows.map(row=>row.quantity);});assert.deepEqual(rows,['17','23']);
   pass('same-profile sign-out and reopen rejects a delayed '+kind+' result across real tabs');
  }
  const aborted=await p.evaluate(async()=>{
   const controller=new AbortController(),original=IDBObjectStore.prototype.put;let observed=false,rejected=false;
   IDBObjectStore.prototype.put=function(...args){const request=original.apply(this,args);if(this.transaction.db.name==='lenz-financial-reviews-v1'){observed=true;queueMicrotask(()=>controller.abort(Error('Cancelled actual write.')));}return request;};
   try{await reviews.save(reviewFor(first.identity,'d','41'),{signal:controller.signal});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}
   return {observed,rejected,rows:(await reviews.read()).rows.map(row=>row.quantity)};
  });
  assert.deepEqual(aborted,{observed:true,rejected:true,rows:['17','23']});pass('caller cancellation aborts the actual IndexedDB write and retains the earlier review');
  const corruption=await p.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('lenz-financial-reviews-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const get=id=>new Promise((resolve,reject)=>{const tx=db.transaction('reviews'),r=tx.objectStore('reviews').get(id);tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});
   const put=(id,value)=>new Promise((resolve,reject)=>{const tx=db.transaction('reviews','readwrite');tx.objectStore('reviews').put(value,id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   const key=['workspace','legacy'],before=await get(key),other=await get(['workspace',workspaceB]),rejected=[];
   try{for(const value of [null,other]){await put(key,value);for(const operation of [()=>reviews.read(),()=>reviews.save(first)]){try{await operation();rejected.push(false);}catch{rejected.push(true);}}}}finally{await put(key,before);db.close();}
   return {rejected,rows:(await reviews.read()).rows.map(row=>row.quantity)};
  });
  assert.deepEqual(corruption,{rejected:[true,true,true,true],rows:['17','23']});pass('damaged or transplanted encrypted workspace records reject without overwriting evidence or falling back to legacy history');
  const external=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js'),before=await m.workspaceSession(),id=await m.stageWorkspace({identity:null,contacts:[],messages:[]},before),lease=await m.activateWorkspace(id,before),external=await bind(lease),rejected=[];
   for(const operation of [()=>external.read(),()=>external.save(first),()=>external.file(first),()=>external.mergeFile(new File([JSON.stringify(exported)],'review.json'))]){try{await operation();rejected.push(false);}catch{rejected.push(true);}}
   window.reviews=await bind(await m.activateWorkspace(before.workspaceId,await m.workspaceSession()));return rejected;
  });
  assert.deepEqual(external,[true,true,true,true]);pass('external-only workspaces cannot read, save, import or export another profile recovery evidence');
  await other.evaluate(async()=>{const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),{createFinancialReviewStore}=await import('/financial-reconciliation-store.js');window.reviews=createFinancialReviewStore(await createWorkspaceStore(await m.workspaceSession()));});
  const concurrent=await p.evaluate(()=>[reviewFor(first.identity,'6','51'),reviewFor(first.identity,'7','61')]);
  await Promise.all([p.evaluate(value=>reviews.save(value),concurrent[0]),other.evaluate(value=>reviews.save(value),concurrent[1])]);
  assert.deepEqual(await p.evaluate(async()=>(await reviews.read()).rows.map(row=>row.quantity)),['51','61','17','23']);pass('concurrent saves from two tabs retain both incoming evidence records and all earlier conflicts');
  await other.close();await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,offline:true});p=await page();
  const restarted=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),{createFinancialReviewStore}=await import('/financial-reconciliation-store.js'),current=await m.workspaceSession();
   let reviews=createFinancialReviewStore(await createWorkspaceStore(current));const a=await reviews.read(),list=await m.listWorkspaces(),b=list.find(row=>row.name==='Review B');
   const next=await m.activateWorkspace(b.id,current);reviews=createFinancialReviewStore(await createWorkspaceStore(next));const second=await reviews.read();
   return {a:a.rows.map(row=>row.quantity),b:second.rows.map(row=>row.quantity),state:a.financialState,executable:second.executable};
  });
  assert.deepEqual(restarted,{a:['51','61','17','23'],b:['31'],state:'unreconciled',executable:false});pass('full browser restart with the server stopped preserves separate encrypted reviews offline');
  await fs.writeFile(path.join(report,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,checks},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
 }finally{await context?.close();if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
