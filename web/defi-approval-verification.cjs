const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {run}=require('./defi-approval-browser.test.cjs');
(async()=>{
 const baseline=await run(),mutations=[];
 const variants=[
  ['update-file-size','defi-wallet-ui.js','invalid update files',"assert(file.size<=204800,'This update file is too large');",''],
  ['update-file-notice','defi-wallet-ui.js','an executor update file','Update file checked.','Update saved.'],
  ['private-policy','defi-workspace.js','private preference',"if($('#rhea-privacy').value!=='public-testnet')throw Error('You chose a private swap. This test swap is public, so it cannot continue.');",''],
  ['late-quote-privacy','rhea-wallet.js','DEX quote',"    requirePublicSwap();\n    if(q.request?","    if(q.request?"],
  ['quote-minimum','rhea-wallet.js','invalid quote',"if(q.request.slippageBps!==slippageBps||!/^[1-9][0-9]{0,38}$/.test(q.amountOut)||BigInt(q.minAmountOut)!==BigInt(q.amountOut)*BigInt(10000-slippageBps)/10000n)throw Error('Invalid quote minimum');",''],
  ['quote-slippage-race','rhea-wallet.js','invalid quote',"||Number($('#rhea-slippage').value)!==slippageBps",''],
  ['consent','defi-wallet-ui.js','review requires',"if(approving||!draft||!consent.checked)return;","if(approving||!draft)return;"],
  ['reviewed-terms','defi-wallet-ui.js','approval freezes','draft.executor,draft.swap,draft.consent','draft.executor,{...draft.swap,text:$(\'#rhea-amount\').value,receiver:$(\'#rhea-receiver\').value},draft.consent'],
  ['removed-contact','defi-wallet-ui.js','removing selected',"assert(current.contacts.some(p=>p.id===draft.executor.id),'This contact was removed. Go back and choose again');",''],
  ['carrier-consent','defi-wallet.js','absent carrier',"if(carrier)assert(state.carrier?.enabled===true, 'Turn on internet delivery before sending through carriers');",''],
  ['envelope-binding','defi-wallet.js','substituted saved',"assert(await digest(order.defi.envelope.packet)===await digest(order.defi.packet), 'Carrier handoff differs from the saved request');",''],
  ['persist-envelope','defi-wallet.js','encrypted file',"order.defi.envelope=await wrapForCarrier(state.identity,order.defi.packet,request.createdAt);\n        await saveNearVault(state,vault);","order.defi.envelope=await wrapForCarrier(state.identity,order.defi.packet,request.createdAt);"],
  ['ack-state','defi-delivery.js','expiry conflict',"ack.status==='stored'","true"],
 ];
 for(const [name,file,filter,from,to]of variants){
  const source=await fs.readFile(path.join(__dirname,'public',file),'utf8');assert.equal(source.split(from).length,2,'Unique alteration: '+name);
  let error;try{await run({overrides:{[file]:source.replace(from,to)},filter,record:false});}catch(e){error=e;}
  assert(error,'Surviving alteration: '+name);assert(error.message.startsWith(filter),error.message);assert(!/SyntaxError|Cannot find module/.test(error.message),error.message);
  assert(error.code==='ERR_ASSERTION','Unexpected failure: '+name+' '+error.message);
  mutations.push({name,detected:true,failedCase:filter});console.log('Detected '+name);
 }
 for(const [file,hash]of Object.entries(baseline.sourceFiles))assert.equal(createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex'),hash,file);
 const sourceFiles={...baseline.sourceFiles,'web/defi-approval-verification.cjs':createHash('sha256').update(await fs.readFile(__filename)).digest('hex')};
 await fs.writeFile(path.join(__dirname,'defi-approval-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),browserTests:baseline.passed,mutations,sourceFiles,scope:baseline.scope},null,2)+'\n');
 console.log(baseline.passed+' browser cases; '+mutations.length+' alterations detected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
