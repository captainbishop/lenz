// Disposable Edge stores, real IndexedDB/Web Locks/WebCrypto; no financial endpoint.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {securityHeaders}=require('./security-policy.mjs');
const modules=['defi-wallet.js','chat-store.js','peer-crypto.js','chat-access.js','profile-display.js','near-protocol.js','rhea-protocol.js','near-deposit.js','defi-request.js','carrier-protocol.js'];
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function run({walletSource,filter,record=true}={}){
  let browser,api=0;const results=[];
  const sources=Object.fromEntries(await Promise.all(modules.map(async f=>['/'+f,await fs.readFile(path.join(__dirname,'public',f),'utf8')])));
  if(walletSource!==undefined)sources['/defi-wallet.js']=walletSource;
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    for(const [k,v] of Object.entries(securityHeaders(file)))res.setHeader(k,v);
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'||file.startsWith('/api/')){api++;res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',file==='/'?'text/html':'text/javascript');
    if(file==='/'){res.end('<!doctype html><title>Disposable approval test</title>');return;}
    res.writeHead(Object.hasOwn(sources,file)?200:404);res.end(sources[file]??'');
  });
  async function boot(page,base){
    await page.goto(base);
    await page.evaluate(async config=>{
      window.c=config;window.store=await import('/chat-store.js');window.n=await import('/near-protocol.js');window.p=await import('/peer-crypto.js');window.d=await import('/defi-request.js');window.w=await import('/defi-wallet.js');
      window.swap={text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:Date.now()+3600000};
      window.consent={approvalId:'a'.repeat(32),disclosure:d.PUBLIC_TESTNET_DISCLOSURE,expiresAt:Date.now()+600000};
      window.snapshot=async()=>{const s=await store.readState(),v=await n.readNearVault(s,c.reserve),l=await n.nearLedger(v);return {profile:s.identity.profile,contacts:s.contacts,messages:s.messages,nearBox:s.nearBox,vault:v,reserved:[...l.reserved],available:l.available.reduce((sum,x)=>sum+BigInt(x.amount),0n).toString(),extractable:[s.identity.signingPrivate.extractable,s.identity.boxPrivate.extractable,s.nearKey.extractable]};};
    },config);
  }
  async function check(name,fn){
    if(filter&&!name.startsWith(filter))return;
    const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
    try{
      const base='http://127.0.0.1:'+server.address().port;await boot(a,base);await boot(b,base);
      await a.evaluate(async()=>{
        window.executor=await p.createIdentity('Selected executor');window.other=await p.createIdentity('Other executor');
        await store.updateState(async s=>{s.identity=await p.createIdentity('Wallet owner');s.contacts=[executor.profile];s.messages=[{kind:'fixture',text:'Keep this history'}];
          const v=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'10');v.roots.push({id:f.id,owner:f.owner,amount:f.amount});await n.saveNearVault(s,v);});
      });
      const shared=await a.evaluate(()=>({swap,consent,peer:executor.profile}));await b.evaluate(x=>{swap=x.swap;consent=x.consent;window.peer=x.peer;},shared);
      await fn({a,b,context,base,boot});results.push({name,pass:true});console.log('PASS '+name);
    }catch(e){e.message=name+': '+e.message;throw e;}finally{await context.close();}
  }
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});
    await check('a manually opened executor update is saved offline without credit or reservation release',async({a,context,base,boot})=>{
      const input=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot();
        const report={type:d.DEFI_OBSERVATION,requestId:ref.requestId,checkedAt:Date.now(),state:'observed',observation:{claimed:'complete'},transaction:null};
        return {ref,before,report,packet:await p.sealMessage(executor,before.profile,report)};
      });
      await context.setOffline(true);
      const result=await a.evaluate(async({ref,packet})=>{
        await w.recordDefiReply(c,ref.requestId,packet);const saved=await snapshot();
        await w.recordDefiReply(c,ref.requestId,packet);return {saved,duplicate:await snapshot()};
      },input);
      assert.deepEqual(result.saved,result.duplicate);assert.equal(result.saved.available,input.before.available);assert.deepEqual(result.saved.reserved,input.before.reserved);
      assert.deepEqual(result.saved.vault.rheaOrders[0].defi.executorUpdate.report,input.report);
      assert.equal(result.saved.vault.rheaOrders[0].status,null);assert.equal(result.saved.vault.rheaOrders[0].defi.checkedOutcome,undefined);
      await context.setOffline(false);await boot(a,base);assert.deepEqual((await a.evaluate(()=>snapshot())).vault,result.saved.vault);
    });
    await check('manual update import binds the selected swap and rolls back failed storage',async({a})=>{
      const result=await a.evaluate(async()=>{
        const first=await w.approveDefiSwap(c,executor.profile,swap,consent);
        const second=await w.approveDefiSwap(c,executor.profile,{...swap,text:'1'},{...consent,approvalId:'b'.repeat(32)});
        const before=await snapshot(),report={type:d.DEFI_OBSERVATION,requestId:second.requestId,checkedAt:Date.now(),state:'pending',observation:null,transaction:null};
        const packet=await p.sealMessage(executor,before.profile,report),rejected=[];
        for(const [id,file]of [[first.requestId,packet],[second.requestId,{...packet,signature:'0'.repeat(128)}]]){
          try{await w.recordDefiReply(c,id,file);rejected.push(false);}catch{rejected.push(true);}
        }
        const denied=await snapshot(),put=IDBObjectStore.prototype.put;let failed=false;
        IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Storage write failed');};
        try{await w.recordDefiReply(c,second.requestId,packet);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
        const rollback=await snapshot(),pending=w.recordDefiReply(c,second.requestId,packet);
        packet.from='f'.repeat(64);await pending;
        return {before,denied,rollback,rejected,failed,after:await snapshot(),report};
      });
      assert.deepEqual(result.rejected,[true,true]);assert(result.failed);assert.deepEqual(result.denied,result.before);assert.deepEqual(result.rollback,result.before);
      assert.equal(result.after.vault.rheaOrders[0].defi.executorUpdate,undefined);
      assert.deepEqual(result.after.vault.rheaOrders[1].defi.executorUpdate.report,result.report);
      assert.equal(result.after.available,result.before.available);assert.deepEqual(result.after.reserved,result.before.reserved);
    });
    await check('encrypted executor updates survive offline reload without claiming settlement',async({a,base,boot})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot();
        const report={type:'lenz/defi-observation/v1',requestId:ref.requestId,checkedAt:Date.now(),state:'observed',observation:{claimed:'complete'},transaction:null};
        const packet=await p.sealMessage(executor,before.profile,report);
        const accepted=await store.updateState(s=>w.acceptDefiReply(s,c,packet)),after=await snapshot();
        await store.updateState(s=>w.acceptDefiReply(s,c,packet));
        return {before,after,duplicate:await snapshot(),accepted,report};
      });
      assert.equal(result.accepted,true);assert.equal(result.after.available,result.before.available);assert.deepEqual(result.after.reserved,result.before.reserved);
      assert.equal(result.after.vault.rheaOrders[0].status,null);assert.equal(result.after.vault.rheaOrders[0].defi.checkedOutcome,undefined);
      assert.deepEqual(result.after.vault.rheaOrders[0].defi.executorUpdate.report,result.report);assert.deepEqual(result.after,result.duplicate);
      await boot(a,base);assert.deepEqual((await a.evaluate(()=>snapshot())).vault,result.after.vault);
    });
    await check('executor updates reject forgery and invalid timing and keep the newest authenticated evidence',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),created=before.vault.rheaOrders[0].defi.request.createdAt;
        const report={type:'lenz/defi-observation/v1',requestId:ref.requestId,checkedAt:created+10,state:'pending',observation:null,transaction:null};
        const accept=async(body,signer=executor)=>store.updateState(async s=>w.acceptDefiReply(s,c,await p.sealMessage(signer,before.profile,body)));
        const rejected=[];
        for(const [body,signer] of [[report,other],[{...report,requestId:'c'.repeat(64)},executor],[{...report,checkedAt:created-1},executor],[{...report,checkedAt:Date.now()+120000},executor],[{...report,state:'complete'},executor],[{...report,credit:'100'},executor]]){
          try{rejected.push(!await accept(body,signer));}catch{rejected.push(true);}
        }
        const invalid=await snapshot();await accept(report);const first=await snapshot();
        await accept({...report,checkedAt:created,state:'observed'});const older=await snapshot();
        try{await accept({...report,state:'observed'});rejected.push(false);}catch{rejected.push(true);}
        const conflict=await snapshot();await accept({...report,checkedAt:created+20,state:'unavailable'});
        const latest=await snapshot(),clock=Date.now;Date.now=()=>consent.expiresAt+1;
        try{await accept({...report,checkedAt:consent.expiresAt+1,state:'observed'});}finally{Date.now=clock;}
        return {rejected,before,invalid,first,older,conflict,latest,expired:await snapshot()};
      });
      assert.deepEqual(result.rejected,[true,true,true,true,true,true,true]);assert.deepEqual(result.before,result.invalid);
      assert.deepEqual(result.first,result.older);assert.deepEqual(result.first,result.conflict);
      assert.equal(result.latest.vault.rheaOrders[0].defi.executorUpdate.report.state,'unavailable');
      assert.equal(result.expired.vault.rheaOrders[0].defi.executorUpdate.report.state,'observed');
      assert.equal(result.expired.vault.rheaOrders[0].status,null);assert.equal(result.expired.vault.rheaOrders[0].defi.checkedOutcome,undefined);
      assert.equal(result.expired.available,result.before.available);assert.deepEqual(result.expired.reserved,result.before.reserved);
    });
    await check('failed executor update storage leaves the approval and balance unchanged',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot();
        const packet=await p.sealMessage(executor,before.profile,{type:'lenz/defi-observation/v1',requestId:ref.requestId,checkedAt:Date.now(),state:'pending',observation:null,transaction:null});
        const put=IDBObjectStore.prototype.put;let rejected=false;
        IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};
        try{await store.updateState(s=>w.acceptDefiReply(s,c,packet));}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
        return {before,after:await snapshot(),rejected};
      });assert(result.rejected);assert.deepEqual(result.before,result.after);
    });
    await check('independent swap checks persist completed outcomes offline without credit or reservation release',async({a,base,boot})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),order=before.vault.rheaOrders[0].packet;
        const original=window.fetch;let request;
        window.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return Response.json({requestId:ref.requestId,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:{id:order.id,instruction:order.instruction,stage:'complete',output:'100',reason:''}}});};
        try{return {before,result:await w.checkDefiSwap(c,ref.requestId),after:await snapshot(),request};}finally{window.fetch=original;}
      });
      assert.equal(result.result.state,'observed');assert.equal(result.after.available,result.before.available);assert.deepEqual(result.after.reserved,result.before.reserved);
      assert.equal(result.after.vault.rheaOrders[0].status?.stage,'complete');assert.equal(result.request.url,'/api/defi/rhea/status');
      assert.equal(result.request.body.request.id,result.after.vault.rheaOrders[0].defi.request.id);
      assert.equal(result.request.body.sender.name,'Sender');assert.equal(result.request.body.sender.photo,undefined);
      await boot(a,base);const after=await a.evaluate(()=>snapshot());assert.equal(after.vault.rheaOrders[0].defi.checkedOutcome?.state,'observed');
    });
    await check('swap checks reject mismatched, nonfinal and regressed results without replacing saved evidence',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),order=(await snapshot()).vault.rheaOrders[0].packet,original=window.fetch;
        const good={requestId:ref.requestId,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:{id:order.id,instruction:order.instruction,stage:'complete',output:'100',reason:''}}};
        let reply=good;window.fetch=async()=>Response.json(reply);const rejected=[];
        try {
          const initial=await snapshot();
          for(const change of [r=>r.requestId='a'.repeat(64),r=>r.observation.finality='OPTIMISTIC',r=>r.observation.order.instruction.receiver_id='other.testnet',r=>r.observation.order.output='99']){
            reply=structuredClone(good);change(reply);try{await w.checkDefiSwap(c,ref.requestId);rejected.push(false);}catch{rejected.push(true);}
          }
          const afterInvalid=await snapshot();if(rejected.some(value=>!value))return {rejected,initial,afterInvalid,before:null,after:null};
          reply=good;await w.checkDefiSwap(c,ref.requestId);const before=await snapshot();
          for(const change of [r=>r.observation.block.height=9,r=>r.observation.block.hash='5'.repeat(32),r=>{r.state='ready';r.observation.order=null;r.observation.block.height=11;}]){
            reply=structuredClone(good);change(reply);try{await w.checkDefiSwap(c,ref.requestId);rejected.push(false);}catch{rejected.push(true);}
          }
          return {rejected,initial,afterInvalid,before,after:await snapshot()};
        } finally {window.fetch=original;}
      });assert.deepEqual(result.rejected,[true,true,true,true,true,true,true]);assert.deepEqual(result.afterInvalid,result.initial);assert.deepEqual(result.after,result.before);
    });
    await check('late status replies cannot update a different active account',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),original=window.fetch;let started,release;
        const waiting=new Promise(r=>started=r),held=new Promise(r=>release=r);window.fetch=async()=>{started();await held;return Response.json({requestId:ref.requestId,state:'ready',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:null}});};
        try {
          const pending=w.checkDefiSwap(c,ref.requestId).then(()=>false,()=>true);await waiting;
          await store.updateState(async s=>{s.identity=await p.createIdentity('Different account');delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault(c.reserve));});
          const before=await snapshot();release();return {rejected:await pending,before,after:await snapshot()};
        } finally {release?.();window.fetch=original;}
      });assert(result.rejected);assert.deepEqual(result.after,result.before);
    });
    await check('failed status saves and offline checks preserve the saved wallet',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),original=window.fetch,put=IDBObjectStore.prototype.put;let calls=0,savedRejected=false,offlineRejected=false;
        window.fetch=async()=>{calls++;return Response.json({requestId:ref.requestId,state:'ready',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:null}});};
        try {
          IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};
          try{await w.checkDefiSwap(c,ref.requestId);}catch{savedRejected=true;}finally{IDBObjectStore.prototype.put=put;}
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          try{await w.checkDefiSwap(c,ref.requestId);}catch{offlineRejected=true;}
          return {savedRejected,offlineRejected,calls,before,after:await snapshot()};
        } finally {delete navigator.onLine;window.fetch=original;IDBObjectStore.prototype.put=put;}
      });assert(result.savedRejected);assert(result.offlineRejected);assert.equal(result.calls,1);assert.deepEqual(result.after,result.before);
    });
    await check('confirmed conflicts stop further handoffs without freeing the reserved input',async({a})=>{
      const result=await a.evaluate(async()=>{
        const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),original=window.fetch;let rejected=false;const regressions=[];
        window.fetch=async()=>Response.json({requestId:ref.requestId,state:'conflicted',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:null}});
        try {
          await w.checkDefiSwap(c,ref.requestId);
          for(const height of [10,11]){
            window.fetch=async()=>Response.json({requestId:ref.requestId,state:'ready',observation:{finality:'FINAL',block:{height,hash:'4'.repeat(32)},order:null}});
            try{await w.checkDefiSwap(c,ref.requestId);regressions.push(false);}catch{regressions.push(true);}
          }
          try{await w.defiHandoff(c,ref.requestId);}catch{rejected=true;}
          return {rejected,regressions,before,after:await snapshot(),sources:await w.defiCourierSources(await store.readState(),c)};
        } finally {window.fetch=original;}
      });assert(result.rejected);assert.deepEqual(result.regressions,[true,true]);assert.deepEqual(result.after.reserved,result.before.reserved);assert.equal(result.after.available,result.before.available);assert.equal(result.sources[0].sendable,false);
    });
    await check('atomic approval keeps identity, history and remaining change',async({a})=>{
      const result=await a.evaluate(async()=>{const before=await snapshot(),ref=await w.approveDefiSwap(c,executor.profile,swap,consent),after=await snapshot(),packet=await w.defiHandoff(c,ref.requestId),opened=await d.openDefiRequest(executor,before.profile,c,packet);return {before,after,ref,opened,encrypted:JSON.stringify((await store.readState())).includes('min_output')};});
      assert.equal(result.after.available,'6000000');assert.equal(result.after.reserved.length,1);assert.equal(result.opened.id,result.ref.requestId);assert.equal(result.opened.operation.packet.id,result.ref.orderId);
      assert.deepEqual(result.after.profile,result.before.profile);assert.deepEqual(result.after.contacts,result.before.contacts);assert.deepEqual(result.after.messages,result.before.messages);assert.deepEqual(result.after.extractable,[false,false,false]);assert.equal(result.encrypted,false);
    });
    await check('failed approval commit exposes no handoff and leaves the entire store unchanged',async({a})=>{
      const result=await a.evaluate(async()=>{const before=await snapshot(),original=IDBObjectStore.prototype.put;let rejected=false,exposed=null;
        IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('simulated disk failure');};
        try{exposed=await w.approveDefiSwap(c,executor.profile,swap,consent);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}
        return {before,after:await snapshot(),rejected,exposed};});assert(result.rejected);assert.equal(result.exposed,null);assert.deepEqual(result.after,result.before);
    });
    await check('repeated approval after reload reuses one reservation and exact ciphertext',async({a,base,boot})=>{
      const first=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent);return {ref,packet:await w.defiHandoff(c,ref.requestId),swap,consent,peer:executor.profile,before:await snapshot()};});
      await boot(a,base);const result=await a.evaluate(async x=>{const ref=await w.approveDefiSwap(c,x.peer,x.swap,x.consent);return {ref,packet:await w.defiHandoff(c,ref.requestId),after:await snapshot()};},first);
      assert.deepEqual(result.ref,first.ref);assert.deepEqual(result.packet,first.packet);assert.deepEqual(result.after,first.before);
    });
    await check('two tabs cannot reserve the same money and concurrent retries keep one approval',async({a,b})=>{
      await Promise.all([a.evaluate(()=>swap.text='10'),b.evaluate(()=>swap.text='10')]);
      const repeats=await Promise.all([a.evaluate(()=>w.approveDefiSwap(c,executor.profile,swap,consent)),b.evaluate(()=>w.approveDefiSwap(c,peer,swap,consent))]);assert.deepEqual(repeats[0],repeats[1]);
      const other=await b.evaluate(async()=>{try{await w.approveDefiSwap(c,peer,swap,{...consent,approvalId:'b'.repeat(32)});return false;}catch{return true;}});assert(other);
      const after=await a.evaluate(()=>snapshot());assert.equal(after.available,'0');assert.equal(after.vault.rheaOrders.length,1);assert.equal(after.reserved.length,1);
    });
    await check('changed approval terms and missing disclosure cannot replace a saved approval',async({a})=>{
      const result=await a.evaluate(async()=>{await w.approveDefiSwap(c,executor.profile,swap,consent);const before=await snapshot(),rejected=[];
        for(const [peer,terms,approval]of [[other.profile,swap,consent],[executor.profile,{...swap,minOutput:'101'},consent],[executor.profile,{...swap,receiver:'other.testnet'},consent],[executor.profile,swap,{...consent,disclosure:'private-only'}]]){
          try{await w.approveDefiSwap(c,peer,terms,approval);rejected.push(false);}catch{rejected.push(true);}}
        return {before,after:await snapshot(),rejected};});assert.deepEqual(result.rejected,[true,true,true,true]);assert.deepEqual(result.after,result.before);
    });
    await check('approval snapshots caller inputs before awaiting storage or signing',async({a})=>{
      const result=await a.evaluate(async()=>{const terms={...swap},chosen={...executor.profile},approved={...consent},pending=w.approveDefiSwap(c,chosen,terms,approved);
        terms.text='9';terms.receiver='other.testnet';chosen.name='Changed';approved.expiresAt=Date.now()-1;
        const ref=await pending,after=await snapshot();return {ref,after};});
      assert.equal(result.after.available,'6000000');assert.equal(result.after.vault.rheaOrders[0].packet.instruction.receiver_id,'receiver.testnet');
    });
    await check('expiry during encryption does not save a new approval or stranded reservation',async({a})=>{
      const result=await a.evaluate(async()=>{const before=await snapshot(),encrypt=crypto.subtle.encrypt.bind(crypto.subtle),clock=Date.now;let rejected=false;
        crypto.subtle.encrypt=async(...args)=>{const result=await encrypt(...args);Date.now=()=>consent.expiresAt;return result;};
        try{await w.approveDefiSwap(c,executor.profile,swap,consent);}catch{rejected=true;}finally{crypto.subtle.encrypt=encrypt;Date.now=clock;}
        return {rejected,before,after:await snapshot()};});assert(result.rejected);assert.deepEqual(result.after,result.before);
    });
    await check('offline approval and expired handoff retain the signed reservation',async({a,context})=>{
      await context.setOffline(true);
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),packet=await w.defiHandoff(c,ref.requestId),before=await snapshot(),clock=Date.now;let rejected=false,repeated;
        Date.now=()=>consent.expiresAt;
        try{try{await w.defiHandoff(c,ref.requestId);}catch{rejected=true;}repeated=await w.approveDefiSwap(c,executor.profile,swap,consent);}finally{Date.now=clock;}
        return {ref,packet,rejected,repeated,before,after:await snapshot()};});assert(result.rejected);assert.deepEqual(result.ref,result.repeated);assert.deepEqual(result.before,result.after);
    });
    await check('storage receipts survive expiry but never credit, unlock or mark execution complete',async({a})=>{
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),receipt=await p.sealMessage(executor,before.profile,{type:d.DEFI_RECEIPT,requestId:ref.requestId,state:'stored',storedAt:Date.now()}),clock=Date.now;
        Date.now=()=>consent.expiresAt+1;try{await w.recordDefiStorageReceipt(c,ref.requestId,receipt);}finally{Date.now=clock;}
        const after=await snapshot();await w.recordDefiStorageReceipt(c,ref.requestId,receipt);return {before,after,duplicate:await snapshot()};});
      assert.deepEqual(result.after.reserved,result.before.reserved);assert.equal(result.after.available,result.before.available);assert.equal(result.after.vault.rheaOrders[0].status,null);assert.equal(result.after.vault.rheaOrders[0].defi.storageReceipt.state,'stored');assert.deepEqual(result.duplicate,result.after);
    });
    await check('forged, foreign, future and financial receipts leave stored approval untouched',async({a})=>{
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),body={type:d.DEFI_RECEIPT,requestId:ref.requestId,state:'stored',storedAt:Date.now()},rejected=[];
        for(const [signer,change]of [[other,{}],[executor,{requestId:'b'.repeat(64)}],[executor,{state:'observed'}],[executor,{storedAt:Date.now()+120000}]]){
          const packet=await p.sealMessage(signer,before.profile,{...body,...change});try{await w.recordDefiStorageReceipt(c,ref.requestId,packet);rejected.push(false);}catch{rejected.push(true);}}
        return {before,after:await snapshot(),rejected};});assert.deepEqual(result.rejected,[true,true,true,true]);assert.deepEqual(result.after,result.before);
    });
    await check('known input conflict and substituted saved packet prevent handoff',async({a})=>{
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent);let conflicted=false,substituted=false;
        await store.updateState(async s=>{const v=await n.readNearVault(s,c.reserve);v.chainConsumed={[v.rheaOrders[0].packet.instruction.input]:'b'.repeat(64)};await n.saveNearVault(s,v);});
        try{await w.defiHandoff(c,ref.requestId);}catch{conflicted=true;}
        await store.updateState(async s=>{const v=await n.readNearVault(s,c.reserve);delete v.chainConsumed;v.rheaOrders[0].defi.packet=await p.sealMessage(s.identity,executor.profile,{...v.rheaOrders[0].defi.request,id:'b'.repeat(64)});await n.saveNearVault(s,v);});
        try{await w.defiHandoff(c,ref.requestId);}catch{substituted=true;}return {conflicted,substituted};});assert(result.conflicted);assert(result.substituted);
    });
    await check('a replaced reservation or reversed saved envelope cannot be handed off',async({a})=>{
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),original=(await snapshot()).vault;let reservation=false,direction=false;
        await store.updateState(async s=>{const v=structuredClone(original);v.rheaOrders[0].packet.id='b'.repeat(64);await n.saveNearVault(s,v);});
        try{await w.defiHandoff(c,ref.requestId);}catch{reservation=true;}
        await store.updateState(async s=>{const v=structuredClone(original);v.rheaOrders[0].defi.packet=await p.sealMessage(executor,s.identity.profile,v.rheaOrders[0].defi.request);await n.saveNearVault(s,v);});
        try{await w.defiHandoff(c,ref.requestId);}catch{direction=true;}return {reservation,direction};});assert(result.reservation);assert(result.direction);
    });
    await check('failed handoff and receipt commits return no confirmation and preserve saved money',async({a})=>{
      const result=await a.evaluate(async()=>{const ref=await w.approveDefiSwap(c,executor.profile,swap,consent),before=await snapshot(),receipt=await p.sealMessage(executor,before.profile,{type:d.DEFI_RECEIPT,requestId:ref.requestId,state:'stored',storedAt:Date.now()}),original=IDBObjectStore.prototype.put;
        const rejected=[];IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('simulated disk failure');};
        try{for(const op of [()=>w.defiHandoff(c,ref.requestId),()=>w.recordDefiStorageReceipt(c,ref.requestId,receipt)]){try{await op();rejected.push(false);}catch{rejected.push(true);}}}finally{IDBObjectStore.prototype.put=original;}
        return {before,after:await snapshot(),rejected};});assert.deepEqual(result.rejected,[true,true]);assert.deepEqual(result.after,result.before);
    });
    assert.equal(api,0);assert(results.length>0);
    const sourceFiles={};for(const [file,source]of Object.entries(sources))sourceFiles['web/public'+file]=createHash('sha256').update(source).digest('hex');
    for(const file of ['web/defi-wallet-browser.test.cjs','web/security-policy.mjs'])sourceFiles[file]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex');
    const report={checkedAt:new Date().toISOString(),passed:results.length,failed:0,apiRequests:api,results,sourceFiles,scope:'Disposable Windows Edge, real IndexedDB/Web Locks/WebCrypto, synthetic funded roots and two same-origin tabs. No user identity, live chain transaction, transport activation or wallet credit.'};
    if(record)await fs.writeFile(path.join(__dirname,'defi-wallet-browser-results.json'),JSON.stringify(report,null,2)+'\n');return report;
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
module.exports={run};
if(require.main===module)run().then(r=>console.log(JSON.stringify({passed:r.passed,failed:r.failed}))).catch(e=>{console.error(e);process.exitCode=1;});
