const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{execFileSync}=require('node:child_process');

(async()=>{
 const root=path.resolve(process.env.LENZ_SOURCE_ROOT??path.join(__dirname,'..')),publicRoot=path.join(root,'web/public'),report=process.env.LENZ_WORKSPACE_STORE_REPORT_DIR??await fs.mkdtemp(path.join(os.tmpdir(),'lenz-workspace-store-'));
 await fs.mkdir(report,{recursive:true});const checks=[],profile=await fs.mkdtemp(path.join(report,'browser-'));let context,serverStopped=false;
 const legacy=execFileSync('git',['show','14315064100bd7ed9f3ad360f120c64435e1b027:web/public/chat-store.js'],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true});
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Workspace store fixture</title><script type="module">await navigator.serviceWorker.register("/fixture-sw.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));window.fixtureReady=true;</script>');return;}
  if(req.url==='/fixture-sw.js'){res.setHeader('Content-Type','text/javascript');res.end('self.addEventListener("install",e=>e.waitUntil(caches.open("workspace-store-fixture-v1").then(c=>c.addAll(["/fixture.html","/workspace-store.js","/workspace-session.js","/peer-crypto.js","/profile-display.js","/chat-access.js"])).then(()=>self.skipWaiting())));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));');return;}
  if(req.url==='/legacy-chat-store.js'){res.setHeader('Content-Type','text/javascript');res.end(legacy);return;}
  try{const target=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname);assert(target.startsWith(publicRoot+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(target));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 async function page(){const p=await context.newPage();await p.goto(base+'/fixture.html');await p.waitForFunction(()=>window.fixtureReady);return p;}
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});const p=await page();
  const initial=await p.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),legacy=await import('/legacy-chat-store.js');
   await legacy.updateState(state=>{state.identity=null;state.contacts=[{id:'kept-contact'}];state.messages=[{packet:{id:'kept-message'}}];state.unknown={retained:true};});
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js');window.lease=await m.initializeWorkspaces();window.store=await createWorkspaceStore(window.lease);
   const identity=await createIdentity('Profile A'),result=await window.store.updateState(state=>{state.identity=identity;state.preference='A';return 'saved';});
   const state=await window.store.readState();return {name:state.identity.profile.name,preference:state.preference,contacts:state.contacts,messages:state.messages,unknown:state.unknown,result};
  });
  assert.deepEqual(initial,{name:'Profile A',preference:'A',contacts:[{id:'kept-contact'}],messages:[{packet:{id:'kept-message'}}],unknown:{retained:true},result:'saved'});pass('bound storage preserves the singleton and saves profile creation through the current session');
  const backup=await p.evaluate(async()=>{
   window.backupEvents=0;addEventListener('lenz-account-changed',()=>window.backupEvents++);
   await store.updateState(state=>{state.accountSync={version:4,status:'saved'};},{markBackup:false});
   await store.updateState(state=>{state.preference='A-hidden';});const unchanged=await store.readState();
   await store.updateState(state=>{state.contacts.push({id:'second-contact'});});const changed=await store.readState();
   await store.updateState(state=>{state.accountSync.status='conflict';},{markBackup:false});
   await store.updateState(state=>{state.privateSpendBox={retained:'approval'};});const conflict=await store.readState();
   await store.updateState(state=>{state.contacts.push({id:'quiet-contact'});},{markBackup:false});const quiet=await store.readState();
   return {unchanged:unchanged.accountSync,changed:changed.accountSync,conflict:conflict.accountSync,quiet:quiet.accountSync,events:backupEvents};
  });
  assert.deepEqual(backup,{unchanged:{version:4,status:'saved'},changed:{version:5,status:'pending'},conflict:{version:6,status:'conflict'},quiet:{version:6,status:'conflict'},events:2});pass('backup content changes retain conflict status and notify only after a successful dirty save');
  const other=await page();await other.evaluate(async()=>{const m=await import('/workspace-session.js');window.store=await(await import('/workspace-store.js')).createWorkspaceStore(await m.workspaceSession());});
  await Promise.all([p.evaluate(()=>Promise.all(Array.from({length:8},()=>store.updateState(state=>{state.counter=(state.counter??0)+1;state.fromA=true;})))),other.evaluate(()=>Promise.all(Array.from({length:8},()=>store.updateState(state=>{state.counter=(state.counter??0)+1;state.fromB=true;}))))]);
  assert.deepEqual(await p.evaluate(async()=>{const state=await store.readState();return {counter:state.counter,a:state.fromA,b:state.fromB};}),{counter:16,a:true,b:true});pass('simultaneous updates in two tabs preserve every increment and both changes');
  await p.evaluate(()=>{window.preparing=false;const pending=new Promise(resolve=>window.releasePreparation=resolve);window.lateSave=store.updateState(async state=>{window.preparing=true;await pending;state.late='must not persist';return 'must not escape';}).then(value=>({value}),error=>({error:error.message}));});
  await p.waitForFunction(()=>window.preparing);
  await other.evaluate(async()=>{const m=await import('/workspace-session.js'),lease=await m.workspaceSession();window.aId=lease.workspaceId;const signedOut=await m.signOutWorkspace(lease);window.reopened=await m.activateWorkspace(lease.workspaceId,signedOut);store.close();window.store=await(await import('/workspace-store.js')).createWorkspaceStore(window.reopened);});
  const stale=await p.evaluate(async()=>{releasePreparation();const save=await lateSave;let read=false,locked=false;try{await store.readState();}catch{read=true;}try{await store.readStateLocked(()=>{throw Error('should not run');});}catch{locked=true;}return {save,read,locked};});
  assert.match(stale.save.error,/Workspace access changed/);assert(stale.read&&stale.locked);assert.equal(await other.evaluate(async()=>Object.hasOwn(await store.readState(),'late')),false);pass('sign-out finishes during async preparation and same-profile reopening rejects the old callback and readers');
  await p.evaluate(async()=>{const m=await import('/workspace-session.js');window.store=await(await import('/workspace-store.js')).createWorkspaceStore(await m.workspaceSession());});
  const partition=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js'),{createIdentity}=await import('/peer-crypto.js'),{createWorkspaceStore}=await import('/workspace-store.js'),a=await m.workspaceSession();
   const id=await m.stageWorkspace({identity:await createIdentity('Profile B'),contacts:[{id:'B-contact'}],messages:[],preference:'B'},a),b=await m.activateWorkspace(id,a),second=await createWorkspaceStore(b);
   await second.updateState(state=>{state.messages.push({packet:{id:'B-message'}});});const bState=await second.readState();
   window.reopenedA=await m.activateWorkspace(a.workspaceId,b);window.store=await createWorkspaceStore(reopenedA);const aState=await store.readState();
   let rejected=false;try{await second.updateState(state=>{state.preference='stale B';});}catch{rejected=true;}second.close();
   return {b:{name:bState.identity.profile.name,contacts:bState.contacts,messages:bState.messages,preference:bState.preference,hasA:Object.hasOwn(bState,'counter')},a:{name:aState.identity.profile.name,preference:aState.preference,counter:aState.counter,hasB:aState.messages.some(x=>x.packet.id==='B-message')},rejected};
  });
  assert.deepEqual(partition,{b:{name:'Profile B',contacts:[{id:'B-contact'}],messages:[{packet:{id:'B-message'}}],preference:'B',hasA:false},a:{name:'Profile A',preference:'A-hidden',counter:16,hasB:false},rejected:true});pass('switching isolates two profiles and reopening restores each profile through its own store');
  const forged=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),lease={...await m.workspaceSession()},bound=await createWorkspaceStore(lease),id=bound.workspaceId,b=(await m.listWorkspaces()).find(row=>row.name==='Profile B'),next=await m.activateWorkspace(b.id,lease);
   lease.workspaceId=next.workspaceId;lease.generation=next.generation;let rejected=false;try{await bound.readState();}catch{rejected=true;}
   const restored=await m.activateWorkspace(id,next);window.store=await createWorkspaceStore(restored);return {rejected,captured:bound.workspaceId===id,frozen:Object.isFrozen(bound),name:(await store.readState()).identity.profile.name};
  });
  assert.deepEqual(forged,{rejected:true,captured:true,frozen:true,name:'Profile A'});pass('mutating the supplied lease cannot redirect a captured adapter into another profile');
  const corrupt=await p.evaluate(async()=>{
   const original=await store.readState(),{createIdentity}=await import('/peer-crypto.js'),replacement=await createIdentity('Replacement');let identity=false,access=false,shape=false;
   try{await store.updateState(state=>{state.identity=replacement;});}catch{identity=true;}
   try{await store.updateState(state=>{state.identity.access='lenz/recovered-chat/v1';});}catch{access=true;}
   try{await store.updateState(state=>{state.contacts=null;});}catch{shape=true;}
   const retained=await store.readState();return {identity,access,shape,id:retained.identity.profile.id===original.identity.profile.id,accessSame:retained.identity.access===original.identity.access,contacts:retained.contacts};
  });
  assert.deepEqual(corrupt,{identity:true,access:true,shape:true,id:true,accessSame:true,contacts:[{id:'kept-contact'},{id:'second-contact'},{id:'quiet-contact'}]});pass('changed identity, recovered access and invalid state reject without replacing the retained profile');
  const interrupted=await p.evaluate(async()=>{
   const m=await import('/workspace-session.js'),lease=await m.workspaceSession(),before=await m.readWorkspace(lease),events=backupEvents,controller=new AbortController(),put=IDBObjectStore.prototype.put;let reached=false,rejected=false;
   IDBObjectStore.prototype.put=function(value,...args){const result=put.call(this,value,...args);if(this.name==='workspaces'&&value.state.abortSave){reached=true;controller.abort(Error('Cancelled stored change'));}return result;};
   try{await store.updateState(state=>{state.abortSave=true;state.contacts.push({id:'aborted-contact'});},{signal:controller.signal});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   const after=await m.readWorkspace(lease);return {reached,rejected,revision:before.revision===after.revision,leaked:Object.hasOwn(after.state,'abortSave'),contacts:after.state.contacts.length,backup:after.state.accountSync,events:backupEvents-events};
  });
  assert.deepEqual(interrupted,{reached:true,rejected:true,revision:true,leaked:false,contacts:3,backup:{version:6,status:'conflict'},events:0});pass('cancellation after the actual put aborts profile and backup changes without emitting a saved notification');
  await p.evaluate(()=>{window.preparing=false;const pending=new Promise(resolve=>window.releaseOld=resolve);window.oldWork=store.updateState(async state=>{window.preparing=true;await pending;state.abandoned='old';}).then(()=>false,()=>true);});
  await p.waitForFunction(()=>window.preparing);
  const resumed=await other.evaluate(async()=>{
   const m=await import('/workspace-session.js'),lease=await m.workspaceSession(),signedOut=await m.signOutWorkspace(lease),next=await m.activateWorkspace(lease.workspaceId,signedOut);window.store=await(await import('/workspace-store.js')).createWorkspaceStore(next);
   window.newWork=store.updateState(state=>{state.afterReopen='new';});return Promise.race([newWork.then(()=>'saved'),new Promise(resolve=>setTimeout(()=>resolve('blocked'),1000))]);
  });
  const abandoned=await p.evaluate(async()=>{releaseOld();return oldWork;});await other.evaluate(()=>newWork);assert.equal(resumed,'saved');assert.equal(abandoned,true);
  assert.deepEqual(await other.evaluate(async()=>{const state=await store.readState();return {afterReopen:state.afterReopen,hasOld:Object.hasOwn(state,'abandoned')};}),{afterReopen:'new',hasOld:false});pass('reopening can save while an abandoned callback is still pending and its later completion stays discarded');
  const locked=await other.evaluate(async()=>{
   const controller=new AbortController();let entered=false,release;const waiting=new Promise(resolve=>release=resolve);
   const result=store.readStateLocked(async(state,{signal})=>{entered=true;await waiting;return {name:state.identity.profile.name,signal:signal.aborted};},{signal:controller.signal}).then(value=>({value}),error=>({error:error.message}));
   while(!entered)await new Promise(resolve=>setTimeout(resolve,0));controller.abort(Error('Closed dependent read'));release();
   return {result:await result,current:(await store.readState()).identity.profile.name};
  });
  assert.deepEqual(locked,{result:{error:'Closed dependent read'},current:'Profile A'});pass('a cancelled dependent-storage callback cannot return its captured private result');
  const queued=await other.evaluate(async()=>{
   let entered=false,release,called=false;const waiting=new Promise(resolve=>release=resolve),first=store.updateState(async state=>{entered=true;await waiting;state.queueFirst=true;});
   while(!entered)await new Promise(resolve=>setTimeout(resolve,0));const controller=new AbortController(),second=store.updateState(state=>{called=true;state.queueSecond=true;},{signal:controller.signal}).then(()=>false,()=>true);
   controller.abort();release();await first;const rejected=await second,state=await store.readState();return {called,rejected,first:state.queueFirst,second:Object.hasOwn(state,'queueSecond')};
  });
  assert.deepEqual(queued,{called:false,rejected:true,first:true,second:false});pass('cancelling a queued update never invokes its callback or changes the profile');
  const closed=await other.evaluate(async()=>{
   let entered=false,release;const waiting=new Promise(resolve=>release=resolve),old=store.updateState(async state=>{entered=true;await waiting;state.afterClose='forbidden';}).then(()=>false,()=>true);
   while(!entered)await new Promise(resolve=>setTimeout(resolve,0));store.close();const rejected=await old;release();let read=false;try{await store.readState();}catch{read=true;}
   const m=await import('/workspace-session.js');window.store=await(await import('/workspace-store.js')).createWorkspaceStore(await m.workspaceSession());await store.updateState(state=>{state.newPage=true;});
   return {rejected,read,old:Object.hasOwn(await store.readState(),'afterClose')};
  });
  assert.deepEqual(closed,{rejected:true,read:true,old:false});pass('closing a page adapter discards preparation and requires a fresh adapter for future access');
  await other.evaluate(()=>{store.signal.addEventListener('abort',()=>sessionStorage.setItem('store-pagehide','closed'),{once:true});});await other.goto(base+'/fixture.html');await other.waitForFunction(()=>window.fixtureReady);
  assert.equal(await other.evaluate(()=>sessionStorage.getItem('store-pagehide')),'closed');pass('actual page navigation closes its adapter without deleting the retained profile');
  const signedOut=await other.evaluate(async()=>{const m=await import('/workspace-session.js');const lease=await m.workspaceSession();await m.signOutWorkspace(lease);return lease.workspaceId;});
  await context.close();context=null;await new Promise(resolve=>server.close(resolve));serverStopped=true;
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,offline:true});const restarted=await page();
  const offline=await restarted.evaluate(async id=>{
   const m=await import('/workspace-session.js'),{createWorkspaceStore}=await import('/workspace-store.js'),lease=await m.workspaceSession();let denied=false;try{await createWorkspaceStore(lease);}catch{denied=true;}
   const reopened=await m.activateWorkspace(id,lease),store=await createWorkspaceStore(reopened),a=await store.readState(),rows=await m.listWorkspaces(),b=rows.find(row=>row.name==='Profile B'),bLease=await m.activateWorkspace(b.id,reopened),second=await createWorkspaceStore(bLease),bState=await second.readState();
   return {signedOut:lease.workspaceId===null,denied,a:{name:a.identity.profile.name,counter:a.counter,contacts:a.contacts.length,message:a.messages[0].packet.id,afterReopen:a.afterReopen},b:{name:bState.identity.profile.name,contact:bState.contacts[0].id,message:bState.messages[0].packet.id}};
  },signedOut);
  assert.deepEqual(offline,{signedOut:true,denied:true,a:{name:'Profile A',counter:16,contacts:3,message:'kept-message',afterReopen:'new'},b:{name:'Profile B',contact:'B-contact',message:'B-message'}});pass('full browser and fixture-server shutdown retains signed-out access and separate profiles offline');
  await fs.writeFile(path.join(report,'results.json'),JSON.stringify({passed:checks.length,checks},null,2));
 }catch(error){await fs.writeFile(path.join(report,'failure.json'),JSON.stringify({passed:checks.length,checks,error:error.stack},null,2));throw error;}
 finally{await context?.close();if(!serverStopped)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
