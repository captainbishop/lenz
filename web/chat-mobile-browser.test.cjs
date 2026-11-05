const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const base=process.env.LENZ_CHAT_TEST_BASE??'http://127.0.0.1:4173';
 const sourceFiles=['public/chat.html','public/chat.js','public/chat-layout.css','public/chat-sw.js','chat-mobile-browser.test.cjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>['web/'+f,require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(__dirname,f))).digest('hex')]))),sources=await hashes();
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[],checks=[];
 const idle=()=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
 try{
  await context.route('**/api/**',r=>r.abort());page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/chat.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
  await page.locator('#device-profile>summary').click();await page.locator('#continue-private').click();await idle();
  assert(await page.locator('.conversation').isVisible(),'a new mobile profile must open the message interface');assert(await page.locator('#message').isVisible());assert(await page.locator('#message').isDisabled());
  assert(!(await page.locator('.contacts').isVisible()));checks.push('new mobile profiles see the conversation and disabled composer before adding a contact');
  await page.locator('#back-people').click();assert(await page.locator('#show-card').isVisible());await page.locator('#close-people').click();assert(await page.locator('#message').isVisible());
  const profile=await page.evaluate(async()=>((await import('/peer-crypto.js')).createIdentity('Mina')).then(i=>i.profile));
  await page.locator('.empty-conversation button').click();await page.locator('#contact-file').setInputFiles({name:'contact.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(profile))});await page.locator('#contact-review').waitFor({state:'visible'});await page.locator('#verified').check();await page.locator('#confirm-contact').click();await idle();
  assert.equal(await page.locator('#conversation-name').innerText(),'Mina');await page.locator('#message').fill('A draft kept while looking at my people.');await page.locator('#back-people').click();await page.locator('#contact-list button').click();await idle();assert.equal(await page.locator('#message').inputValue(),'A draft kept while looking at my people.');checks.push('people list, contact import and return preserve the selected conversation and draft');
  await page.locator('#prepare-message').click();await page.locator('#handover').waitFor({state:'visible'});await page.keyboard.press('Escape');await idle();assert.match(await page.locator('.bubble').innerText(),/A draft kept while looking at my people/);assert.equal(await page.locator('#message').inputValue(),'');checks.push('the visible composer prepares encrypted history locally for the selected disposable contact');
  for(const [label,dialog]of [['About Lenz','#about-lenz'],['Delivery','#carrier-settings'],['Nearby','#nearby-dialog']]){
   await page.locator('#chat-options').click();await page.getByRole('button',{name:label,exact:true}).click();await page.locator(dialog).waitFor({state:'visible'});await page.keyboard.press('Escape');await page.locator(dialog).waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement.id),'chat-options',label+' must return focus to the visible menu button');assert(!(await page.locator('#chat-app-nav').evaluate(n=>n.matches(':popover-open'))));
  }
  await page.locator('#chat-options').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'chat-options');checks.push('compact options open existing actions and dismiss with Escape');
  const dir=path.join(os.tmpdir(),'lenz-chat-mobile-review');await fs.mkdir(dir,{recursive:true});
  for(const [width,height]of [[390,844],[320,568],[844,390],[1280,900]]){
   await page.setViewportSize({width,height});assert(await page.locator('#message').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('.composer').boundingBox();assert(box.y+box.height<=height+1,'composer must fit the viewport at '+width);
   if(width>1000)assert(await page.locator('.contacts').isVisible());await page.screenshot({path:path.join(dir,'chat-'+width+'.png')});
  }
  checks.push('message area and composer fit narrow phones, landscape and desktop without horizontal overflow');assert.deepEqual(errors,[]);
  assert.deepEqual(await hashes(),sources);await fs.writeFile(path.join(__dirname,'chat-mobile-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,sources,scope:'Disposable Edge profiles and contact; one locally encrypted message, no external delivery or financial requests.'},null,2)+'\n');console.log(checks);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
