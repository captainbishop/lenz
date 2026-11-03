const {selectRecipient,openIncoming}=require('./wallet-test-ui.cjs');
// --run uses the deployed testnet contracts and three dedicated persistent Edge
// profiles. No mocked funding/RPC, new deployment or user's browser profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const base='http://127.0.0.1:4173',file=path.join(__dirname,'offline-social-live-results.json');
const privateRoot=path.resolve(__dirname,'../contracts/.testnet/offline-social-live-2026-10-31');
const sha=b=>createHash('sha256').update(b).digest('hex');
let ev,writeQueue=Promise.resolve(),currentStep='preflight';
async function save(){const text=JSON.stringify(ev,null,2)+'\n';writeQueue=writeQueue.then(async()=>{await fs.writeFile(file+'.tmp',text,{flush:true});await fs.rename(file+'.tmp',file);});await writeQueue;}
async function step(name,fn){currentStep=name;if(ev.steps[name])return ev.steps[name];console.log('RUN '+name);const result=await fn();ev.steps[name]=result??true;await save();console.log('PASS '+name);return result;}
const idle=p=>p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true',null,{timeout:420000});
async function ready(p,text){await p.waitForFunction(t=>document.querySelector('#status').textContent.includes(t),text);await idle(p);}
async function wallet(p){await p.goto(base+'/money.html');await ready(p,'Your wallet is ready');}
async function chat(p){await p.goto(base+'/chat.html');await ready(p,'Private chat is ready');}
async function state(p){return p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {profile:s.identity?.profile,contacts:s.contacts,messages:s.messages};});}
async function vault(p,contract){return p.evaluate(async contract=>{const s=await(await import('/chat-store.js')).readState();return (await import('/near-protocol.js')).readNearVault(s,contract);},contract);}
async function receive(p,packet){
  if((await state(p)).messages.some(r=>r.packet.id===packet.id))return;
  await p.locator('#receive-message').click();await p.locator('#incoming-file').setInputFiles({name:'live-payment.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await ready(p,'File loaded');await p.locator('#open-message').click();await idle(p);
  assert((await state(p)).messages.some(r=>r.packet.id===packet.id),'Incoming packet was not saved');
}
async function sendPayment(p,contract,recipient,amount,key,fromWallet=false){
  const v=await vault(p,contract),found=v.outbox.filter(o=>o.packet.to===recipient.id&&o.amount===String(BigInt(amount)*1000000n));assert(found.length<=1,'Ambiguous saved test payment');
  if(found.length){ev.packets[key]=found[0].packet;await save();return found[0].packet;}
  let packet;
  if(fromWallet){await wallet(p);await p.locator('#near-send').click();await selectRecipient(p,recipient.id);await p.locator('#near-send-amount').fill(amount);await p.locator('#near-send-form button[type=submit]').click();await idle(p);assert(await p.locator('#near-handover').isVisible(),'Payment not prepared');packet=(await vault(p,contract)).outbox.at(-1).packet;await p.locator('[data-close="near-handover"]').click();}
  else{await chat(p);await p.locator('#contact-list button').filter({hasText:recipient.name}).click();await idle(p);await p.locator('#pay-tusd').click();await idle(p);await p.locator('#chat-pay-amount').fill(amount);await p.locator('#chat-pay-submit').click();await idle(p);assert(await p.locator('#handover').isVisible(),'Chat payment not prepared');packet=JSON.parse(await p.locator('#outgoing').inputValue());await p.locator('[data-close="handover"]').click();}
  ev.packets[key]=packet;await save();return packet;
}
(async()=>{
  const nativeFetch=globalThis.fetch;globalThis.fetch=(u,i={})=>nativeFetch(u,{...i,signal:AbortSignal.any([AbortSignal.timeout(20000),...(i.signal?[i.signal]:[])])});
  const {provider,view,finalReceipt}=await import('../contracts/client.mjs'),{verifyAdapter}=await import('../contracts/adapter-client.mjs');
  const near=JSON.parse(await fs.readFile(path.join(__dirname,'public/near-config.json'))),rhea=JSON.parse(await fs.readFile(path.join(__dirname,'public/rhea-config.json')));
  assert(near.ready&&near.network==='testnet');assert.equal(rhea.reserve,near.contract);assert.equal(rhea.refundPayer,'lenz-dev-1792984696547.testnet');
  const recipient=rhea.refundPayer;
  const served=await(await fetch(base+'/api/testnet/status')).json();assert.deepEqual(served,near,'Local server serves another reserve');
  await verifyAdapter(rhea);
  const code=await provider.sendJsonRpc('query',{request_type:'view_code',finality:'final',account_id:near.contract});assert.equal(sha(Buffer.from(code.code_base64,'base64')),near.wasmSha256,'Reserve code changed');
  assert(await view(rhea.tokenOut,'storage_balance_of',{account_id:recipient}),'Signed recipient is not registered for output token');
  const balances=async()=>({supply:await view(near.contract,'ft_total_supply',{}),reserved:await view(near.contract,'reserved_balance',{}),reserve:await view(near.contract,'ft_balance_of',{account_id:near.contract}),adapter:await view(near.contract,'ft_balance_of',{account_id:rhea.adapter}),recipientOutput:await view(rhea.tokenOut,'ft_balance_of',{account_id:recipient})});
  if(!process.argv.includes('--run')){console.log(JSON.stringify({mode:'read-only plan',reserve:near.contract,adapter:rhea.adapter,recipient,grant:'10 tUSD',swap:'1 tUSD to wrapped test NEAR',profiles:privateRoot,scope:'Existing testnet deployment. UI funding, offline private chat/payments, onward transfer, final settlement and real Rhea execution.'},null,2));return;}
  try{ev=JSON.parse(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;}
  ev??={network:'testnet',reserve:near.contract,adapter:rhea.adapter,recipient,configHashes:{near:sha(JSON.stringify(near)),rhea:sha(JSON.stringify(rhea))},startedAt:new Date().toISOString(),steps:{},packets:{},requests:[],responses:[],failures:[],pageErrors:[]};
  assert.equal(ev.configHashes.near,sha(JSON.stringify(near)));assert.equal(ev.configHashes.rhea,sha(JSON.stringify(rhea)));
  if(ev.ok){console.log('Live run already complete; no funding or transactions repeated.');return;}
  await fs.mkdir(privateRoot,{recursive:true});const lock=await fs.open(path.join(privateRoot,'run.lock'),'wx');const contexts=[];let responseTasks=[];
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));await lock.sync();
    await step('record live backing before funding',async()=>{ev.before=await balances();assert.equal(ev.before.reserve,ev.before.reserved);return ev.before;});
    const pages=[];
    for(const [role,name] of [['a','Amina live'],['b','Bola live'],['c','Chidi live']]){
      const ctx=await chromium.launchPersistentContext(path.join(privateRoot,role),{channel:'msedge',headless:true,viewport:{width:1280,height:900},reducedMotion:'reduce'});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();pages.push(p);
      p.on('pageerror',e=>ev.pageErrors.push({role,error:e.message}));
      await p.route('**/api/**',async route=>{const r=route.request(),url=new URL(r.url());assert.equal(url.origin,base);assert.equal(r.method(),'POST');
        const allowed=['/api/testnet/fund','/api/testnet/settle','/api/testnet/check','/api/defi/rhea/quote','/api/rhea/submit','/api/rhea/advance','/api/rhea/order'];assert(allowed.includes(url.pathname),'Unexpected live action');
        ev.requests.push({role,step:currentStep,route:url.pathname,data:r.postDataJSON(),at:new Date().toISOString()});await save();await route.continue();
      });
      p.on('response',response=>{if(!response.url().includes('/api/'))return;const task=(async()=>{try{ev.responses.push({role,route:new URL(response.url()).pathname,status:response.status(),body:await response.json(),at:new Date().toISOString()});await save();}catch(e){ev.failures.push({step:'response recorder',error:e.message});}})();responseTasks.push(task);});
      await wallet(p);let s=await state(p);
      if(ev.profiles?.[role])assert.equal(s.profile?.id,ev.profiles[role].id,'Saved live profile is missing; do not create another funded identity');
      if(!s.profile){await p.locator('#wallet-name').fill(name);await p.locator('#wallet-identity-form button[type=submit]').click();await idle(p);s=await state(p);}
      ev.profiles??={};ev.profiles[role]=s.profile;await save();
    }
    const [a,b,c]=pages,{a:pa,b:pb,c:pc}=ev.profiles;
    await step('confirm contacts without replacing keys',async()=>{
      for(const [p,contact] of [[a,pb],[b,pa],[b,pc],[c,pb]])if(!(await state(p)).contacts.some(c=>c.id===contact.id)){await p.locator('#show-add-contact').click();await p.locator('#contact-file').setInputFiles({name:'contact.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(contact))});await p.locator('#contact-review').waitFor({state:'visible'});await p.locator('#verified').check();await p.locator('#confirm-contact').click();await idle(p);}
      return {a:pa.id,b:pb.id,c:pc.id};
    });
    await step('fund ten actual tUSD through the browser and verify final backing',async()=>{
      let v=await vault(a,near.contract);
      if(!v.roots.length){await a.locator('#near-fund').click();await a.locator('#near-fund-amount').fill('10');await a.locator('#near-fund-form button[type=submit]').click();await idle(a);v=await vault(a,near.contract);}
      assert.equal(v.funding?.amount,'10000000');assert.equal(v.roots.length,1);const root=v.roots[0];assert.deepEqual(await view(near.contract,'get_root',{id:root.id}),root);assert.equal(root.amount,'10000000');assert.equal(v.receipts[root.id].finality,'FINAL');
      ev.root=root;const after=await balances();assert.equal(BigInt(after.supply)-BigInt(ev.before.supply),10000000n);assert.equal(BigInt(after.reserve)-BigInt(ev.before.reserve),10000000n);return {root,receipt:v.receipts[root.id],balances:after};
    });
    await step('get an actual Rhea quote before going offline',async()=>{
      await b.locator('#rhea-open').click();await b.locator('#rhea-amount').fill('1');await b.locator('#rhea-quote').click();await idle(b);assert((await b.locator('#rhea-estimate').innerText()).startsWith('Estimate:'));
      ev.minimum=await b.locator('#rhea-minimum').inputValue();assert(ev.minimum&&Number(ev.minimum)>0);await b.locator('#rhea-close').click();return {minimum:ev.minimum};
    });
    for(const p of pages){await p.locator('#prepare-money-offline').click();await idle(p);await p.context().setOffline(true);await chat(p);assert(await p.evaluate(async()=>{try{await fetch('/social-live-uncached-probe');return false;}catch{return true;}}));}
    const offlineRequests=ev.requests.length;
    await step('private message handover with all three browsers offline',async()=>{
      let packet=ev.packets.message;
      if(!packet){const s=await state(a);packet=s.messages[0]?.packet;if(!packet){await a.locator('#message').fill('Our test payment can travel with this conversation.');await a.locator('#prepare-message').click();await idle(a);packet=JSON.parse(await a.locator('#outgoing').inputValue());await a.locator('[data-close="handover"]').click();}ev.packets.message=packet;await save();}
      await receive(b,packet);return {packetId:packet.id};
    });
    await step('offline A to B payment and B to C onward payment',async()=>{
      await receive(b,await sendPayment(a,near.contract,pb,'6','first'));await receive(c,await sendPayment(b,near.contract,pc,'2','second'));
      await chat(b);assert.equal(await b.locator('#chat-balance').innerText(),'4 tUSD');assert.equal(await c.locator('#chat-balance').innerText(),'2 tUSD');return {first:ev.packets.first.id,second:ev.packets.second.id};
    });
    await step('save one actual swap authorization offline and retain its reservation',async()=>{
      await wallet(b);let v=await vault(b,near.contract);
      if(!v.rheaOrders?.length){await b.locator('#rhea-open').click();await b.locator('#rhea-amount').fill('1');await b.locator('#rhea-minimum').fill(ev.minimum);await b.locator('#rhea-receiver').fill(recipient);await b.locator('#rhea-duration').selectOption('86400000');await b.locator('#rhea-form button[type=submit]').click();await idle(b);v=await vault(b,near.contract);}
      assert.equal(v.rheaOrders.length,1);ev.swap=v.rheaOrders[0].packet;assert.equal(ev.swap.instruction.amount,'1000000');assert.equal(ev.swap.instruction.receiver_id,recipient);assert(await b.getByRole('button',{name:'Start swap',exact:true}).isDisabled());return {id:ev.swap.id,input:ev.swap.instruction.input};
    });
    await step('wallet payment shares chat history and all offline balances survive reload',async()=>{
      await chat(c);await receive(c,await sendPayment(b,near.contract,pc,'1','third',true));
      for(const [p,value] of [[a,'4'],[b,'2'],[c,'3']]){await wallet(p);assert.equal(await p.locator('#near-total').innerText(),value);await chat(p);assert.equal(await p.locator('#chat-balance').innerText(),value+' tUSD');}
      assert.equal(ev.requests.length,offlineRequests,'Unexpected API call while offline');await b.screenshot({path:path.join(__dirname,'evidence/social-live-offline.png'),fullPage:true});return {available:{a:'4',b:'2',c:'3'},reserved:'1',apiCallsWhileOffline:0};
    });
    await step('reconnecting does not submit the saved swap',async()=>{
      await wallet(b);const count=ev.requests.length;await b.context().setOffline(false);await b.waitForFunction(()=>navigator.onLine);assert.equal(ev.requests.length,count);assert.equal(await view(rhea.adapter,'get_order',{id:ev.swap.id}),null);return {requestsOnReconnect:0};
    });
    await c.context().setOffline(false);await wallet(c);
    await step('confirm the complete onward payment history on NEAR',async()=>{
      const {digest}=await import('./public/peer-crypto.js'),{transferTerms,paymentPath}=await import('./public/near-protocol.js');
      const cv=await vault(c,near.contract),last=cv.spends.at(-1),id=await digest(transferTerms(near.contract,last));
      let receipt=await view(near.contract,'get_receipt',{id});
      if(!receipt){const row=c.locator('#near-payments .near-payment').filter({has:c.getByText('1 tUSD',{exact:true})});await row.getByRole('button',{name:'Confirm payment',exact:true}).click();await idle(c);receipt=await view(near.contract,'get_receipt',{id});}
      assert(receipt,'Final settlement receipt missing');const history=await paymentPath(cv,id+':0');ev.paymentReceipts=[];
      for(const spend of history.path){const rid=await digest(transferTerms(near.contract,spend)),r=await view(near.contract,'get_receipt',{id:rid});assert(r&&r.input===spend.input);assert.equal(r.outputs[0].owner,spend.recipient);assert.equal(r.outputs[0].amount,spend.amount);assert.equal(await view(near.contract,'spent_by',{id:spend.input}),rid);ev.paymentReceipts.push(r);}
      assert.equal(ev.paymentReceipts.length,4);return {receipts:ev.paymentReceipts};
    });
    await b.context().setOffline(false);await wallet(b);
    await step('execute the saved swap on Rhea and verify exact recipient output',async()=>{
      let order=await view(rhea.adapter,'get_order',{id:ev.swap.id});
      if(order?.stage!=='complete'){
        assert(!order||!['refunded','attention','rejected'].includes(order.stage),'Swap needs investigation; do not create a replacement');
        if(order){await b.getByRole('button',{name:'Check status',exact:true}).click();await idle(b);}
        const button=b.getByRole('button',{name:order?'Continue swap':'Start swap',exact:true});await button.click();await idle(b);order=await view(rhea.adapter,'get_order',{id:ev.swap.id});
      }
      assert.equal(order?.stage,'complete','Rhea has not completed this order');assert.deepEqual(order.instruction,ev.swap.instruction);assert(BigInt(order.output)>=BigInt(order.instruction.min_output));
      const after=await balances();assert.equal(BigInt(after.recipientOutput)-BigInt(ev.before.recipientOutput),BigInt(order.output));assert.equal(BigInt(after.supply)-BigInt(ev.before.supply),10000000n);assert.equal(BigInt(after.reserve)-BigInt(ev.before.reserve),9000000n);assert.equal(after.reserve,after.reserved);assert.equal(after.adapter,ev.before.adapter);
      ev.order=order;ev.after=after;await b.screenshot({path:path.join(__dirname,'evidence/social-live-swap.png'),fullPage:true});return {order,balances:after};
    });
    await step('read final on-chain notes and confirm the social receipt',async()=>{
      await c.locator('#near-refresh').click();await idle(c);await chat(c);assert(await c.getByText('Payment confirmed on NEAR',{exact:true}).count()>=1);
      const {nearLedger,compressed}=await import('./public/near-protocol.js');ev.finalNotes={};
      for(const [role,p,profile,amount] of [['a',a,pa,'4000000'],['b',b,pb,'2000000'],['c',c,pc,'3000000']]){
        const ledger=await nearLedger(await vault(p,near.contract)),notes=ledger.available.filter(n=>n.owner===compressed(profile.signingPublic));assert.equal(notes.reduce((s,n)=>s+BigInt(n.amount),0n).toString(),amount);
        for(const note of notes){assert.deepEqual(await view(near.contract,'get_note',{id:note.id}),note);assert.equal(await view(near.contract,'spent_by',{id:note.id}),null);}ev.finalNotes[role]=notes;
      }
      const {digest}=await import('./public/peer-crypto.js'),{redemptionTerms}=await import('./public/rhea-protocol.js');assert.equal(await view(near.contract,'spent_by',{id:ev.swap.instruction.input}),await digest(redemptionTerms(rhea,ev.swap.instruction)));
      await c.screenshot({path:path.join(__dirname,'evidence/social-live-confirmed-chat.png'),fullPage:true});return ev.finalNotes;
    });
    await Promise.all(responseTasks);
    await step('retrieve actual final transaction outcomes',async()=>{
      const hashes=[...new Set(ev.responses.map(r=>r.body.txHash).filter(Boolean))];assert(hashes.length>=3,'Missing transaction records');ev.transactions=[];
      for(const txHash of hashes){const tx=await provider.viewTransactionStatus({txHash,accountId:recipient,waitUntil:'FINAL'});finalReceipt(tx);ev.transactions.push(tx);}
      return {count:hashes.length,hashes};
    });
    assert.deepEqual(ev.pageErrors,[]);ev.ok=true;ev.completedAt=new Date().toISOString();ev.scope='Actual NEAR testnet mint/backing, four offline signed transfers, one Rhea swap and final notes/output. Persistent isolated Windows Edge profiles; no fixture funding, mocked RPC, new deployment, real-money assets or user browser profile.';await save();
    console.log(JSON.stringify({ok:true,checks:Object.keys(ev.steps).length,transactions:ev.transactions.length,reserve:ev.reserve,adapter:ev.adapter,grant:'10 tUSD',swap:'1 tUSD',output:ev.order.output,remainingOffline:{a:'4',b:'2',c:'3'}},null,2));
  }catch(e){ev.failures.push({step:currentStep,error:e.stack,at:new Date().toISOString()});await save();throw e;}
  finally{await Promise.all(contexts.map(c=>c.close()));await Promise.all(responseTasks);await writeQueue;await lock.close();await fs.unlink(path.join(privateRoot,'run.lock'));}
})().catch(e=>{console.error(e);process.exitCode=1;});
