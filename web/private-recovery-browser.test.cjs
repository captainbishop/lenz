const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

async function fixture(run,{persistent=false,offerFactory=source=>source.fixture(),assets=null}={}){
 const source=await import('./intents-spend-fixture.mjs'),offer=offerFactory(source),{confidentialSignedData}=await import('./public/intents-spend.js');delete offer.payload;
 const signed=confidentialSignedData(offer.generated.intent.payload,await source.wallet.signMessage(offer.generated.intent.payload),source.owner);
 const {AccountStore}=await import('./account-store.mjs'),{createAccountRoute}=await import('./account-relay.mjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-private-recovery-')),backing=new AccountStore(directory);let route,browser,persistentContext,serving=true;
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  if(file.startsWith('/api/accounts/'))return route(req,res);
  if(file==='/api/receive/assets'&&assets){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tokens:assets}));return;}
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private recovery fixture</title>');return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]??'application/octet-stream');
  if(file==='/intents-vendor/quote.js'){res.end((await fs.readFile(path.join(__dirname,'public/intents-vendor/quote.js'),'utf8')).replace('ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc',source.managerKey));return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;route=createAccountRoute({origin:base,store:backing});
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext()));
  const openPersistent=()=>chromium.launchPersistentContext(path.join(directory,'recovered-profile'),{channel:'msedge',headless:true,serviceWorkers:'allow'});
  if(persistent){await contexts[2].close();persistentContext=await openPersistent();contexts[2]=persistentContext;}
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  for(const page of pages){await page.context().addInitScript(time=>{window.recoveryNow=time;Date.now=()=>window.recoveryNow;},source.now);await page.goto(base);await page.evaluate(async()=>{window.store=await import('/chat-store.js');window.peer=await import('/peer-crypto.js');window.sync=await import('/account-sync.js');window.backup=await import('/account-backup.js');window.outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;window.secret=new Uint8Array(32).fill(7);window.material=await(await import('/account-keys.js')).accountKeys(secret.buffer,'Owner');});}
  const [sender,executor,recovered,other]=pages;
  await sender.evaluate(async()=>{await sync.setUpAccount(material);await sync.backupNow();});
  const executorProfile=await executor.evaluate(async()=>{await store.updateState(async s=>{s.identity=await peer.createIdentity('Executor');});return(await store.readState()).identity.profile;});
  const ownerProfile=await sender.evaluate(async()=>{return(await store.readState()).identity.profile;});
  await sender.evaluate(profile=>store.updateState(s=>{s.contacts=[profile];}),executorProfile);
  await executor.evaluate(profile=>store.updateState(s=>{s.contacts=[profile];}),ownerProfile);
  await sender.evaluate(()=>sync.backupNow());
  const queue=()=>sender.evaluate(x=>outbox.queue(x.offer,x.signed,x.executor),{offer,signed,executor:executorProfile});
  const report=async(id,{status='SUCCESS',updatedAt=source.now+1000,observedAt=source.now+1000}={})=>{
   const value={type:'lenz/private-spend-report/v1',id,observation:{type:'lenz/private-status/v1',depositAddress:offer.quote.quote.depositAddress,status,updatedAt:new Date(updatedAt).toISOString(),observedAt,amountIn:status==='SUCCESS'?offer.terms.amount:null,amountOut:status==='SUCCESS'?offer.terms.amount:null,refundedAmount:null,withdrawFee:'0',settlementVerified:false,providerReportSigned:false}};
   return executor.evaluate(async x=>peer.sealMessage((await store.readState()).identity,x.owner,x.value),{owner:ownerProfile,value});
  };
  const restartOffline=async()=>{await persistentContext.close();persistentContext=null;await browser.close();browser=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;persistentContext=await openPersistent();await persistentContext.setOffline(true);await persistentContext.addInitScript(time=>{window.recoveryNow=time;Date.now=()=>window.recoveryNow;},source.now);return persistentContext.pages()[0];};
  await run({sender,executor,recovered,other,offer,signed,queue,report,now:source.now,profiles:{owner:ownerProfile,executor:executorProfile},contexts,base,restartOffline});
 }finally{await persistentContext?.close();await browser?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}backing.close();}
}

test('normal encrypted account backup restores private approvals after account loss with financial access still blocked',()=>fixture(async f=>{
 const row=await f.queue();await f.sender.evaluate(()=>sync.backupNow());
 await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 const rows=await f.recovered.evaluate(()=>outbox.list());assert.equal(rows.length,1);assert.equal(rows[0].id,row.id);assert.equal(rows[0].settlementVerified,false);
 const result=await f.recovered.evaluate(async id=>{const s=await store.readState();let error='';try{await outbox.handoff(id);}catch(e){error=e.message;}return {access:s.identity.access,keyExtractable:s.privateSpendKey.extractable,error,items:await outbox.courierItems(s)};},row.id);
 assert.equal(result.access,'lenz/recovered-chat/v1');assert.equal(result.keyExtractable,false);assert.match(result.error,/recovered|Funds|funds|restored/);assert(result.items.every(item=>!item.sendable));
}));

test('private-only changes trigger backup and encrypted provider updates survive sign-in as unverified',()=>fixture(async f=>{
 const version=await f.sender.evaluate(async()=>(await store.readState()).accountSync.version),row=await f.queue();
 const pending=await f.sender.evaluate(async()=>(await store.readState()).accountSync);assert.equal(pending.status,'pending');assert.equal(pending.version,version+1);
 const packet=await f.report(row.id);await f.sender.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),packet);
 await f.sender.evaluate(()=>sync.backupNow());
 const ciphertext=await f.sender.evaluate(async()=>JSON.stringify((await sync.accountRequest((await store.readState()).accountSync,'read')).archive));
 assert(!ciphertext.includes(f.offer.terms.owner));assert(!ciphertext.includes('SUCCESS'));assert(!ciphertext.includes(row.id));
 await f.recovered.evaluate(()=>sync.retrieveAccount(material));const rows=await f.recovered.evaluate(()=>outbox.list());
 assert.equal(rows[0].observation.status,'SUCCESS');assert.equal(rows[0].settlementVerified,false);assert.equal(rows[0].observation.amountOut,'10000000000000000');
 const snapshot=await f.recovered.evaluate(async()=>outbox.snapshot(await store.readState()));assert.equal(snapshot.rows[0].report.packet.id,packet.id);
 assert.equal(await f.recovered.evaluate(async()=>{const s=await store.readState();return(await outbox.courierItems(s)).filter(item=>item.kind==='private-approval').every(item=>!item.sendable);}),true);
}));

test('same-ID synchronization retains newer reports and converges without repeated uploads',()=>fixture(async f=>{
 const row=await f.queue();await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 const older=await f.report(row.id,{status:'PROCESSING',updatedAt:f.now+1000}),newer=await f.report(row.id,{updatedAt:f.now+2000,observedAt:f.now+2000});
 await f.sender.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),older);
 await f.recovered.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),newer);
 await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());await f.sender.evaluate(()=>sync.backupNow());
 const a=await f.sender.evaluate(()=>outbox.list()),b=await f.recovered.evaluate(()=>outbox.list());assert.deepEqual(a,b);assert.equal(a[0].observation.status,'SUCCESS');
 const revision=await f.sender.evaluate(async()=>(await store.readState()).accountSync.revision);
 for(let i=0;i<3;i++){await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());}
 const revisions=await Promise.all([f.sender,f.recovered].map(p=>p.evaluate(async()=>(await store.readState()).accountSync.revision)));assert.deepEqual(revisions,[revision,revision]);
}));

test('equal provider reports choose one complete packet and receipt deterministically across devices',()=>fixture(async f=>{
 const row=await f.queue();await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 const [a,b]=await Promise.all([f.report(row.id),f.report(row.id,{observedAt:f.now+1500})]);
 await f.sender.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),a);await f.recovered.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),b);
 await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());await f.sender.evaluate(()=>sync.backupNow());await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());
 const snapshots=await Promise.all([f.sender,f.recovered].map(p=>p.evaluate(async()=>outbox.snapshot(await store.readState()))));assert.deepEqual(snapshots[0],snapshots[1]);
 assert([a.id,b.id].includes(snapshots[0].rows[0].report.packet.id));
 const revision=await f.sender.evaluate(async()=>(await store.readState()).accountSync.revision);for(let i=0;i<2;i++){await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.backupNow());}
 assert.equal(await f.sender.evaluate(async()=>(await store.readState()).accountSync.revision),revision);
}));

test('foreign, conflicting and oversized private history cannot replace a saved journal',()=>fixture(async f=>{
 const row=await f.queue();
 const result=await f.sender.evaluate(async()=>{
  const snapshot=await outbox.snapshot(await store.readState()),before=JSON.stringify(await outbox.list()),errors=[];
  for(const mode of ['identity','terms','signature','duplicate','capacity','bytes']){
   const bad=structuredClone(snapshot);
   if(mode==='identity')bad.identity='0'.repeat(64);
   if(mode==='terms')bad.rows[0].offer.terms.amount='1';
   if(mode==='signature')bad.rows[0].signedData.signature='invalid';
   if(mode==='duplicate')bad.rows.push(structuredClone(bad.rows[0]));
   if(mode==='capacity')bad.rows=Array.from({length:33},()=>structuredClone(bad.rows[0]));
   if(mode==='bytes')bad.rows[0].padding='x'.repeat(2000001);
   try{await store.updateState(s=>outbox.restore(s,bad));errors.push('accepted');}catch(e){errors.push(e.message);}
  }
  return {before,after:JSON.stringify(await outbox.list()),errors};
 });
 assert.equal(result.before,result.after);assert.equal(result.errors.length,6);assert(result.errors.every(message=>message!=='accepted'));assert.equal((JSON.parse(result.after))[0].id,row.id);
}));

test('restored Wallet displays the original ETH amount and keeps approval and request export unavailable',()=>fixture(async f=>{
 const row=await f.queue();await f.sender.evaluate(()=>sync.backupNow());await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 await f.recovered.goto(f.base+'/money.html');await f.recovered.locator('#private-spend-open').click();await f.recovered.locator('#private-spend-history li').waitFor();
 const text=await f.recovered.locator('#private-spend-history').innerText();assert.match(text,/0\.01 ETH/);assert.match(text,/Ethereum/);assert.equal(await f.recovered.locator('#private-spend-history button').count(),0);assert.equal(await f.recovered.locator('#private-spend-approve').isDisabled(),true);
 if(process.env.LENZ_PRIVATE_RECOVERY_REPORT_DIR){await fs.mkdir(process.env.LENZ_PRIVATE_RECOVERY_REPORT_DIR,{recursive:true});for(const theme of ['light','dark']){await f.recovered.setViewportSize({width:390,height:844});await f.recovered.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await f.recovered.screenshot({path:path.join(process.env.LENZ_PRIVATE_RECOVERY_REPORT_DIR,'recovered-wallet-'+theme+'.png'),fullPage:true});}}
 const errors=await f.recovered.evaluate(async x=>{const s=await import('/chat-store.js'),o=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox,errors=[];for(const act of [()=>o.handoff(x.id),()=>o.queue(x.offer,x.signed,x.executor)])try{await act();errors.push('accepted');}catch(e){errors.push(e.message);}return {errors,count:(await o.list()).length,access:(await s.readState()).identity.access};},{id:row.id,offer:f.offer,signed:f.signed,executor:f.profiles.executor});
 assert(errors.errors.every(error=>error!=='accepted'));assert.equal(errors.count,1);assert.equal(errors.access,'lenz/recovered-chat/v1');
}));

test('a valid competing approval with the same owner nonce cannot merge into recovered history',()=>fixture(async f=>{
 await f.queue();
 const source=await import('./intents-spend-fixture.mjs'),alternate=source.fixture();delete alternate.payload;alternate.quote.quote.depositAddress='cd'.repeat(32);source.signQuote(alternate.quote);
 const payload=JSON.parse(alternate.generated.intent.payload);payload.intents[0].receiver_id=alternate.quote.quote.depositAddress;alternate.generated.intent.payload=JSON.stringify(payload);
 const {confidentialSignedData}=await import('./public/intents-spend.js'),signed=confidentialSignedData(alternate.generated.intent.payload,await source.wallet.signMessage(alternate.generated.intent.payload),source.owner);
 await f.other.evaluate(async x=>{await store.updateState(s=>{s.identity=material.identity;s.contacts=[x.executor];});await outbox.queue(x.offer,x.signed,x.executor);},{offer:alternate,signed,executor:f.profiles.executor});
 const competing=await f.other.evaluate(async()=>outbox.snapshot(await store.readState()));
 const result=await f.sender.evaluate(async snapshot=>{const before=JSON.stringify(await outbox.list());let error='';try{await store.updateState(s=>outbox.restore(s,snapshot));}catch(e){error=e.message;}return {before,after:JSON.stringify(await outbox.list()),error};},competing);
 assert.match(result.error,/nonce histories disagree/);assert.equal(result.before,result.after);
}));

test('expired unresolved approvals and acknowledgement evidence remain recoverable',()=>fixture(async f=>{
 const row=await f.queue(),ack=await f.executor.evaluate(async x=>peer.sealMessage((await store.readState()).identity,x.profile,{type:'lenz/private-spend-ack/v1',id:x.id,acceptedAt:x.time}),{profile:f.profiles.owner,id:row.id,time:f.now+1000});
 await f.sender.evaluate(packet=>store.updateState(s=>outbox.acceptAcknowledgement(s,packet)),ack);await f.sender.evaluate(()=>sync.backupNow());
 await f.recovered.evaluate(time=>{window.recoveryNow=time;},Date.parse(f.offer.terms.signingDeadline)+1000);await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 const rows=await f.recovered.evaluate(()=>outbox.list()),snapshot=await f.recovered.evaluate(async()=>outbox.snapshot(await store.readState()));assert.equal(rows[0].status,'expired-unresolved');assert.equal(rows[0].settlementVerified,false);assert.equal(snapshot.rows[0].acknowledgement.id,ack.id);
}));

test('a malformed journal inside authenticated encrypted backup rejects sign-in without occupying the browser',()=>fixture(async f=>{
 await f.queue();await f.sender.evaluate(()=>sync.backupNow());
 const bad=await f.sender.evaluate(async()=>{
  const state=await store.readState(),result=await sync.accountRequest(state.accountSync,'read'),a=result.archive,terms=peer.bytes([a.type,a.accountId,a.revision,a.previous]);
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:peer.unhex(a.iv),additionalData:terms},material.backupKey,peer.unhex(a.ciphertext)),value=JSON.parse(new TextDecoder().decode(raw));value.privateSpend.rows[0].offer.terms.amount='1';
  a.ciphertext=peer.hex(await crypto.subtle.encrypt({name:'AES-GCM',iv:peer.unhex(a.iv),additionalData:terms},material.backupKey,peer.bytes(value)));result.digest=await peer.digest(a);return result;
 });
 await f.recovered.route('**/api/accounts/read',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)}));
 const result=await f.recovered.evaluate(async()=>{const before=JSON.stringify(await store.readState());let error='';try{await sync.retrieveAccount(material);}catch(e){error=e.message;}return {before,after:JSON.stringify(await store.readState()),error};});
 assert(result.error);assert.equal(result.before,result.after);assert.equal(JSON.parse(result.after).identity,null);
}));

test('every present malformed private-history value rejects sign-in and leaves the browser empty',()=>fixture(async f=>{
 await f.queue();await f.sender.evaluate(()=>sync.backupNow());
 for(const value of [null,false,0,'']){
  const bad=await f.sender.evaluate(async value=>{
   const state=await store.readState(),result=await sync.accountRequest(state.accountSync,'read'),a=result.archive,terms=peer.bytes([a.type,a.accountId,a.revision,a.previous]);
   const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:peer.unhex(a.iv),additionalData:terms},material.backupKey,peer.unhex(a.ciphertext)),contents=JSON.parse(new TextDecoder().decode(raw));
   contents.privateSpend=value;a.iv=peer.hex(crypto.getRandomValues(new Uint8Array(12)));
   a.ciphertext=peer.hex(await crypto.subtle.encrypt({name:'AES-GCM',iv:peer.unhex(a.iv),additionalData:terms},material.backupKey,peer.bytes(contents)));result.digest=await peer.digest(a);return result;
  },value);
  await f.recovered.route('**/api/accounts/read',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)}));
  const result=await f.recovered.evaluate(async()=>{const before=JSON.stringify(await store.readState());let error='';try{await sync.retrieveAccount(material);}catch(e){error=e.message;}return {before,after:JSON.stringify(await store.readState()),error};});
  assert(result.error);assert.equal(result.before,result.after);assert.equal(JSON.parse(result.after).identity,null);
  await f.recovered.unroute('**/api/accounts/read');
 }
}));

test('an account created while private backup opens prevents late sign-in from replacing it',()=>fixture(async f=>{
 await f.queue();await f.sender.evaluate(()=>sync.backupNow());
 let release;const gate=new Promise(resolve=>release=resolve);let arrived;const started=new Promise(resolve=>arrived=resolve);
 await f.recovered.route('**/api/accounts/read',async route=>{const result=await route.fetch();arrived();await gate;await route.fulfill({response:result});});
 const finished=f.recovered.evaluate(async()=>{try{await sync.retrieveAccount(material);return 'accepted';}catch(e){return e.message;}});
 await started;await f.recovered.evaluate(()=>store.updateState(async s=>{s.identity=await peer.createIdentity('Keep me');s.pendingOrders=['unresolved'];}));
 const before=await f.recovered.evaluate(async()=>JSON.stringify(await store.readState()));release();assert.match(await finished,/already has an account/);assert.equal(await f.recovered.evaluate(async()=>JSON.stringify(await store.readState())),before);
}));

test('legacy device identity with private requests cannot upload a backup that silently drops them',()=>fixture(async f=>{
 await f.other.evaluate(async profile=>{await store.updateState(async s=>{s.identity=await peer.createIdentity('Old owner');s.contacts=[profile];});await sync.setUpAccount(material,(await store.readState()).identity.profile.id);},f.profiles.executor);
 await f.other.evaluate(x=>outbox.queue(x.offer,x.signed,x.executor),{offer:f.offer,signed:f.signed,executor:f.profiles.executor});
 const result=await f.other.evaluate(async()=>{const before=JSON.stringify(await outbox.list());let error='';try{await backup.createAccountBackup(await store.readState());}catch(e){error=e.message;}return {before,after:JSON.stringify(await outbox.list()),error};});
 assert.match(result.error,/original recoverable Lenz ID/);assert.equal(result.before,result.after);
}));

test('private history recovered through normal sign-in survives full browser shutdown and opens offline in Wallet',()=>fixture(async f=>{
 const row=await f.queue(),packet=await f.report(row.id);await f.sender.evaluate(packet=>store.updateState(s=>outbox.acceptReport(s,packet)),packet);await f.sender.evaluate(()=>sync.backupNow());
 await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 await f.recovered.evaluate(async()=>{
  const registration=await navigator.serviceWorker.register('/chat-sw.js',{scope:'/money.html'}),worker=registration.installing??registration.waiting??registration.active;
  if(worker.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(Error('Offline cache failed'));};worker.addEventListener('statechange',changed);changed();});
 });
 const page=await f.restartOffline(),response=await page.goto(f.base+'/money.html');assert(response.fromServiceWorker());
 await page.locator('#private-spend-open').click();await page.locator('#private-spend-history li').waitFor();assert.match(await page.locator('#private-spend-history').innerText(),/0\.01 ETH/);
 const result=await page.evaluate(async()=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox,s=await store.readState();return {rows:await outbox.list(),access:s.identity.access};});
 assert.equal(result.rows[0].id,row.id);assert.equal(result.rows[0].observation.status,'SUCCESS');assert.equal(result.rows[0].settlementVerified,false);assert.equal(result.access,'lenz/recovered-chat/v1');assert(await page.locator('#private-spend-approve').isDisabled());
},{persistent:true}));

test('recovered USDC history shows its exact saved quantity and asset after full offline restart',()=>fixture(async f=>{
 const row=await f.queue();await f.sender.evaluate(()=>sync.backupNow());
 await f.sender.goto(f.base+'/money.html');await f.sender.locator('#private-spend-open').click();
 await f.sender.locator('#private-spend-history summary').filter({hasText:'1 USDC'}).waitFor();
 await f.recovered.evaluate(()=>sync.retrieveAccount(material));
 await f.recovered.evaluate(async()=>{
  const registration=await navigator.serviceWorker.register('/chat-sw.js',{scope:'/money.html'}),worker=registration.installing??registration.waiting??registration.active;
  if(worker.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(Error('Offline cache failed'));};worker.addEventListener('statechange',changed);changed();});
 });
 const page=await f.restartOffline(),response=await page.goto(f.base+'/money.html');assert(response.fromServiceWorker());
 await page.locator('#private-spend-open').click();await page.locator('#private-spend-history li').waitFor();
 assert.equal(await page.locator('#private-spend-history summary').innerText(),'1000000 base units · nep141:usdc.omft.near');
 assert.equal(await page.locator('#private-spend-history button').count(),0);assert(await page.locator('#private-spend-approve').isDisabled());
 const result=await page.evaluate(async()=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox,s=await store.readState();return {rows:await outbox.list(),access:s.identity.access};});
 assert.equal(result.rows[0].id,row.id);assert.equal(result.rows[0].amount,'1000000');assert.equal(result.rows[0].originAsset,'nep141:usdc.omft.near');assert.equal(result.rows[0].settlementVerified,false);assert.equal(result.access,'lenz/recovered-chat/v1');
},{persistent:true,assets:[{assetId:'nep141:usdc.omft.near',symbol:'USDC',decimals:6,blockchain:'eth',contractAddress:null}],offerFactory:source=>{
 const offer=source.fixture(),asset='nep141:usdc.omft.near';
 offer.terms.originAsset=offer.terms.destinationAsset=asset;offer.terms.amount=offer.terms.minOutput='1000000';
 offer.quote.quoteRequest.originAsset=offer.quote.quoteRequest.destinationAsset=asset;offer.quote.quoteRequest.amount='1000000';
 for(const field of ['amountIn','minAmountIn','amountOut','minAmountOut'])offer.quote.quote[field]='1000000';source.signQuote(offer.quote);
 const payload=JSON.parse(offer.generated.intent.payload);payload.intents[0].tokens={['imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:'+asset]:'1000000'};offer.generated.intent.payload=JSON.stringify(payload);return offer;
}}));
