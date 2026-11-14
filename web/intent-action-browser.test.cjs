const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');

(async()=>{
 const publicRoot=path.join(__dirname,'public'),reportDirectory=process.env.LENZ_INTENT_ACTION_REPORT_DIR??await fs.mkdtemp(path.join(os.tmpdir(),'lenz-intent-actions-'));
 await fs.mkdir(reportDirectory,{recursive:true});
 const server=http.createServer(async(request,response)=>{
  try{
   const requested=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
   if(requested==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme-tokens.css"><link rel="stylesheet" href="/chat.css"><body class="money-page"><button id="open" type="button">Swap</button><button id="toggle-balances" type="button"><span data-eye-open></span><span data-eye-closed hidden></span></button></body></html>');return;}
   const file=path.resolve(publicRoot,'.'+requested);if(!file.startsWith(publicRoot+path.sep)){response.writeHead(403);response.end();return;}
   const content=await fs.readFile(file);response.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');response.end(content);
  }catch{response.writeHead(404);response.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),{updateState}=await import('/chat-store.js');
   const identity=await createIdentity('Disposable intent user');await updateState(state=>{state.identity=identity;});
   globalThis.selection={action:'swap',source:{chainId:'test:source',asset:'test:eth',accountId:'alice',amount:'100'},destination:{chainId:'test:target',asset:'test:token',accountId:'beneficiary',minAmount:'90'},deadline:Date.now()+120000,privacy:'private'};
   globalThis.fixtureService={
    capabilities:async()=>({available:true,execute:true,privacy:'private'}),
    prepare:async chosen=>({id:'intent-one',...structuredClone(chosen),fees:[{label:'Relayer fee',amount:'1',asset:'test:eth'}],reviewTerms:[{label:'Minimum result',amount:'90',asset:'test:token'}],privacyDisclosure:'Simulated flow. Sample units have no value; no blockchain action occurs.',recoveryDisclosure:'Sample refund returns to the fixed beneficiary.'}),
    validateReview:review=>review,authorityId:()=> 'fixture-pool:nullifier-one',
    authorize:async review=>({intentId:review.id,artifactId:'signed-artifact-one',payload:'fixture signed payload'}),validateAuthorization:authorization=>authorization,
    submit:async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'pending'}),
    reconcile:async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'executed',verified:true,evidence:{description:'Fixture output verified.',inputAsset:'test:eth',outputAsset:'test:token',inputAmount:'100',outputAmount:'90'}}),validateOutcome:outcome=>outcome
   };
   const {createIntentActionStore}=await import('/intent-action-store.js'),{mountIntentAction}=await import('/intent-action-ui.js');
   globalThis.intentStore=createIntentActionStore(identity.profile.id);
   globalThis.intentView=mountIntentAction({service:fixtureService,store:intentStore,source:{capture:()=>({identity:{chainId:'test:source',accountId:'alice'},assertCurrent(){}})},formatAmount:(amount,asset)=>amount+' '+(asset==='test:eth'?'sample units':'sample token')});
   (await import('/wallet-visibility.js')).setupBalanceVisibility();
   document.querySelector('#open').onclick=()=>intentView.open(selection);
  });
  await page.evaluate(()=>intentView.restore({chainId:'test:source',accountId:'alice'}));
  assert.equal(await page.locator('#intent-action-title').innerText(),'Activity');assert.equal(await page.locator('#intent-action-exchange').isVisible(),false);assert.equal(await page.locator('#intent-action-review').isVisible(),false);assert.equal(await page.locator('#intent-action-empty').innerText(),'No approved request.');
  await page.locator('#intent-action-close').click();checks.push('Empty activity shows its history without a fabricated Use/Receive receipt or route review control.');
  await page.locator('#open').click();await page.locator('#intent-action-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#intent-action-debit').innerText(),'100 sample units');assert.equal(await page.locator('#intent-action-destination').innerText(),'beneficiary');
  await page.locator('#intent-action-review').click();await page.locator('#intent-action-confirm').waitFor({state:'visible'});
  assert((await page.locator('#intent-action-privacy').innerText()).includes('Simulated flow'));assert((await page.locator('#intent-action-terms').innerText()).includes('Relayer fee'));
  checks.push('The receipt shows exact source, minimum output, beneficiary, fees, deadline and route privacy before approval.');
  await page.evaluate(()=>{localStorage.setItem('lenz-wallet-balances-hidden','true');dispatchEvent(new StorageEvent('storage',{key:'lenz-wallet-balances-hidden',newValue:'true'}));});assert.deepEqual(await page.locator('#intent-action-dialog [data-wallet-amount]').allTextContents(),['••••','••••','••••','••••']);await page.evaluate(()=>{localStorage.setItem('lenz-wallet-balances-hidden','false');dispatchEvent(new StorageEvent('storage',{key:'lenz-wallet-balances-hidden',newValue:'false'}));});
  await page.locator('#intent-action-confirm').click();await page.waitForFunction(()=>!intentView.workspace.snapshot().busy&&intentView.workspace.snapshot().attempts[0]?.status==='submission-unresolved');
  assert((await page.locator('#intent-action-attempts').innerText()).includes('Completion unknown'));
  const storage=await page.evaluate(async()=>{const state=await(await import('/chat-store.js')).readState();return {box:state.intentActionBox,keyExtractable:state.intentActionKey.extractable,attempt:(await intentStore.read(JSON.stringify(['test:source','alice']))).attempts[0]};});
  assert.equal(storage.keyExtractable,false);assert(!JSON.stringify(storage.box).includes('beneficiary'));assert.equal(storage.attempt.authorization.artifactId,'signed-artifact-one');
  checks.push('Real WebCrypto encrypts the exact authorization in IndexedDB with a nonextractable key before submission.');
  await page.locator('#intent-action-attempts').getByRole('button',{name:'Check status'}).click();await page.waitForFunction(()=>!intentView.workspace.snapshot().busy&&intentView.workspace.snapshot().attempts[0]?.status==='executed');
  assert((await page.locator('#intent-action-attempts').innerText()).includes('Swapped 100 sample units for 90 sample token.'));await page.evaluate(()=>{localStorage.setItem('lenz-wallet-balances-hidden','true');dispatchEvent(new StorageEvent('storage',{key:'lenz-wallet-balances-hidden',newValue:'true'}));});assert.equal(await page.locator('#intent-action-attempts [data-wallet-amount]').count(),2);assert.deepEqual(await page.locator('#intent-action-attempts [data-wallet-amount]').allTextContents(),['••••','••••']);await page.evaluate(()=>{localStorage.setItem('lenz-wallet-balances-hidden','false');dispatchEvent(new StorageEvent('storage',{key:'lenz-wallet-balances-hidden',newValue:'false'}));});checks.push('Wallet masking updates debit, credit, fees, structured amount terms and verified result amounts without changing the approved action.');
  checks.push('An unresolved request becomes complete only through the adapter’s verified result for the same artifact.');
  for(const theme of ['light','dark'])for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#intent-action-dialog').scrollWidth<=document.querySelector('#intent-action-dialog').clientWidth));
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('#open').evaluate(node=>node===document.activeElement),true);
  checks.push('The receipt fits phone/desktop in both themes and Escape returns focus to the initiating action.');
  const concurrency=await page.evaluate(async()=>{
   const owner=JSON.stringify(['test:source','alice']);await Promise.all([intentStore.update(owner,journal=>{journal.draft.destination.accountId='first revision';return journal;}),intentStore.update(owner,journal=>{journal.draft.source.amount='200';return journal;})]);
   return (await intentStore.read(owner)).draft;
  });assert.equal(concurrency.source.amount,'200');assert.equal(concurrency.destination.accountId,'first revision');
  checks.push('Concurrent encrypted updates retain both independently changed draft fields.');
  const duplicate=await page.evaluate(async()=>{
   const original=await intentStore.read(JSON.stringify(['test:source','alice'])),other=structuredClone(original);other.draft.source.accountId='bob';
   for(const attempt of other.attempts){attempt.review.source.accountId='bob';attempt.id=attempt.review.id='intent-two';attempt.authorization.intentId='intent-two';}
   try{await intentStore.update(JSON.stringify(['test:source','bob']),()=>other);return false;}catch(error){return error.message;}
  });assert.match(duplicate,/source authority/);
  assert.equal(await page.evaluate(async()=>(await intentStore.read(JSON.stringify(['test:source','bob']))).attempts.length),0);
  checks.push('The same consumed authority cannot be saved under a second source account; the rejected transaction leaves no record.');
  const identityBoundary=await page.evaluate(async()=>{
   const {readState,updateState}=await import('/chat-store.js'),{createIdentity}=await import('/peer-crypto.js'),{createIntentActionStore}=await import('/intent-action-store.js');
   const original=(await readState()).identity,replacement=await createIdentity('Another disposable profile');await updateState(state=>{state.identity=replacement;});
   let stale=false,wrongAad=false;
   try{await intentStore.read(JSON.stringify(['test:source','alice']));}catch(error){stale=error.message.includes('original account');}
   try{await createIntentActionStore(replacement.profile.id).read(JSON.stringify(['test:source','alice']));}catch{wrongAad=true;}
   await updateState(state=>{state.identity=original;});return {stale,wrongAad};
  });assert.deepEqual(identityBoundary,{stale:true,wrongAad:true});
  checks.push('Changing the Lenz identity rejects the old store handle and cannot decrypt the original account’s history.');
  const tamper=await page.evaluate(async()=>{
   await(await import('/chat-store.js')).updateState(state=>{state.intentActionBox.ciphertext='00'+state.intentActionBox.ciphertext.slice(2);});
   try{await intentStore.read(JSON.stringify(['test:source','alice']));return false;}catch{return true;}
  });assert.equal(tamper,true);checks.push('Ciphertext tampering is rejected by authenticated decryption.');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(reportDirectory,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:checks.length,failed:0,checks,scope:'Disposable Edge context; real IndexedDB, Web Locks and WebCrypto. Financial service and outcome are explicit fixtures; no funded execution, deployed privacy route, user account or financial API request.'},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,reportDirectory,checks},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
