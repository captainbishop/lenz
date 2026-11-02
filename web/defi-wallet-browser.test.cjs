// Disposable Edge stores, real IndexedDB/Web Locks/WebCrypto; no financial endpoint.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {securityHeaders}=require('./security-policy.mjs');
const modules=['defi-wallet.js','chat-store.js','peer-crypto.js','profile-display.js','near-protocol.js','rhea-protocol.js','near-deposit.js','defi-request.js'];
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
