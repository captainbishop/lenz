// Real encrypted HTTP mailboxes and browser storage; chain observations are fixtures.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {securityHeaders}=require('./security-policy.mjs');
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function run({filter,overrides={}}={}){
  const {createCarrier}=await import('../carrier/server.mjs'),p=await import('./public/peer-crypto.js'),cp=await import('./public/carrier-protocol.js');
  const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
  async function check(name,test){
    if(filter&&!name.startsWith(filter))return;
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-return-test-'));
    const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
    const origin='http://127.0.0.1:'+reservation.address().port;await new Promise(r=>reservation.close(r));
    const executor=await p.createIdentity('Executor'),context=await browser.newContext(),page=await context.newPage();
    const requests=[],errors=[],mailboxes=[];let carrier,reply,hold=null;
    const server=http.createServer(async(req,res)=>{
      try{
        const file=new URL(req.url,'http://localhost').pathname;
        for(const [k,v]of Object.entries(securityHeaders(file,[origin])))res.setHeader(k,v);
        res.setHeader('Cache-Control','no-store');
        if(file==='/api/defi/rhea/status'&&req.method==='POST'){
          let body='';for await(const chunk of req)body+=chunk;
          requests.push(JSON.parse(body));if(hold)await hold;
          res.writeHead(reply?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify(reply??{error:'Unavailable'}));return;
        }
        if(file==='/money.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable reply test</title>');return;}
        if(/^\/[a-z0-9-]+\.js$/.test(file)){
          res.setHeader('Content-Type','text/javascript');res.end(overrides[file.slice(1)]??await fs.readFile(path.join(__dirname,'public',file.slice(1))));return;
        }
        res.writeHead(404);res.end();
      }catch(error){errors.push(error.message);res.writeHead(500);res.end();}
    });
    try{
      await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
      const carrierOptions={origin,directory,allowedOrigins:[base],interval:60000};
      async function startCarrier(){carrier=createCarrier(carrierOptions);carrier.server.on('request',req=>{if(req.headers.origin&&req.method==='POST')mailboxes.push(req.url);});await carrier.listen();}
      await startCarrier();
      async function boot(){
        await page.goto(base+'/money.html');
        await page.evaluate(async({config,origin})=>{
          window.c=config;window.store=await import('/chat-store.js');window.n=await import('/near-protocol.js');window.p=await import('/peer-crypto.js');
          window.w=await import('/defi-wallet.js');window.delivery=await import('/carrier-client.js');window.errors=[];
          window.client=delivery.createCarrierClient({config:{version:1,carriers:[origin]},contract:c.reserve,defiConfig:c,onError:e=>errors.push(e.message)});
          window.snapshot=async()=>{const s=await store.readState(),v=await n.readNearVault(s,c.reserve),l=await n.nearLedger(v);return {profile:s.identity.profile,vault:v,available:l.available.reduce((a,x)=>a+BigInt(x.amount),0n).toString(),reserved:[...l.reserved]};};
        },{config,origin});
      }
      await boot();
      await context.setOffline(true);
      const seeded=await page.evaluate(async executor=>{
        await store.updateState(async s=>{s.identity=await p.createIdentity('Offline sender');s.contacts=[executor];s.messages=[];
          const v=n.emptyNearVault(c.reserve),root=await n.fundingRequest(s.identity,c.reserve,'10');v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);});
        const deadlineMs=Date.now()+600000;
        const ref=await w.approveDefiSwap(c,executor,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs},
          {approvalId:'a'.repeat(32),disclosure:'lenz/disclosure/public-near-executor/v1',expiresAt:deadlineMs});
        return {ref,before:await snapshot()};
      },executor.profile);
      await context.setOffline(false);
      const {ref,before}=seeded,order=before.vault.rheaOrders[0],createdAt=order.defi.request.createdAt;
      reply={requestId:ref.requestId,state:'observed',observation:{finality:'FINAL',block:{height:20,hash:'4'.repeat(32)},order:{id:order.packet.id,instruction:order.packet.instruction,stage:'complete',output:'100',reason:''}}};
      async function send(payload,signer=executor){
        const packet=await p.sealMessage(signer,before.profile,payload),envelope=await cp.wrapForCarrier(signer,packet);
        await cp.carrierPost(origin,'/v1/store',envelope);return {packet,envelope};
      }
      const report=(time=Date.now())=>({type:'lenz/defi-observation/v1',requestId:ref.requestId,checkedAt:time,state:'observed',observation:{claimed:'complete'},transaction:null});
      await test({page,context,boot,before,ref,createdAt,send,report,requests,mailboxes,setReply:r=>reply=r,getReply:()=>structuredClone(reply),
        startService:async()=>{
          const {DefiInbox}=await import('../carrier/defi-inbox.mjs'),{DefiExecutor}=await import('../carrier/defi-executor.mjs'),{createDefiService}=await import('../carrier/defi-service.mjs');
          await carrier.close();carrier=null;
          const inbox=new DefiInbox(path.join(directory,'inbox'),{identity:executor,config});
          const worker=new DefiExecutor(path.join(directory,'worker'),{inbox,identity:executor,config,clients:{observe:async()=>({state:'observed',...reply.observation,call:null,step:null})}});
          const service=createDefiService({directory:path.join(directory,'service'),origin,identity:executor,inbox,worker,senders:[before.profile.id],allowedOrigins:[base]});
          carrier={close:async()=>{await service.close();worker.close();inbox.close();}};await service.listen();
          return {origin,tick:()=>service.tick()};
        },
        hold:()=>{let release;hold=new Promise(r=>release=r);return ()=>{hold=null;release();};},
        restart:async()=>{await carrier.close();await startCarrier();}});
      assert.deepEqual(errors,[]);results.push(name);console.log('PASS '+name);
    }finally{
      await context.close();await carrier?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
      assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
    }
  }
  try{
    await check('automatic delivery retrieves encrypted replies and independently checks the saved approval',async({page,send,report,before,ref,requests,restart})=>{
      await send({type:'lenz/defi-inbox-receipt/v1',requestId:ref.requestId,state:'stored',storedAt:Date.now()});await send(report());await restart();
      await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);await client.tick();});
      const after=await page.evaluate(()=>snapshot());
      assert.equal(after.vault.rheaOrders[0].defi.storageReceipt?.state,'stored');assert.equal(after.vault.rheaOrders[0].defi.checkedOutcome?.state,'observed');
      assert.equal(after.vault.rheaOrders[0].status?.stage,'complete');assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);
      assert.equal(requests.length,1);assert.equal(requests[0].request.id,ref.requestId);assert.equal(requests[0].sender.name,'Sender');
      assert.deepEqual(await page.evaluate(()=>errors),[]);
      await page.evaluate(async()=>{client.wake();await client.tick();});assert.equal(requests.length,1);
    });
    await check('an offline approval reaches the receiving service and its encrypted result returns to Wallet',async({page,before,requests,startService})=>{
      const service=await startService();
      await page.evaluate(async origin=>{
        await delivery.setCarrierEnabled(true);const send=await import('/defi-delivery.js'),v=(await snapshot()).vault;
        await send.sendDefiRequest(c,v.rheaOrders[0].defi.request.id,{version:1,carriers:[origin]});
      },service.origin);
      const outcomes=await service.tick();assert.equal(outcomes.length,1);assert.equal(outcomes[0].state,'checked');
      await page.evaluate(()=>client.tick());const after=await page.evaluate(()=>snapshot()),saved=after.vault.rheaOrders[0].defi;
      assert.equal(saved.storageReceipt.state,'stored');assert.equal(saved.executorUpdate.report.state,'observed');assert.equal(saved.checkedOutcome.state,'observed');
      assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);assert.equal(requests.length,1);assert.deepEqual(await page.evaluate(()=>errors),[]);
    });
    await check('offline and paused delivery make no mailbox or swap-status requests',async({page,context,send,report,requests,mailboxes})=>{
      await send(report());await page.evaluate(()=>client.tick());assert.equal(mailboxes.length,0);assert.equal(requests.length,0);
      await page.evaluate(()=>delivery.setCarrierEnabled(true));await context.setOffline(true);
      await page.evaluate(()=>client.tick());assert.equal(mailboxes.length,0);assert.equal(requests.length,0);
      await context.setOffline(false);await page.evaluate(async()=>{await delivery.setCarrierEnabled(false);client.wake();await client.tick();});
      assert.equal(mailboxes.length,0);assert.equal(requests.length,0);
    });
    await check('ordinary messages still arrive when the saved swap wallet uses another reserve',async({page,send})=>{
      await send({kind:'chat',text:'Still reachable',sentAt:Date.now()});
      await page.evaluate(async()=>{
        await store.updateState(async s=>{delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault('old-reserve.testnet'));});
        await delivery.setCarrierEnabled(true);await client.tick();
      });
      const messages=await page.evaluate(async()=>{const s=await store.readState();return Promise.all(s.messages.map(m=>p.openMessage(s.identity,s.contacts[0],m.packet)));});
      assert.equal(messages.length,1);assert.equal(messages[0].text,'Still reachable');
    });
    await check('an unavailable independent observer leaves the update saved and retries after reopening',async({page,send,report,before,requests,setReply,getReply,boot})=>{
      const valid=getReply();setReply(null);await send(report());
      await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);await client.tick();});
      const pending=await page.evaluate(()=>snapshot());assert(pending.vault.rheaOrders[0].defi.executorUpdate);assert.equal(pending.vault.rheaOrders[0].defi.checkedOutcome,undefined);
      assert.equal(pending.vault.rheaOrders[0].status,null);assert.equal(pending.available,before.available);assert.deepEqual(pending.reserved,before.reserved);
      await page.evaluate(()=>client.tick());assert.equal(requests.length,1);
      await page.evaluate(()=>client.close());await boot();setReply(valid);await page.evaluate(()=>client.tick());
      assert.equal(requests.length,2);assert.equal((await page.evaluate(()=>snapshot())).vault.rheaOrders[0].defi.checkedOutcome.state,'observed');
    });
    await check('an executor completion claim cannot replace a pending independent observation',async({page,send,report,before,setReply,getReply})=>{
      const pending=getReply();pending.state='ready';pending.observation.order=null;setReply(pending);await send(report());
      await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);await client.tick();});
      const after=await page.evaluate(()=>snapshot());assert.equal(after.vault.rheaOrders[0].defi.checkedOutcome.state,'ready');
      assert.equal(after.vault.rheaOrders[0].status,null);assert.equal(after.available,before.available);assert.deepEqual(after.reserved,before.reserved);
    });
    await check('pausing during an independent check discards the late reply and resumes from the saved update',async({page,send,report,requests,hold})=>{
      await send(report());const release=hold();
      await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);window.running=client.tick();});
      await assertEventually(()=>requests.length===1);
      await page.evaluate(async()=>{client.pause();await delivery.setCarrierEnabled(false);});release();await page.evaluate(()=>running);
      const after=await page.evaluate(()=>snapshot());assert.equal(after.vault.rheaOrders[0].defi.checkedOutcome,undefined);assert(after.vault.rheaOrders[0].defi.executorUpdate);
      await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);client.wake();await client.tick();});
      assert.equal((await page.evaluate(()=>snapshot())).vault.rheaOrders[0].defi.checkedOutcome.state,'observed');assert.equal(requests.length,2);
    });
    await check('an account switch during verification cannot write the old result into the new wallet',async({page,send,report,requests,hold})=>{
      await send(report());const release=hold();await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);window.running=client.tick();});
      await assertEventually(()=>requests.length===1);
      await page.evaluate(async()=>store.updateState(async s=>{s.identity=await p.createIdentity('Another account');delete s.nearBox;delete s.nearKey;await n.saveNearVault(s,n.emptyNearVault(c.reserve));}));
      const before=await page.evaluate(()=>snapshot());release();await page.evaluate(()=>running);assert.deepEqual(await page.evaluate(()=>snapshot()),before);
    });
    await check('a newer reply received during verification is not marked checked by the older request',async({page,send,report,requests,hold,setReply,getReply})=>{
      const pending=getReply();pending.state='pending';pending.observation.order=null;setReply(pending);
      const first=report();await send(first);const release=hold();await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);window.running=client.tick();});
      await assertEventually(()=>requests.length===1);const next=await send({...first,checkedAt:first.checkedAt+1,state:'pending'});
      await page.evaluate(packet=>store.updateState(s=>w.acceptDefiReply(s,c,packet)),next.packet);release();await page.evaluate(()=>running);
      const saved=(await page.evaluate(()=>snapshot())).vault.rheaOrders[0].defi;
      assert.equal(saved.executorUpdate.report.checkedAt,first.checkedAt+1);assert.notEqual(saved.checkedUpdateId,saved.executorUpdate.id);assert.equal(saved.checkedOutcome.state,'pending');
    });
    await check('slow unavailable swap checks do not starve later saved approvals',async({page,send,report,ref})=>{
      const refs=await page.evaluate(async()=>{
        const s=await store.readState(),refs=[],deadlineMs=Date.now()+600000;
        for(const id of ['b','c'])refs.push(await w.approveDefiSwap(c,s.contacts[0],{text:'1',minOutput:'100',receiver:'receiver.testnet',deadlineMs},
          {approvalId:id.repeat(32),disclosure:'lenz/disclosure/public-near-executor/v1',expiresAt:deadlineMs}));
        return refs;
      });
      await send(report());for(const next of refs)await send({...report(),requestId:next.requestId});
      const attempts=await page.evaluate(async()=>{
        client.close();const fetcher=window.fetch,clock=Date.now;let now=Date.now();const attempts=[];
        Date.now=()=>now;
        window.fetch=async(input,options)=>{
          if(input==='/api/defi/rhea/status'){attempts.push(JSON.parse(options.body).request.id);now+=31000;return new Response('{}',{status:503});}
          return fetcher(input,options);
        };
        client=delivery.createCarrierClient({config:{version:1,carriers:client.carriers},contract:c.reserve,defiConfig:c,now:()=>now});
        try{await delivery.setCarrierEnabled(true);for(let i=0;i<4;i++)await client.tick();return attempts;}
        finally{Date.now=clock;window.fetch=fetcher;}
      });
      for(const id of [ref,...refs].map(r=>r.requestId))assert(attempts.includes(id),'Every saved approval should be checked despite unavailable earlier swaps');
    });
    await check('pausing at the durable save boundary aborts the late outcome transaction',async({page,send,report,requests,hold})=>{
      await send(report());const release=hold();await page.evaluate(async()=>{await delivery.setCarrierEnabled(true);window.running=client.tick();});
      await assertEventually(()=>requests.length===1);
      await page.evaluate(()=>{
        const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){IDBObjectStore.prototype.put=put;client.pause();return put.apply(this,args);};
      });release();await page.evaluate(()=>running);
      assert.equal((await page.evaluate(()=>snapshot())).vault.rheaOrders[0].defi.checkedOutcome,undefined);
    });
    return {passed:results.length,results};
  }finally{await browser.close();}
}
async function assertEventually(predicate){const deadline=Date.now()+5000;while(!predicate()){assert(Date.now()<deadline,'Expected request did not arrive');await new Promise(r=>setTimeout(r,20));}}
module.exports={run};
if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
