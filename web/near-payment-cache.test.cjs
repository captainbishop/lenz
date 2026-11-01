// Existing-cache upgrade using a disposable Edge profile and fixture backing.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {securityHeaders}=require('./security-policy.mjs');
const previous='d6de54d5955b88e81b731c2a8436a315d291e696';
const old=new Map(['chat.html','money.html','chat-sw.js','chat.js','receive-packet.js','near-payment-status.js','near-chat.js','near-wallet.js','wallet-feedback.js','chat-layout.css'].map(f=>['/'+f,execFileSync('git',['show',previous+':web/public/'+f],{windowsHide:true})]));
let modern=false,fail=false,api=0;
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  if(file.startsWith('/api/')){api++;throw Error('No financial request allowed');}
  if(fail&&file==='/name-lab.js'){res.writeHead(503);res.end('Deliberately unavailable update');return;}
  res.end(!modern&&old.has(file)?old.get(file):await fs.readFile(path.join(__dirname,'public',file)));
}catch{res.writeHead(404);res.end('Unavailable');}});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext(),p=await context.newPage();
    await p.goto(base+'/money.html');await p.locator('#wallet-private').click();await p.locator('#wallet-content').waitFor();
    await p.evaluate(async()=>{
      const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js'),config=await(await fetch('/near-config.json')).json(),rhea=await(await fetch('/rhea-config.json')).json();
      await updateState(async s=>{
        const r=await n.fundingRequest(s.identity,config.contract,'10'),v=n.emptyNearVault(config.contract);v.roots.push({id:r.id,owner:r.owner,amount:r.amount});
        const reserved=await(await import('/rhea-protocol.js')).prepareRheaSwap(v,s.identity,rhea,{text:'10',minOutput:'1',receiver:'receiver.testnet',deadlineMs:101},100);
        await n.saveNearVault(s,reserved.vault);
      });
    });
    await p.locator('#prepare-money-offline').click();await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
    assert((await p.locator('#status').innerText()).includes('files saved'),await p.locator('#status').innerText());
    const snapshot=()=>p.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
    const before=await snapshot();
    const update=()=>p.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration('/chat.html');await registration.update();const worker=registration.installing??registration.waiting;
      if(!worker)throw Error('Expected update');
      return new Promise(resolve=>{const changed=()=>{if(['activated','redundant'].includes(worker.state))resolve(worker.state);};worker.addEventListener('statechange',changed);changed();});
    });
    modern=true;fail=true;assert.equal(await update(),'redundant');
    await context.setOffline(true);assert((await p.goto(base+'/chat.html')).fromServiceWorker());await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
    assert.equal(await snapshot(),before);console.log('PASS failed name-module cache update preserves old offline chat, identity and reservation');
    await context.setOffline(false);fail=false;assert.equal(await update(),'activated');
    await context.setOffline(true);assert((await p.reload()).fromServiceWorker());await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
    const cached=await p.evaluate(async()=>{const keys=await caches.keys(),key=keys.find(k=>k==='proof-u-chat-v33-simpler-flow');return !!key&&!!(await(await caches.open(key)).match('/name-lab.js'));});
    assert(cached);assert.equal(await snapshot(),before);assert.equal(await p.locator('#chat-balance').innerText(),'0 tUSD');assert.equal(api,0);
    console.log('PASS successful cache update loads name lookup code offline and preserves identity, encrypted vault and reservation');
    await fs.writeFile(path.join(__dirname,'near-payment-cache-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:2,failed:0,previous,apiRequests:api,scope:'Disposable Windows Edge, previous committed cache and modules; failed then successful update; fixture root and expired reservation, no financial request.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
