const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const contract='status-fixture.lenz.testnet', checks=[], errors=[], requests=[];
let fixture, confirmed=false, mode='normal', releaseCheck, checkStarted, delayed=false;
const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [k,v] of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks));requests.push(file);
    if(file==='/api/testnet/settle'){
      confirmed=true;
      // Execution succeeded but the relay lost the chain response. Closing a
      // socket instead lets Chromium itself retry POSTs below the app layer.
      if(mode==='lost'||mode==='uncertain'){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Relay lost the final response'}));return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({finality:'FINAL',receipts:fixture.receipts}));return;
    }
    assert.equal(file,'/api/testnet/check');
    const results=data.ids.map(id=>{
      const root=id.startsWith('root:'), receipt=fixture.receipts.find(r=>id.startsWith(r.id+':'));
      return {id,note:root||confirmed?fixture.notes.find(n=>n.id===id):null,spent:root?(mode==='conflict'?'a'.repeat(64):confirmed?fixture.receipts[0].id:null):null,receipt:root||!confirmed?null:structuredClone(receipt)};
    });
    if((mode==='malformed'||mode==='uncertain')&&confirmed)for(const r of results)if(r.receipt)r.receipt.outputs[0].owner='wrong';
    if(mode==='delay'&&!delayed){delayed=true;checkStarted();await new Promise(r=>{releaseCheck=r;});}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({finality:'FINAL',results}));return;
  }
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  res.end(file==='/near-config.json'?JSON.stringify({network:'testnet',contract,ready:true}):file==='/rhea-config.json'?JSON.stringify({network:'testnet',reserve:contract,ready:false}):await fs.readFile(path.join(__dirname,'public',file)));
}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
async function vault(p){return p.evaluate(async c=>{const s=await(await import('/chat-store.js')).readState();return(await import('/near-protocol.js')).readNearVault(s,c);},contract);}
async function seed(p){
  confirmed=false;mode='normal';requests.length=0;delayed=false;
  fixture=await p.evaluate(async contract=>{
    const {createIdentity,digest}=await import('/peer-crypto.js'),n=await import('/near-protocol.js');
    const {prepareNearPayment}=await import('/near-payment-service.js'),{receivePacket}=await import('/receive-packet.js'),{updateState}=await import('/chat-store.js');
    const [a,b,c]=await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
    const sender={identity:a,contacts:[b.profile],messages:[]},receiver={identity:b,contacts:[a.profile,c.profile],messages:[]};
    const r=await n.fundingRequest(a,contract,'10'),v=n.emptyNearVault(contract);v.roots.push({id:r.id,owner:r.owner,amount:r.amount});await n.saveNearVault(sender,v);
    await receivePacket(receiver,await prepareNearPayment(sender,contract,b.profile.id,'6'),false,contract);
    await updateState(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,receiver);});
    const saved=await n.readNearVault(receiver,contract),l=await n.nearLedger(saved),id=await digest(n.transferTerms(contract,saved.spends[0]));
    return {note:id+':0',recipient:c.profile.id,notes:[...l.notes.values()],receipts:[{id,input:saved.spends[0].input,outputs:[...l.notes.values()].filter(n=>n.id.startsWith(id+':')),block_height:100}]};
  },contract);
  await p.reload();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('ready'));await idle(p);
}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.goto(base+'/money.html');await seed(p);
    await check('wallet rejects a final receipt with the right ID but the wrong recipient',async()=>{
      confirmed=true;mode='malformed';const before=await vault(p);
      await p.locator('#near-refresh').click();await idle(p);
      assert.deepEqual(await vault(p),before);assert((await p.locator('#near-feedback').innerText()).includes('could not verify'));
    });
    await check('chat confirms once and the open wallet reflects the same final payment',async()=>{
      await seed(p);const chat=await context.newPage();chat.on('pageerror',e=>errors.push(e.message));await chat.goto(base+'/chat.html');await idle(chat);
      await chat.locator('#contact-list button').filter({hasText:'Amina'}).click();await idle(chat);
      await chat.getByRole('button',{name:'Confirm payment',exact:true}).click();await idle(chat);
      await chat.getByText('Payment confirmed on NEAR',{exact:true}).waitFor();
      await p.waitForFunction(()=>document.querySelector('#near-payments').textContent.includes('Confirmed'));
      assert.equal(requests.filter(r=>r.endsWith('/settle')).length,1);assert.equal(await chat.locator('#chat-balance').innerText(),'6 tUSD');
      for(const theme of ['light','dark']){
        await chat.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
        for(const [width,height]of[[375,812],[812,375],[1280,900]]){await chat.setViewportSize({width,height});assert(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
        await chat.setViewportSize({width:375,height:812});await chat.screenshot({path:path.join(__dirname,'evidence/payment-status-'+theme+'.png'),fullPage:true});
      }
      await chat.close();
    });
    await check('a lost settlement response is recovered by a read, without resubmission',async()=>{
      await seed(p);mode='lost';const result=await p.evaluate(async({contract,note})=>(await import('/near-payment-status.js')).confirmNearPayment(contract,note),{contract,note:fixture.note});
      assert.deepEqual(result,{status:'confirmed',recovered:true});assert.equal(requests.filter(r=>r.endsWith('/settle')).length,1);
    });
    await check('concurrent tabs serialize confirmation and submit the signed path once',async()=>{
      await seed(p);const other=await context.newPage();await other.goto(base+'/money.html');await idle(other);
      const confirm=q=>q.evaluate(async({contract,note})=>(await import('/near-payment-status.js')).confirmNearPayment(contract,note),{contract,note:fixture.note});
      const results=await Promise.all([confirm(p),confirm(other)]);assert(results.every(r=>r.status==='confirmed'));assert.equal(requests.filter(r=>r.endsWith('/settle')).length,1);await other.close();
    });
    await check('an interrupted confirmation with an invalid recovery read remains uncertain and preserves both diagnostics',async()=>{
      await seed(p);mode='uncertain';
      const result=await p.evaluate(async({contract,note})=>{try{await(await import('/near-payment-status.js')).confirmNearPayment(contract,note);}catch(e){return{message:e.message,causes:e.errors?.map(e=>e.message)};}},{contract,note:fixture.note});
      assert(result.message.includes('uncertain'));assert.equal(result.causes.length,2);assert(result.causes[1].includes('does not match'));assert.equal((await vault(p)).receipts[fixture.receipts[0].id],undefined);assert.equal(requests.filter(r=>r.endsWith('/settle')).length,1);
    });
    await check('chat keeps a failed status check on the payment card without marking it confirmed',async()=>{
      await seed(p);mode='malformed';confirmed=true;await p.goto(base+'/chat.html');await idle(p);await p.locator('#contact-list button').filter({hasText:'Amina'}).click();await idle(p);
      await p.getByRole('button',{name:'Check status',exact:true}).click();await idle(p);
      assert((await p.locator('.near-payment-feedback').innerText()).includes('could not verify'));assert((await p.locator('.trade-state').innerText()).includes('awaiting online confirmation'));
      await p.goto(base+'/money.html');await idle(p);
    });
    await check('a delayed check preserves a newer onward payment, history and expired swap reservation',async()=>{
      await seed(p);mode='delay';const started=new Promise(r=>{checkStarted=r;});
      const running=p.evaluate(async c=>(await import('/near-payment-status.js')).refreshNearPayments(c),contract);await started;
      await p.evaluate(async({contract,recipient})=>{const {updateState}=await import('/chat-store.js'),n=await import('/near-protocol.js');await updateState(async s=>{
        await(await import('/near-payment-service.js')).prepareNearPayment(s,contract,recipient,'2');
        const v=await n.readNearVault(s,contract),l=await n.nearLedger(v),change=l.available.find(n=>n.owner===nOwner(s));
        function nOwner(s){return n.compressed(s.identity.profile.signingPublic);}
        v.rheaOrders=[{packet:{instruction:{input:change.id,deadline:1}}}];await n.saveNearVault(s,v);
      });},{contract,recipient:fixture.recipient});
      const latest=await vault(p);releaseCheck();await running;const after=await vault(p);
      assert.deepEqual(after.spends,latest.spends);assert.deepEqual(after.outbox,latest.outbox);assert.deepEqual(after.rheaOrders,latest.rheaOrders);
      assert.equal(await p.evaluate(async()=> (await(await import('/chat-store.js')).readState()).messages.length),2);
    });
    await check('a conflicting ancestor is shown in chat and wallet and confirmation is never submitted',async()=>{
      await seed(p);mode='conflict';await p.goto(base+'/chat.html');await idle(p);await p.locator('#contact-list button').filter({hasText:'Amina'}).click();await idle(p);
      await p.getByRole('button',{name:'Confirm payment',exact:true}).click();await idle(p);
      assert((await p.locator('.near-chat-card').innerText()).includes('could not be confirmed'));assert.equal(await p.locator('#chat-balance').innerText(),'0 tUSD');assert(!requests.some(r=>r.endsWith('/settle')));
      await p.goto(base+'/money.html');await idle(p);assert.equal(await p.locator('#near-total').innerText(),'0');assert((await p.locator('#near-payments').innerText()).includes('could not be confirmed'));
    });
    await check('offline controls send no requests; reconnect only enables explicit actions',async()=>{
      await seed(p);await context.setOffline(true);await p.waitForFunction(()=>document.querySelector('#near-refresh').disabled);
      assert(await p.getByRole('button',{name:'Confirm payment',exact:true}).isDisabled());assert(await p.locator('#near-send').isEnabled());
      const error=await p.evaluate(async c=>{try{await(await import('/near-payment-status.js')).refreshNearPayments(c);}catch(e){return e.message;}},contract);assert(error.includes('Reconnect'));
      await context.setOffline(false);await p.waitForFunction(()=>!document.querySelector('#near-refresh').disabled);assert.deepEqual(requests,[]);
      await p.goto(base+'/chat.html');await idle(p);await p.locator('#contact-list button').filter({hasText:'Amina'}).click();await idle(p);await context.setOffline(true);
      await p.waitForFunction(()=>document.querySelector('.near-payment-actions button').disabled);assert(await p.getByRole('button',{name:'Confirm payment',exact:true}).isDisabled());assert(await p.locator('#pay-tusd').isEnabled());
      await context.setOffline(false);await p.waitForFunction(()=>!document.querySelector('.near-payment-actions button').disabled);assert.deepEqual(requests,[]);
    });
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(__dirname,'near-payment-status-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,scope:'Disposable Windows Edge context, actual encryption/signatures/storage; fixture reserve and RPC responses. No live transactions, physical phones or Safari.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
