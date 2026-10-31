// Read-only check of the already settled preview payment. Never funds, signs,
// restores, submits a transaction or saves a wallet update.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const base='http://127.0.0.1:4173';
(async()=>{
  const evidence=JSON.parse(await fs.readFile(path.join(__dirname,'preview-flow-results.json')));
  const profiles=JSON.parse(await fs.readFile(path.join(__dirname,'offline-social-live-results.json'))).profiles;
  assert(evidence.complete&&evidence.finalTransaction.finality==='FINAL');
  const context=await chromium.launchPersistentContext(path.join(__dirname,'../contracts/.testnet/offline-social-live-2026-10-31/c'),{channel:'msedge',headless:true});
  const requests=[],errors=[];
  try{
    const p=context.pages()[0]||await context.newPage(),cdp=await context.newCDPSession(p);
    await cdp.send('Network.enable');await cdp.send('Network.setBypassServiceWorker',{bypass:true});await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    p.on('pageerror',e=>errors.push(e.message));
    await p.route('**/api/**',r=>{requests.push(new URL(r.request().url()).pathname);return r.request().url()===base+'/api/testnet/check'&&r.request().method()==='POST'?r.continue():r.abort();});
    await p.goto(base+'/chat.html');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
    const result=await p.evaluate(async({contract,noteId,owner,receipts})=>{
      const store=await import('/chat-store.js'),n=await import('/near-protocol.js'),status=await import('/near-payment-status.js');
      const before=await store.readState();if(before.identity.profile.id!==owner)throw Error('Unexpected disposable profile');
      const vault=await n.readNearVault(before,contract),{root,path}=await n.paymentPath(vault,noteId);
      const {digest}=await import('/peer-crypto.js'),ledger=await n.nearLedger(vault);
      const pathIds=await Promise.all(path.map(s=>digest(n.transferTerms(contract,s))));
      const ids=[root.id,...[...ledger.notes.keys()].filter(id=>pathIds.includes(id.split(':')[0]))];
      const response=await status.nearPaymentRequest('check',{contract,ids});
      const checked=await status.applyNearCheck(vault,ids,response);
      const allReceipts=pathIds.map(id=>response.results.find(r=>r.receipt?.id===id)?.receipt);
      for(const receipt of receipts)if(JSON.stringify(allReceipts.find(r=>r?.id===receipt.id))!==JSON.stringify(receipt))throw Error('Saved receipt differs from final chain state');
      const settled=await status.applyNearSettlement(vault,path,{finality:'FINAL',receipts:allReceipts});
      if(!checked.receipts[noteId.split(':')[0]]||!settled.receipts[noteId.split(':')[0]])throw Error('Missing final receipt');
      if(JSON.stringify(await store.readState())!==JSON.stringify(before))throw Error('Read-only check changed the saved account');
      return {checkedNotes:ids.length,receiptIds:pathIds,stateUnchanged:true};
    },{contract:evidence.reserve,noteId:evidence.receipts.at(-1).id+':0',owner:profiles.c.id,receipts:evidence.receipts});
    assert.deepEqual(requests,['/api/testnet/check']);assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(__dirname,'near-payment-status-live-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),reserve:evidence.reserve,...result,requests,errors,scope:'Read-only live final NEAR state for the existing preview receipt chain, validated against the saved signed path. No wallet writes, funding, signing, deployment or settlement. Conflicts/interrupted submissions remain fixture coverage.'},null,2)+'\n');
    console.log('PASS live receipt and note validation; saved disposable account unchanged; one read-only check, no transaction.');
  }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
