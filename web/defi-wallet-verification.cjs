// Serve each altered module only to a disposable test origin; preserve production files.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {run}=require('./defi-wallet-browser.test.cjs');
(async()=>{
  const file=path.join(__dirname,'public/defi-wallet.js'),source=await fs.readFile(file,'utf8');
  const baseline=await run(),mutations=[];
  const variants=[
    ['persist-vault','atomic approval',[["await saveNearVault(state,prepared.vault);",'']]],
    ['reuse-approval','repeated approval',[["if(existing) {","if(false && existing) {"]]],
    ['approved-terms','changed approval terms',[["assert(existing.defi.binding===binding, 'This approval id already has different terms');",'']]],
    ['input-snapshot','approval snapshots',[["s=structuredClone(swap)","s=swap"]]],
    ['save-expiry','expiry during encryption',[["assert(Date.now()<request.expiresAt, 'Approval expired before saving');",'']]],
    ['handoff-expiry','offline approval',[["await checkDefiRequest(c,state.identity.profile,order.defi.executor,request,Date.now());",''],["assert(Date.now()<request.expiresAt, 'Approval expired before handoff');",'']]],
    ['known-conflict','known input conflict',[["assert(!ledger.consumed.has(input) && !ledger.blocked.has(input), 'Reserved input has a known conflict');",'']]],
    ['packet-binding','known input conflict',[["assert(await digest(await openMessage(state.identity,a.executor,a.packet))===await digest(request), 'Saved handoff differs from its approval');",'']]],
    ['reservation-binding','a replaced reservation',[["assert(request.operation.kind==='rhea-swap' && await digest(request.operation.packet)===await digest(order.packet), 'Saved approval differs from its reservation');",'']]],
    ['packet-direction','a replaced reservation',[["assert(a.packet.from===request.sender && a.packet.to===request.executor, 'Saved handoff has the wrong direction');",'']]],
    ['receipt-time','forged, foreign',[["assert(receipt.storedAt<=Date.now()+60000, 'Storage receipt is in the future');",'']]],
  ];
  for(const [name,filter,changes]of variants){
    let altered=source;for(const [from,to]of changes){assert.equal(altered.split(from).length,2,'Unique alteration: '+name);altered=altered.replace(from,to);}
    let failure;try{await run({walletSource:altered,filter,record:false});}catch(e){failure=e;}
    assert(failure,'Alteration survived: '+name);assert(failure.message.startsWith(filter),failure.message);
    assert(!/SyntaxError|Cannot find module|Failed to fetch dynamically imported module/.test(failure.message),failure.message);
    assert(failure.code==='ERR_ASSERTION' || (name==='persist-vault' && /No saved executor approval/.test(failure.message)), 'Unexpected failure for '+name+': '+failure.message);
    mutations.push({name,detected:true,failedCase:filter});console.log('Detected '+name);
  }
  assert.equal(await fs.readFile(file,'utf8'),source,'Production source changed');
  const sourceFiles={...baseline.sourceFiles};sourceFiles['web/defi-wallet-verification.cjs']=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  await fs.writeFile(path.join(__dirname,'defi-wallet-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),browserTests:baseline.passed,mutations,sourceFiles,scope:baseline.scope},null,2)+'\n');
  console.log('Wallet approval checks: '+baseline.passed+' passed; '+mutations.length+' alterations detected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
