const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const c={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet',refundPayer:'payer.testnet',ready:true};
const checks=[];let calls=0,debits=0,root=null;
const server=http.createServer(async(req,res)=>{try{
  const f=req.url.split('?')[0];
  if(f.startsWith('/api/rhea/')){calls++;const chunks=[];for await(const ch of req)chunks.push(ch);const {request:r}=JSON.parse(Buffer.concat(chunks));if(!root){root={id:r.id,owner:r.owner,amount:r.amount};debits++;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({finality:'FINAL',root,spent:null}));return;}
  if(['/near-config.json','/rhea-config.json'].includes(f)){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f.startsWith('/near-')?{network:'testnet',contract:c.reserve,ready:true}:c));return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]??'application/octet-stream');res.end(await fs.readFile(path.join(__dirname,'public',f)));
}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
async function idle(p){await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const ctx=await browser.newContext(),p=await ctx.newPage();await p.goto(base+'/money.html');await p.waitForFunction(()=>document.querySelector('#status').textContent==='Your wallet is ready.');
  await p.locator('#wallet-name').fill('Refund test');await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);
  const identityId=await p.evaluate(async c=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),r=await import('/rhea-protocol.js');return updateState(async s=>{const v=n.emptyNearVault(c.reserve),f=await n.fundingRequest(s.identity,c.reserve,'3');v.roots.push({id:f.id,owner:f.owner,amount:f.amount});const x=await r.prepareRheaSwap(v,s.identity,c,{text:'3',minOutput:'1',receiver:c.refundPayer,deadlineMs:Date.now()+3600000});x.vault.rheaOrders[0].status={id:x.packet.id,stage:'refunded',instruction:x.packet.instruction};await n.saveNearVault(s,x.vault);return s.identity.profile.id;});},c);
  await p.reload();await p.getByRole('button',{name:'Return to Lenz',exact:true}).waitFor();
  await check('failed local commit sends no deposit request and exposes no balance',async()=>{
    await p.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('Return commit failed');};});
    await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('could not save'));await idle(p);assert.equal(calls,0);assert.equal(await p.locator('#near-total').innerText(),'0');await p.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut;});
  });
  await check('lost deposit response recovers the same source and credits the refund once',async()=>{
    await p.route('**/api/rhea/return',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');},{times:1});
    await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#rhea-feedback').textContent.includes('internet connection'));await idle(p);assert.equal(await p.locator('#near-total').innerText(),'0');
    await p.reload();await p.getByRole('button',{name:'Return to Lenz',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3');await idle(p);assert.equal(debits,1);
    await p.getByRole('button',{name:'Check refund',exact:true}).click();await idle(p);assert.equal(await p.locator('#near-total').innerText(),'3');
  });
  const fixture=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),v=await(await import('/near-protocol.js')).readNearVault(s,c.reserve);return v.rheaOrders[0].returnRequest;},c);
  await fs.writeFile(path.join(__dirname,'../contracts/fixtures/browser-deposit.json'),JSON.stringify(fixture,null,2)+'\n');
  await check('returned funds remain encrypted and can transfer onward offline after reload',async()=>{
    await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));await idle(p);await ctx.setOffline(true);await p.reload();await p.waitForFunction(()=>document.querySelector('#near-total').textContent==='3');
    const result=await p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState(),n=await import('/near-protocol.js'),p=await import('/peer-crypto.js');const v=await n.readNearVault(s,c.reserve),b=await p.createIdentity('B'),d=await p.createIdentity('C');const ab=await n.makeNearPayment(v,s.identity,b.profile,'2'),vb=(await n.acceptNearPayment(n.emptyNearVault(c.reserve),b,s.identity.profile,ab.payload)).vault,bc=await n.makeNearPayment(vb,b,d.profile,'1'),vc=(await n.acceptNearPayment(n.emptyNearVault(c.reserve),d,b.profile,bc.payload)).vault;return {id:s.identity.profile.id,encrypted:!!s.nearBox&&!s.nearVault,amount:(await n.nearLedger(vc)).available.find(x=>x.owner===n.compressed(d.profile.signingPublic)).amount};},c);
    assert.equal(result.id,identityId);assert(result.encrypted);assert.equal(result.amount,'1000000');
  });
  await fs.writeFile(path.join(__dirname,'near-deposit-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,scope:'Isolated Edge; fixture chain refund/deposit, real signing, storage failures, lost-response handling and offline onward transfer. No live chain result in this suite.'},null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
