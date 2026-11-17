const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function fixture(run,{asset='nep141:eth.omft.near',swap=false}={}){
 const source=await import('./intents-spend-fixture.mjs'),offer=source.fixture(),{confidentialSignedData}=await import('./public/intents-spend.js');
 if(asset!==offer.terms.originAsset){offer.terms.originAsset=offer.terms.destinationAsset=asset;offer.quote.quoteRequest.originAsset=offer.quote.quoteRequest.destinationAsset=asset;const payload=JSON.parse(offer.generated.intent.payload);payload.intents[0].tokens={['imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:'+asset]:offer.terms.amount};offer.generated.intent.payload=JSON.stringify(payload);source.signQuote(offer.quote);}
 if(swap){offer.terms.destinationAsset=offer.quote.quoteRequest.destinationAsset='nep141:usdc.near';offer.terms.minOutput='25000000';offer.quote.quote.amountOut='27000000';offer.quote.quote.minAmountOut='26000000';offer.terms.recipient=offer.quote.quoteRequest.recipient=source.owner;source.signQuote(offer.quote);}
 const signedData=confidentialSignedData(offer.generated.intent.payload,await source.wallet.signMessage(offer.generated.intent.payload),source.owner);
 delete offer.payload;
 const api={submitted:0,read:0,mode:'ready',status:'PENDING_DEPOSIT',release:null},errors=[];let bridge;
 const server=http.createServer(async(req,res)=>{
  if(await bridge(req,res))return;
  const file=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  if(file==='/intents-vendor/quote.js'){res.end(`import {verifyQuoteSignature as verify} from '/fixture-quote.js';export const verifyQuoteSignature=q=>verify(q,${JSON.stringify(source.managerKey)});`);return;}
  if(file==='/api/receive/assets'&&swap){const token={assetId:'nep141:usdc.near',symbol:'USDC',blockchain:'near',decimals:6};res.end(JSON.stringify({tokens:api.catalogue==='missing'?[]:api.catalogue==='invalid'?[{...token,decimals:6.5}]:api.catalogue==='duplicate'?[token,{...token,decimals:18}]:[token]}));return;}
  if(file.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 bridge=(await import('./private-executor-relay.mjs')).createPrivateExecutorRoute({origin:base,apiKey:'synthetic',verifySignature:source.verifier,now:()=>api.now??source.now,submit:async(value,signed)=>{
  api.submitted++;assert.deepEqual(value,offer);assert.deepEqual(signed,signedData);if(api.mode==='delay')await new Promise(resolve=>api.release=resolve);if(api.mode==='lost')throw Error('Provider reply lost');
  return {state:'submitted',intentHash:'2'.repeat(44),depositAddress:offer.quote.quote.depositAddress,settlementVerified:false};
 },observe:async()=>{api.read++;if(api.mode==='delay-read')await new Promise(resolve=>api.release=resolve);return {type:'lenz/private-status/v1',depositAddress:offer.quote.quote.depositAddress,status:api.status,updatedAt:new Date((api.now??source.now)+api.read).toISOString(),observedAt:api.now??source.now,amountIn:api.status==='SUCCESS'?offer.terms.amount:null,amountOut:api.status==='SUCCESS'?offer.quote.quote.amountOut:null,refundedAmount:null,withdrawFee:'0',settlementVerified:false,providerReportSigned:false};}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:true}))),[sender,page]=await Promise.all(contexts.map(c=>c.newPage()));
  const profiles=[];
  for(const [i,p]of [sender,page].entries()){
   p.on('pageerror',error=>errors.push(error.message));await p.addInitScript(time=>{Date.now=()=>time;},source.now);await p.goto(base+'/money.html');
   profiles.push(await p.evaluate(async name=>{const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');await store.updateState(async s=>{s.identity=await peer.createIdentity(name);});return(await store.readState()).identity.profile;},['Sender','Executor'][i]));
  }
  for(const p of [sender,page])await p.evaluate(profiles=>(async()=>{const store=await import('/chat-store.js');await store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});})(),profiles);
  await page.reload();
  const approval=await sender.evaluate(async({offer,signedData,executor})=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox,transport=await import('/carrier-protocol.js');const row=await outbox.queue(offer,signedData,executor);return {id:row.id,envelope:await transport.wrapForCarrier((await store.readState()).identity,await outbox.handoff(row.id))};},{offer,signedData,executor:profiles[1]});
  const idle=()=>page.waitForFunction(()=>document.querySelector('#private-executor-dialog').getAttribute('aria-busy')==='false');
  const open=async()=>{await page.locator('#private-executor-open').click();await idle();};
  const allow=async(owner=source.owner)=>{if(!await page.locator('#private-executor-policy').isVisible())await page.locator('#private-executor-permissions summary').click();await page.locator('#private-executor-sender').selectOption(profiles[0].id);await page.locator('#private-executor-owner').fill(owner);await page.locator('#private-executor-allow').click();await idle();};
  const importRequest=async(value={type:'lenz/private-request-file/v1',envelope:approval.envelope})=>{await page.locator('#private-executor-file').setInputFiles({name:'request.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await idle();};
  const review=async()=>{await page.getByRole('button',{name:'Review request',exact:true}).click();if(!await page.locator('#private-executor-consent').isDisabled())await page.locator('#private-executor-consent').check();};
  await open();await run({page,sender,contexts,base,api,source,offer,approval,profiles,open,allow,importRequest,review,idle});assert.deepEqual(errors,[]);
 }finally{api.release?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('Wallet receives only an allowed sender-owner request, reviews exact terms and submits once',()=>fixture(async f=>{
 assert(await f.page.locator('#private-executor-file').isDisabled());await f.allow('0x'+'33'.repeat(20));await f.importRequest();assert.equal(f.api.submitted,0);assert.equal(await f.page.locator('#private-executor-history li').count(),0);
 await f.allow();await f.importRequest();assert.match(await f.page.locator('#private-executor-feedback').innerText(),/No payment submitted/);assert.equal(f.api.submitted,0);
 await f.importRequest();assert.equal(await f.page.locator('#private-executor-history li').count(),1);
 await f.page.getByRole('button',{name:'Review request',exact:true}).click();const terms=await f.page.locator('#private-executor-terms').innerText();for(const value of [f.source.owner,f.offer.terms.recipient,'0.01 ETH'])assert(terms.includes(value));await f.page.locator('#private-executor-review summary').click();assert.match(await f.page.locator('#private-executor-exact').innerText(),new RegExp(f.offer.quote.quote.depositAddress));assert(await f.page.locator('#private-executor-submit').isDisabled());assert(await f.page.locator('#private-executor-disclosure').isVisible());
 assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await f.page.locator('#private-executor-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
 if(process.env.LENZ_EXECUTOR_EVIDENCE){await fs.mkdir(process.env.LENZ_EXECUTOR_EVIDENCE,{recursive:true});await f.page.locator('#private-executor-review summary').click();await f.page.locator('#private-executor-permissions summary').click();await f.page.locator('#private-executor-dialog').evaluate(n=>n.scrollTop=0);for(const width of [390,1280])for(const theme of ['light','dark']){await f.page.setViewportSize({width,height:900});await f.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await f.page.screenshot({path:path.join(process.env.LENZ_EXECUTOR_EVIDENCE,`received-${theme}-${width}.png`)});}await f.page.setViewportSize({width:390,height:844});}
 await f.page.locator('#private-executor-consent').check();await f.page.locator('#private-executor-submit').click();await f.idle();assert.equal(f.api.submitted,1);assert.match(await f.page.locator('#private-executor-history').innerText(),/Submitted · completion unverified/);assert(await f.page.locator('#private-executor-submit').isDisabled());
 await f.page.reload();await f.open();await f.review();assert(await f.page.locator('#private-executor-submit').isDisabled());assert.equal(f.api.submitted,1);
}));

test('a lost submission reply survives reopening and a pending report cannot allow another attempt',()=>fixture(async f=>{
 await f.allow();await f.importRequest();f.api.mode='lost';await f.review();await f.page.locator('#private-executor-submit').click();await f.idle();assert.equal(f.api.submitted,1);assert.match(await f.page.locator('#private-executor-history').innerText(),/reply lost/);
 await f.page.reload();await f.open();await f.page.getByRole('button',{name:'Check update',exact:true}).click();await f.idle();assert.equal(f.api.read,1);assert.match(await f.page.locator('#private-executor-history').innerText(),/pending deposit · completion unverified/);
 await f.review();assert(await f.page.locator('#private-executor-submit').isDisabled());assert.equal(f.api.submitted,1);
}));

test('exported receipt and report reach the original owner and reuse exact saved packets',()=>fixture(async f=>{
 await f.allow();await f.importRequest();
 async function download(){const event=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Save update',exact:true}).click();const file=await event;await f.idle();return JSON.parse(await fs.readFile(await file.path(),'utf8'));}
 const first=await download(),again=await download();assert.deepEqual(again.envelope.packet,first.envelope.packet);assert(!JSON.stringify(first).includes(f.source.owner));
 await f.sender.evaluate(value=>(async()=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;await store.updateState(s=>outbox.acceptAcknowledgement(s,value.envelope.packet));})(),first);
 f.api.status='SUCCESS';await f.page.getByRole('button',{name:'Check update',exact:true}).click();await f.idle();const update=await download();assert(!JSON.stringify(update).includes('SUCCESS'));
 await f.sender.evaluate(value=>(async()=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;await store.updateState(s=>outbox.acceptReport(s,value.envelope.packet));})(),update);
 const saved=await f.sender.evaluate(async()=>(await import('/intents-spend-outbox.js')).confidentialSpendOutbox.list());assert.equal(saved[0].observation.status,'SUCCESS');assert.equal(saved[0].settlementVerified,false);assert.equal(f.api.submitted,0);
}));

test('pausing or recovering an executor blocks requests while masking keeps exact reviews explicit',()=>fixture(async f=>{
 await f.allow();await f.importRequest();await f.page.locator('#private-executor-enabled').uncheck();await f.idle();assert.equal(await f.page.locator('#private-executor-history li').count(),1);assert(await f.page.locator('#private-executor-file').isDisabled());assert(await f.page.getByRole('button',{name:'Check update',exact:true}).isDisabled());
 await f.page.locator('#private-executor-enabled').check();await f.idle();await f.page.locator('#private-executor-close').click();await f.page.locator('#toggle-balances').click();await f.open();assert.equal(await f.page.locator('#private-executor-history strong').innerText(),'••••');
 await f.page.getByRole('button',{name:'Review request',exact:true}).click();assert.match(await f.page.locator('#private-executor-terms').innerText(),/0\.01 ETH/);
 await f.page.evaluate(async()=>{const store=await import('/chat-store.js');await store.updateState(s=>{s.identity.access='lenz/recovered-chat/v1';});});await f.page.locator('#private-executor-refresh').click();await f.idle();assert(await f.page.locator('#private-executor-submit').isDisabled());assert(await f.page.locator('#private-executor-allow').isDisabled());assert.equal(f.api.submitted,0);
}));

test('closing a submitted request preserves its uncertain attempt and cannot prompt a repeat',()=>fixture(async f=>{
 await f.allow();await f.importRequest();f.api.mode='delay';await f.review();await f.page.locator('#private-executor-submit').click();await f.page.waitForFunction(()=>document.querySelector('#private-executor-dialog').getAttribute('aria-busy')==='true');for(let i=0;!f.api.release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert(f.api.release,'Provider submission was not reached');
 await f.page.keyboard.press('Escape');f.api.release();await f.open();await f.review();assert(await f.page.locator('#private-executor-submit').isDisabled());assert.equal(f.api.submitted,1);
}));

test('removing the last permission survives reopening and stale policies cannot replace newer consent',()=>fixture(async f=>{
 await f.allow();await f.importRequest();
 const conflict=await f.page.evaluate(async owner=>{const inbox=await import('/intents-courier.js'),store=await import('/chat-store.js'),s=await store.readState(),before=await inbox.confidentialInboxSummary();await inbox.setConfidentialInboxEnabled(true,[...before.policies,{sender:s.contacts[0].id,owner:'0x'+'44'.repeat(20)}]);try{await inbox.setConfidentialInboxEnabled(true,[{sender:s.contacts[0].id,owner}],{identity:s.identity.profile.id,previous:before.policies});return '';}catch(e){return e.message;}},f.source.owner);assert.match(conflict,/changed/);
 await f.page.locator('#private-executor-refresh').click();await f.idle();await f.page.getByRole('button',{name:'Remove sender',exact:true}).first().click();await f.idle();await f.page.getByRole('button',{name:'Remove sender',exact:true}).click();await f.idle();
 await f.page.reload();await f.open();assert(await f.page.locator('#private-executor-enabled').isDisabled());assert.equal(await f.page.locator('#private-executor-policies li').count(),0);assert.equal(await f.page.locator('#private-executor-history li').count(),1);assert.equal(f.api.submitted,0);
}));

test('altered request files cannot store and expired saved requests remain checkable',()=>fixture(async f=>{
 await f.allow();const changed=structuredClone(f.approval.envelope);changed.packet.ciphertext=changed.packet.ciphertext.slice(0,-2)+'00';await f.importRequest({type:'lenz/private-request-file/v1',envelope:changed});assert.equal(await f.page.locator('#private-executor-history li').count(),0);assert.equal(f.api.submitted,0);
 await f.importRequest();f.api.now=f.source.now+400000000;await f.page.evaluate(time=>{Date.now=()=>time;},f.api.now);await f.page.locator('#private-executor-refresh').click();await f.idle();await f.review();assert(await f.page.locator('#private-executor-submit').isDisabled());
 await f.page.getByRole('button',{name:'Check update',exact:true}).click();await f.idle();assert.equal(f.api.read,1);assert.match(await f.page.locator('#private-executor-history').innerText(),/completion unverified/);
}));

test('native ETH network labels use checked identifiers and unknown assets cannot prompt submission',async()=>{
 for(const [asset,network]of [['nep141:arb.omft.near','Arbitrum'],['nep141:base.omft.near','Base'],['nep141:wrap.near',null]])await fixture(async f=>{
  await f.allow();await f.importRequest();await f.page.getByRole('button',{name:'Review request',exact:true}).click();const text=await f.page.locator('#private-executor-terms').innerText();assert(!text.includes('nep141:'));
  if(network){assert(text.includes('0.01 ETH · '+network));await f.page.locator('#private-executor-consent').check();assert(!await f.page.locator('#private-executor-submit').isDisabled());}
  else{assert.match(text,/Asset details unavailable/);assert(await f.page.locator('#private-executor-consent').isDisabled());assert(await f.page.locator('#private-executor-submit').isDisabled());}
  assert.equal(f.api.submitted,0);
 },{asset});
});

test('received private swap reviews distinct catalogue units, submits once and returns encrypted output',()=>fixture(async f=>{
 await f.allow();await f.importRequest();await f.review();assert.match(await f.page.locator('#private-executor-terms').innerText(),/26 USDC/);assert(!await f.page.locator('#private-executor-submit').isDisabled());
 assert.equal(await f.page.locator('#private-executor-review-title').innerText(),'Review swap');assert.equal(await f.page.locator('#private-executor-submit').innerText(),'Submit swap');assert.equal(await f.page.locator('#private-executor-consent-label').innerText(),'I checked this swap and agree to submit it.');
 await f.page.locator('#private-executor-submit').click();await f.idle();assert.equal(f.api.submitted,1);assert(await f.page.locator('#private-executor-submit').isDisabled());
 f.api.status='SUCCESS';await f.page.getByRole('button',{name:'Check update',exact:true}).click();await f.idle();
 const download=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'Save update',exact:true}).click();const file=await download,packet=JSON.parse(await fs.readFile(await file.path(),'utf8'));assert(!JSON.stringify(packet).includes('SUCCESS'));
 await f.sender.evaluate(packet=>(async()=>{const store=await import('/chat-store.js'),outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;await store.updateState(s=>outbox.acceptReport(s,packet.envelope.packet));})(),packet);
 const row=(await f.sender.evaluate(async()=>(await import('/intents-spend-outbox.js')).confidentialSpendOutbox.list()))[0];assert.equal(row.observation.amountOut,'27000000');assert.equal(row.destinationAsset,'nep141:usdc.near');assert.equal(row.settlementVerified,false);
 await f.page.reload();await f.open();await f.review();assert(await f.page.locator('#private-executor-submit').isDisabled());assert.equal(f.api.submitted,1);
},{swap:true}));

test('missing, malformed or duplicate swap asset metadata pauses submission and requires a fresh review',()=>fixture(async f=>{
 await f.allow();await f.importRequest();await f.review();assert(!await f.page.locator('#private-executor-submit').isDisabled());
 for(const catalogue of ['missing','invalid','duplicate']){f.api.catalogue=catalogue;await f.page.locator('#private-executor-refresh').click();await f.idle();await f.review();assert(await f.page.locator('#private-executor-consent').isDisabled());assert(await f.page.locator('#private-executor-submit').isDisabled());assert.match(await f.page.locator('#private-executor-terms').innerText(),/Asset details unavailable/);}
 f.api.catalogue='ready';await f.page.locator('#private-executor-refresh').click();await f.idle();assert(await f.page.locator('#private-executor-submit').isDisabled());await f.review();assert(!await f.page.locator('#private-executor-submit').isDisabled());assert.equal(f.api.submitted,0);
},{swap:true}));
