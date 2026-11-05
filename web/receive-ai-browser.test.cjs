const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],sent=[];
 const images=process.env.LENZ_RECEIVE_AI_EVIDENCE_DIR||path.join(os.tmpdir(),'lenz-receive-ai-review');await fs.mkdir(images,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let enabled=false,late=false,resolveLate,unverified=false;
  const tokens=[{assetId:'nep141:eth.omft.near',blockchain:'eth',symbol:'ETH',decimals:18},{assetId:'nep141:sol.omft.near',blockchain:'sol',symbol:'SOL',decimals:9},{assetId:'nep141:usdc.test.near',blockchain:'eth',symbol:'USDC',decimals:6,contractAddress:'0x'+'12'.repeat(20)}];
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();
   if(url.pathname==='/api/receive/assets')return route.fulfill({json:{tokens,observedAt:Date.now(),provider:'near-intents',depositAvailable:false,stale:false}});
   if(url.pathname==='/api/ai/status')return route.fulfill({json:{available:enabled,executable:false}});
   if(url.pathname==='/api/ai/challenge'){sent.push({kind:'challenge',body});return route.fulfill({json:{nonce:'a'.repeat(64)}});}
   if(url.pathname==='/api/ai/chat'){sent.push({kind:'chat',body});if(late)await new Promise(resolve=>resolveLate=resolve);return route.fulfill({json:{text:'<img src=x onerror=alert(1)> A limit order sets a price.',verified:!unverified,executable:false}}).catch(()=>{});}
   return route.abort();
  });
  const mountPreparedAI=async()=>{await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));assert.equal(await page.locator('#open-ai-chat').count(),0);await page.addStyleTag({url:'/ai-chat.css'});await page.addScriptTag({type:'module',url:'/ai-chat-ui.js'});await page.locator('#open-ai-chat').waitFor();};
  await page.goto('http://127.0.0.1:4173/chat.html');await mountPreparedAI();
  await page.evaluate(async()=>{const {createIdentity,sealMessage}=await import('/peer-crypto.js'),{updateState}=await import('/chat-store.js');const me=await createIdentity('Private Name'),peer=await createIdentity('Private Contact'),packet=await sealMessage(me,peer.profile,{kind:'chat',text:'Private message sentinel'});await updateState(s=>{s.identity=me;s.contacts=[peer.profile];s.messages=[{packet}];});});
  await page.reload();await mountPreparedAI();
  const state=()=>page.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState())),before=await state();
  await page.locator('#open-ai-chat').click();await page.getByText('Not connected yet',{exact:true}).waitFor();await page.locator('#ai-message').fill('Explain a limit order.');await page.locator('#ai-consent').check();assert(await page.locator('#ai-send').isDisabled());assert.equal(sent.length,0);await page.keyboard.press('Escape');
  checks.push('unconfigured AI accepts a local draft but cannot send, sign or copy personal chat context');
  enabled=true;await page.locator('#open-ai-chat').click();await page.getByText('Connected',{exact:true}).waitFor();assert(await page.locator('#ai-send').isDisabled());assert.equal(await page.locator('#ai-message').inputValue(),'');
  await page.locator('#ai-message').fill('Explain a limit order.');await page.locator('#ai-consent').check();await page.locator('#ai-send').click();await page.locator('#ai-messages .assistant').waitFor();
  assert.equal(await page.locator('#ai-messages img').count(),0);assert.match(await page.locator('#ai-messages').innerText(),/<img src=x/);assert.equal(sent.length,2);assert.deepEqual(Object.keys(sent[1].body).sort(),['identity','input','nonce','signature']);assert.deepEqual(Object.keys(sent[1].body.identity).sort(),['boxPublic','id','signingPublic']);assert.equal(sent[1].body.input.messages.length,1);assert(!JSON.stringify(sent).includes('Private'));assert.equal(await state(),before);
  checks.push('only explicitly typed AI text and minimal signed identity leave the browser; replies render as text and stored account bytes are unchanged');
  await page.locator('#ai-clear').click();assert.equal(await page.locator('#ai-messages').innerText(),'');assert(!await page.locator('#ai-consent').isChecked());
  late=true;await page.locator('#ai-message').fill('A slow question');await page.locator('#ai-consent').check();await page.locator('#ai-send').click();await page.waitForFunction(()=>!document.querySelector('#ai-stop').hidden);while(!resolveLate)await page.waitForTimeout(10);await page.locator('#ai-stop').click();resolveLate();await page.waitForTimeout(80);assert.equal(await page.locator('#ai-messages').innerText(),'');assert.equal(await page.locator('#ai-message').inputValue(),'A slow question');
  checks.push('stop aborts the local request, keeps the draft and rejects a late reply without retrying');
  late=false;unverified=true;await page.locator('#ai-send').click();await page.getByText('The AI reply could not be verified.',{exact:true}).waitFor();assert.equal(await page.locator('#ai-messages .assistant').count(),0);unverified=false;
  checks.push('unverified responses cannot appear in the conversation');
  for(const theme of ['light','dark'])for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(images,`ai-${theme}-${width}.png`)});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'open-ai-chat');await page.locator('#open-ai-chat').click();await page.getByText('Connected',{exact:true}).waitFor();assert.equal(await page.locator('#ai-message').inputValue(),'');assert.equal(await page.locator('#ai-messages').innerText(),'');await page.keyboard.press('Escape');
  checks.push('AI close clears its session and restores keyboard focus; both themes fit desktop and phone');
  await page.goto('http://127.0.0.1:4173/money.html');await page.locator('#wallet-content').waitFor();await page.locator('#wallet-receive').click();
  assert.equal(await page.getByRole('button',{name:'Find another asset',exact:true}).count(),0);assert.equal(await page.locator('#receive-assets-dialog').count(),0);
  assert.match(await page.locator('#wallet-asset-options').innerText(),/tUSD/);assert.equal(await state(),before);checks.push('Receive retains its working destinations and does not offer a catalogue as a receiving address');assert.deepEqual(errors,[]);
  await context.close();
  const files=['web/public/chat.html','web/public/ai-chat-ui.js','web/public/ai-chat.css','web/public/ai-conversation.js','web/public/receive-assets.js','web/public/wallet-portfolio.js','web/public/wallet-portfolio.css','web/receive-ai-browser.test.cjs'];const sourceHashes={};for(const file of files)sourceHashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  await fs.writeFile('web/receive-ai-browser-results.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Disposable Edge; prepared AI component explicitly mounted by the test and absent from normal chat; synthetic AI access/responses. No live inference, deposits or user account operations.',checks,sourceHashes},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
