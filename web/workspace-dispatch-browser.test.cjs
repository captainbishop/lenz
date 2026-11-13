const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

(async()=>{
 const root=path.resolve(__dirname,'public'),checks=[];
 const server=http.createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Workspace dispatch fixture</title>');return;}
  try{const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext(),page=await context.newPage(),other=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
 const pass=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  await page.goto(base+'/fixture.html');await other.goto(base+'/fixture.html');
  await page.evaluate(async()=>{window.m=await import('/workspace-session.js');window.lease=await m.initializeWorkspaces();window.d=await import('/workspace-dispatch.js');});
  const ordinary=await page.evaluate(async()=>{
   const mutable={...lease},sender=await d.createWorkspaceDispatcher(mutable),input={method:'eth_accounts',params:['original']};let invoked=false;
   mutable.workspaceId='another-workspace';mutable.generation='0'.repeat(32);
   const result=sender.request({request(request){invoked=true;return request.params;}},input);input.params[0]='changed';
   const value=await result;sender.close();return {value,invoked,closed:sender.signal.aborted};
  });
  assert.deepEqual(ordinary,{value:['original'],invoked:true,closed:true});pass('request snapshots preserve reviewed input and close ends dispatch access');

  await page.evaluate(async()=>{
   window.rawLease={...lease};window.sender=await d.createWorkspaceDispatcher(rawLease);window.calls=0;window.promptSettled=false;window.releasePrompt=null;
   const pending=new Promise(resolve=>window.releasePrompt=resolve);
   window.response=sender.request({request(){calls++;return pending;}},{method:'personal_sign',params:['reviewed']}).then(()=>({accepted:true}),error=>({accepted:false,message:error.message})).finally(()=>window.promptSettled=true);
  });
  await page.waitForFunction(()=>window.calls===1);
  const next=await other.evaluate(async()=>{const m=await import('/workspace-session.js'),old=await m.workspaceSession(),out=await m.signOutWorkspace(old);return m.activateWorkspace(old.workspaceId,out);});
  await page.waitForFunction(()=>window.sender.signal.aborted);
  assert.equal(await page.evaluate(()=>window.promptSettled),false);
  const late=await page.evaluate(async next=>{Object.assign(rawLease,next);releasePrompt('late-signature');const value=await response;let more=0;try{await sender.request({request(){more++;return [];}},{method:'eth_accounts'});}catch{}return {value,more};},next);
  assert.equal(late.value.accepted,false);assert.equal(late.more,0);pass('sign-out finishes during a prompt, preserves its lifetime and rejects a late signature after same-profile reopen');

  const cancelled=await page.evaluate(async()=>{
   const sender=await d.createWorkspaceDispatcher(await m.workspaceSession()),controller=new AbortController();controller.abort(Error('Request cancelled'));let calls=0,rejected=false;
   try{await sender.dispatch(()=>{calls++;},{signal:controller.signal});}catch{rejected=true;}
   sender.close();return {calls,rejected};
  });
  assert.deepEqual(cancelled,{calls:0,rejected:true});pass('cancelled requests never invoke their provider');

  await page.evaluate(async()=>{
   const owner=new AbortController(),s=await d.createWorkspaceDispatcher(await m.workspaceSession(),{signal:owner.signal});
   window.invocationFinished=false;window.invocationStarted=false;window.finishInvocation=null;
   window.invocation=s.dispatch(()=>{invocationStarted=true;owner.abort();return new Promise(resolve=>window.finishInvocation=resolve);}).then(()=>false,()=>true).finally(()=>window.invocationFinished=true);
  });
  await page.waitForFunction(()=>window.invocationStarted);
  assert.equal(await page.evaluate(()=>window.invocationFinished),false);
  assert.equal(await page.evaluate(async()=>{finishInvocation('cancelled signature');return invocation;}),true);
  pass('cancellation inside invocation keeps the actual prompt pending until its provider settles');

  await page.evaluate(async()=>{
   const s=await d.createWorkspaceDispatcher(await m.workspaceSession()),original=IDBDatabase.prototype.transaction;
   window.failureFinished=false;window.failureStarted=false;window.finishFailure=null;
   window.afterDispatchFailure=s.dispatch(()=>{
    failureStarted=true;IDBDatabase.prototype.transaction=function(){IDBDatabase.prototype.transaction=original;throw Error('Storage interrupted after dispatch');};
    return new Promise(resolve=>window.finishFailure=resolve);
   }).then(()=>false,error=>error.message).finally(()=>{IDBDatabase.prototype.transaction=original;window.failureFinished=true;s.close();});
  });
  await page.waitForFunction(()=>window.failureStarted);
  assert.equal(await page.evaluate(()=>window.failureFinished),false);
  assert.equal(await page.evaluate(async()=>{finishFailure('late-signature');return afterDispatchFailure;}),'Storage interrupted after dispatch');
  pass('storage failure after invocation preserves the actual prompt lifetime and rejects its result');

  await page.evaluate(async()=>{window.racingLease=await m.workspaceSession();window.racingSender=await d.createWorkspaceDispatcher(racingLease);});
  await other.evaluate(()=>{window.fenceHeld=false;window.unlock=null;window.fence=navigator.locks.request('proof-u-private-chat-v1',async()=>{window.fenceHeld=true;await new Promise(resolve=>window.unlock=resolve);});});
  await other.waitForFunction(()=>window.fenceHeld);
  await other.evaluate(async lease=>{const m=await import('/workspace-session.js');window.transition=m.signOutWorkspace(lease);},await page.evaluate(()=>window.racingLease));
  await page.evaluate(()=>{window.staleCalls=0;window.race=racingSender.dispatch(()=>{staleCalls++;}).then(()=>false,()=>true);});
  await other.evaluate(()=>window.unlock());
  assert.equal(await page.evaluate(()=>window.race),true);assert.equal(await page.evaluate(()=>window.staleCalls),0);
  await other.evaluate(async()=>{const m=await import('/workspace-session.js');await m.activateWorkspace('legacy',await window.transition);});
  pass('sign-out queued before invocation prevents provider dispatch through the durable fence');

  const stop=await page.evaluate(async()=>{
   const owner=new AbortController(),s=await d.createWorkspaceDispatcher(await m.workspaceSession(),{signal:owner.signal});let reply;
   const value=s.dispatch(()=>new Promise((resolve,reject)=>{reply=resolve;s.signal.addEventListener('abort',()=>reject(Error('Request aborted')),{once:true});})).then(()=>false,()=>true);
   while(!reply)await new Promise(resolve=>setTimeout(resolve,0));owner.abort();const rejected=await value;return {rejected,closed:s.signal.aborted};
  });
  assert.deepEqual(stop,{rejected:true,closed:true});pass('owning lifecycle cancellation closes dispatch and reaches abortable work');

  const failure=await page.evaluate(async()=>{
   const s=await d.createWorkspaceDispatcher(await m.workspaceSession());let thrown=false,rejected=false;
   try{await s.dispatch(()=>{throw Error('Synchronous provider failure');});}catch(e){thrown=e.message==='Synchronous provider failure';}
   try{await s.dispatch(()=>Promise.reject(Error('Rejected provider request')));}catch(e){rejected=e.message==='Rejected provider request';}
   const out=await m.signOutWorkspace(await m.workspaceSession());await m.activateWorkspace('legacy',out);s.close();return {thrown,rejected};
  });
  assert.deepEqual(failure,{thrown:true,rejected:true});pass('synchronous and asynchronous request failures release the session fence');
  console.log(JSON.stringify({passed:checks.length,checks}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
