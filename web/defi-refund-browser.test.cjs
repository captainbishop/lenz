// Disposable browser storage and synthetic final chain observations. No real funds or signatures in an external wallet.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function run({filter,overrides={}}={}){
  const results=[],browser=await chromium.launch({channel:'msedge',headless:true});
  const server=http.createServer(async(req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
    res.setHeader('Cache-Control','no-store');
    if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable refund test</title>');return;}
    if(/^\/[a-z0-9-]+\.js$/.test(file)){res.setHeader('Content-Type','text/javascript');res.end(overrides[file.slice(1)]??await fs.readFile(path.join(__dirname,'public',file.slice(1))));return;}
    res.writeHead(403);res.end();
  });
  async function boot(page){
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(async c=>{
      Object.assign(window,{c,store:await import('/chat-store.js'),n:await import('/near-protocol.js'),p:await import('/peer-crypto.js'),w:await import('/defi-wallet.js')});
      window.snapshot=async()=>{const s=await store.readState(),vault=await n.readNearVault(s,c.reserve),l=await n.nearLedger(vault);return {owner:s.identity.profile.id,vault,reserved:[...l.reserved],available:l.available.filter(x=>x.owner===n.compressed(s.identity.profile.signingPublic)).reduce((sum,x)=>sum+BigInt(x.amount),0n).toString()};};
      window.rejects=async fn=>{try{await fn();return false;}catch{return true;}};
      window.requests=[];window.reply=null;window.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return Response.json(reply);};
    },config);
  }
  async function check(name,fn){
    if(filter&&!name.startsWith(filter))return;
    const context=await browser.newContext(),page=await context.newPage();
    try{
      await boot(page);
      await page.evaluate(async()=>{
        window.executor=await p.createIdentity('Executor');
        await store.updateState(async s=>{s.identity=await p.createIdentity('Owner');s.contacts=[executor.profile];const v=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'10');v.roots.push({id:f.id,owner:f.owner,amount:f.amount});await n.saveNearVault(s,v);});
        window.ref=await w.approveDefiSwap(c,executor.profile,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:Date.now()+600000},{approvalId:'a'.repeat(32),disclosure:'lenz/disclosure/public-near-executor/v1',expiresAt:Date.now()+600000});
        const entry=(await snapshot()).vault.rheaOrders[0];
        window.finalOrder={id:entry.packet.id,instruction:entry.packet.instruction,stage:'refunded',output:'0',reason:''};
        window.finalRefund=async()=>{reply={requestId:ref.requestId,state:'observed',observation:{finality:'FINAL',block:{height:10,hash:'4'.repeat(32)},order:finalOrder}};await w.checkDefiSwap(c,ref.requestId);};
        window.backedReply=deposit=>({requestId:ref.requestId,depositId:deposit.id,state:'observed',observation:{finality:'FINAL',block:{height:20,hash:'5'.repeat(32)},order:finalOrder,deposit:{root:{id:deposit.id,owner:deposit.owner,amount:deposit.amount},spent:null}}});
      });
      await fn({page,context,boot});results.push({name,pass:true});console.log('PASS '+name);
    }catch(e){e.message=name+': '+e.message;throw e;}finally{await context.close();}
  }
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await check('refund preparation requires independent final evidence and persists one stable request after expiry and reload',async({page,boot})=>{
      const first=await page.evaluate(async()=>{
        const before=await snapshot(),unobserved=await rejects(()=>w.prepareDefiRefund(c,ref.requestId));
        const report=await p.sealMessage(executor,(await store.readState()).identity.profile,{type:'lenz/defi-observation/v1',requestId:ref.requestId,checkedAt:Date.now(),state:'observed',observation:{claimed:'refunded'},transaction:null});
        await w.recordDefiReply(c,ref.requestId,report);const claimed=await rejects(()=>w.prepareDefiRefund(c,ref.requestId));
        await finalRefund();const clock=Date.now;Date.now=()=>clock()+86400000;
        try{const deposit=await w.prepareDefiRefund(c,ref.requestId);return {before,unobserved,claimed,ref,deposit,after:await snapshot()};}finally{Date.now=clock;}
      });
      assert(first.unobserved);assert(first.claimed);assert.equal(first.deposit.amount,'4000000');assert.equal(first.deposit.payer,'receiver.testnet');assert.equal(first.after.available,'6000000');assert.deepEqual(first.after.reserved,first.before.reserved);
      await boot(page);const next=await page.evaluate(async({ref})=>({deposit:await w.prepareDefiRefund(c,ref.requestId),after:await snapshot()}),first);
      assert.deepEqual(next.deposit,first.deposit);assert.deepEqual(next.after,first.after);
    });
    await check('final returned roots credit once while duplicate checks retain the reservation and later offline spend',async({page,boot})=>{
      const first=await page.evaluate(async()=>{
        await finalRefund();const deposit=await w.prepareDefiRefund(c,ref.requestId),before=await snapshot();reply=backedReply(deposit);
        const result=await w.checkDefiRefund(c,ref.requestId),returned=await snapshot();
        await store.updateState(async s=>{const v=await n.readNearVault(s,c.reserve);const next=await n.makeNearPayment(v,s.identity,executor.profile,'3');await n.saveNearVault(s,next.vault);});
        const spent=await snapshot();await w.checkDefiRefund(c,ref.requestId);return {deposit,ref,reply,before,result,returned,spent,after:await snapshot(),requests};
      });
      assert.equal(first.result.state,'observed');assert.equal(first.returned.available,'10000000');assert.equal(first.spent.available,'7000000');assert.equal(first.after.available,'7000000');assert.deepEqual(first.after.vault.spends,first.spent.vault.spends);assert.deepEqual(first.after.reserved,first.before.reserved);
      assert.equal(first.requests.at(-1).url,'/api/defi/rhea/refund-status');assert.deepEqual(first.requests.at(-1).body.deposit,first.deposit);
      assert.equal(first.requests.at(-1).body.sender.name,'Sender');
      await boot(page);const after=await page.evaluate(async x=>{reply=x.reply;await w.checkDefiRefund(c,x.ref.requestId);return snapshot();},first);assert.equal(after.available,'7000000');assert.deepEqual(after.vault.spends,first.spent.vault.spends);
    });
    await check('invalid or regressed return observations cannot credit or replace saved evidence',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();const deposit=await w.prepareDefiRefund(c,ref.requestId),before=await snapshot(),good=backedReply(deposit),rejected=[];
        for(const change of [r=>r.requestId='a'.repeat(64),r=>r.depositId='root:'+'a'.repeat(64),r=>r.observation.finality='OPTIMISTIC',r=>r.observation.order.instruction.receiver_id='other.testnet',r=>r.observation.deposit.root.amount='4000001',r=>r.observation.deposit.root.owner='02'+'a'.repeat(64),r=>r.observation.deposit.root.id='root:'+'a'.repeat(64),r=>delete r.observation.deposit.spent,r=>r.observation.block.height=9]){
          reply=structuredClone(good);change(reply);rejected.push(await rejects(()=>w.checkDefiRefund(c,ref.requestId)));
        }
        const invalid=await snapshot();reply=good;await w.checkDefiRefund(c,ref.requestId);const backed=await snapshot();
        for(const change of [r=>r.observation.block.height=19,r=>r.observation.block.hash='6'.repeat(32),r=>{r.state='ready';r.observation.deposit=null;r.observation.block.height=21;}]){
          reply=structuredClone(good);change(reply);rejected.push(await rejects(()=>w.checkDefiRefund(c,ref.requestId)));
        }return {before,invalid,backed,after:await snapshot(),rejected};
      });assert(result.rejected.every(Boolean));assert.equal(result.rejected.length,12);assert.deepEqual(result.invalid,result.before);assert.deepEqual(result.after,result.backed);
    });
    await check('known return consumption is never downgraded and an unbacked request adds no balance',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();const deposit=await w.prepareDefiRefund(c,ref.requestId);reply=backedReply(deposit);reply.state='ready';reply.observation.deposit=null;
        await w.checkDefiRefund(c,ref.requestId);const pending=await snapshot();
        reply=backedReply(deposit);reply.observation.deposit.spent='a'.repeat(64);await w.checkDefiRefund(c,ref.requestId);const consumed=await snapshot();
        reply=backedReply(deposit);reply.observation.block.height=21;await w.checkDefiRefund(c,ref.requestId);const repeated=await snapshot();
        reply.observation.deposit.spent='b'.repeat(64);reply.observation.block.height=22;const conflict=await rejects(()=>w.checkDefiRefund(c,ref.requestId));
        return {pending,consumed,repeated,conflict,after:await snapshot(),id:deposit.id};
      });assert.equal(result.pending.available,'6000000');assert.equal(result.pending.vault.rheaOrders[0].returnReceipt,undefined);assert.equal(result.consumed.available,'6000000');assert.equal(result.repeated.available,'6000000');assert.equal(result.repeated.vault.chainConsumed[result.id],'a'.repeat(64));assert(result.conflict);assert.deepEqual(result.after,result.repeated);
    });
    await check('failed preparation or confirmation storage exposes no result and lost replies remain checkable',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();const before=await snapshot(),put=IDBObjectStore.prototype.put;
        const fail=()=>{IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};};
        let preparation,confirmation,exposed=null;fail();try{preparation=await rejects(async()=>{exposed=await w.prepareDefiRefund(c,ref.requestId);});}finally{IDBObjectStore.prototype.put=put;}
        const afterPrepare=await snapshot(),deposit=await w.prepareDefiRefund(c,ref.requestId),saved=await snapshot();reply=backedReply(deposit);
        fail();try{confirmation=await rejects(async()=>{exposed=await w.checkDefiRefund(c,ref.requestId);});}finally{IDBObjectStore.prototype.put=put;}
        const afterConfirm=await snapshot(),fetcher=fetch;window.fetch=async()=>{throw Error('lost reply');};const lost=await rejects(()=>w.checkDefiRefund(c,ref.requestId));window.fetch=fetcher;
        await w.checkDefiRefund(c,ref.requestId);return {preparation,confirmation,exposed,before,afterPrepare,saved,afterConfirm,lost,after:await snapshot()};
      });assert(result.preparation);assert(result.confirmation);assert.equal(result.exposed,null);assert.deepEqual(result.before,result.afterPrepare);assert.deepEqual(result.saved,result.afterConfirm);assert(result.lost);assert.equal(result.after.available,'10000000');
    });
    await check('late refund checks and commit cancellation cannot credit a changed account',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();const deposit=await w.prepareDefiRefund(c,ref.requestId);reply=backedReply(deposit);
        const controller=new AbortController(),put=IDBObjectStore.prototype.put,before=await snapshot();
        IDBObjectStore.prototype.put=function(...args){IDBObjectStore.prototype.put=put;controller.abort();return put.apply(this,args);};
        const aborted=await rejects(()=>w.checkDefiRefund(c,ref.requestId,{signal:controller.signal})),afterAbort=await snapshot();
        let started,release;const waiting=new Promise(r=>started=r),held=new Promise(r=>release=r);window.fetch=async()=>{started();await held;return Response.json(reply);};
        const pending=rejects(()=>w.checkDefiRefund(c,ref.requestId));await waiting;
        await store.updateState(async s=>{s.identity=await p.createIdentity('Other account');delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault(c.reserve));});
        const changed=await snapshot();release();return {aborted,before,afterAbort,changed,rejected:await pending,after:await snapshot()};
      });assert(result.aborted);assert.deepEqual(result.afterAbort,result.before);assert(result.rejected);assert.deepEqual(result.after,result.changed);
    });
    await check('external submission consumes a durable review before opening and never automatically repeats an ambiguous attempt',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();const first=await w.reviewDefiRefund(c,ref.requestId);let openings=0,submitted=0,durable=false;
        const signer={getAccounts:async()=>{openings++;const v=(await snapshot()).vault;durable=!!v.rheaOrders[0].defi.refundAttempt&&!v.rheaOrders[0].defi.refundReview;return [{accountId:'receiver.testnet'}];},signAndSendTransaction:async()=>{submitted++;throw Error('reply lost');}};
        const failed=await rejects(()=>w.submitDefiRefund(c,ref.requestId,first.review,{signer})),saved=await snapshot();
        const duplicate=await rejects(()=>w.submitDefiRefund(c,ref.requestId,first.review,{signer}));
        const next=await w.reviewDefiRefund(c,ref.requestId);const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};
        let disk;try{disk=await rejects(()=>w.submitDefiRefund(c,ref.requestId,next.review,{signer}));}finally{IDBObjectStore.prototype.put=put;}
        reply=backedReply(first.deposit);await w.checkDefiRefund(c,ref.requestId);
        return {failed,duplicate,disk,openings,submitted,durable,saved,after:await snapshot(),same:JSON.stringify(first.deposit)===JSON.stringify(next.deposit)};
      });assert(result.failed);assert(result.duplicate);assert(result.disk);assert.equal(result.openings,1);assert.equal(result.submitted,1);assert(result.durable);assert(result.same);assert.equal(result.saved.available,'6000000');assert.equal(result.after.available,'10000000');
    });
    await check('review expiry and account changes during external preparation block signing',async({page})=>{
      const result=await page.evaluate(async()=>{
        await finalRefund();let reviewed=await w.reviewDefiRefund(c,ref.requestId),submissions=0;
        const expired={...reviewed.review,expiresAt:Date.now()-1};const expiredRejected=await rejects(()=>w.submitDefiRefund(c,ref.requestId,expired,{signer:{getAccounts:()=>{throw Error('must not open');}}}));
        const change=async()=>store.updateState(async s=>{s.identity=await p.createIdentity('Changed during wallet preparation');delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault(c.reserve));});
        const accountChanged=await rejects(()=>w.submitDefiRefund(c,ref.requestId,reviewed.review,{signer:{getAccounts:async()=>{await change();return [{accountId:'receiver.testnet'}];},signAndSendTransaction:async()=>{submissions++;}}}));
        return {expiredRejected,accountChanged,submissions,after:await snapshot()};
      });assert(result.expiredRejected);assert(result.accountChanged);assert.equal(result.submissions,0);assert.equal(result.after.available,'0');
    });
    return {passed:results.length,results};
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
module.exports={run};
if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
