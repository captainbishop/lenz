const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{chromium}=require('playwright');

test('empty person choices cannot open a blank menu and newly added contacts restore themed selection',async()=>{
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture'){res.setHeader('content-type','text/html');res.end('<html data-theme="dark"><head><link rel="stylesheet" href="/app-theme.css"><link rel="stylesheet" href="/theme-tokens.css"><link rel="stylesheet" href="/form-controls.css"><link rel="stylesheet" href="/nearby.css"><script type="module" src="/form-controls.js"></script></head><body><dialog id="nearby-dialog" open><label for="nearby-person">Person</label><select id="nearby-person" data-empty-label="No contacts yet" aria-describedby="nearby-empty"></select><p id="nearby-empty">Add and verify their Lenz ID first.</p></dialog></body></html>');return;}
  try{const file=path.resolve(root,'.'+req.url);assert(file.startsWith(root+path.sep));res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');const control=page.getByRole('combobox',{name:'Person',exact:true});await control.waitFor();
  assert(await control.isDisabled(),'Empty dropdown must have a disabled empty state');assert.equal(await control.innerText(),'No contacts yet');await control.evaluate(button=>button.click());assert.equal(await control.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('[role=listbox]:visible').count(),0);
  const evidence=process.env.LENZ_UI_EVIDENCE_DIR??path.join(os.tmpdir(),'lenz-dropdown-empty');await fs.mkdir(evidence,{recursive:true});
  for(const theme of ['light','dim','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await page.screenshot({path:path.join(evidence,'empty-person-'+theme+'.png')});}
  await page.evaluate(()=>{const select=document.querySelector('#nearby-person');select.append(new Option('Amina','a'),new Option('Bola','b'));document.querySelector('#nearby-empty').hidden=true;});assert.equal(await control.isDisabled(),false);
  for(const theme of ['light','dim','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await control.press('Enter');const menu=page.getByRole('listbox',{name:'Person',exact:true}),box=await menu.boundingBox();assert(box&&box.height>=88&&box.x>=0&&box.x+box.width<=390);assert(await menu.getByRole('option').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)));const focus=await control.evaluate(n=>{const s=getComputedStyle(n);return {color:s.color,outline:s.outlineColor};});assert.equal(focus.outline,focus.color);await page.screenshot({path:path.join(evidence,'person-keyboard-'+theme+'.png')});await control.press('Escape');}
  await control.press('ArrowDown');await control.press('End');await control.press('Enter');assert.equal(await page.locator('#nearby-person').inputValue(),'b');
  await control.click();await page.evaluate(()=>document.querySelector('#nearby-person').replaceChildren(new Option('No eligible people','',false,true)));await page.evaluate(()=>document.querySelector('#nearby-person option').disabled=true);assert(await control.isDisabled());assert.equal(await control.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('[role=listbox]:visible').count(),0);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('private payment busy-state updates preserve the empty executor dropdown and restore contacts',async()=>{
 const root=path.join(__dirname,'public'),requests=[],errors=[],server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname.startsWith('/api/')){requests.push(req.method);res.writeHead(503,{'content-type':'application/json'});res.end('{}');return;}
  try{const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(root+path.sep));res.setHeader('content-type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.wasm':'application/wasm','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/money.html');
  await page.locator('#device-profile>summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor({state:'visible'});
  await page.locator('#private-spend-open').evaluate(button=>button.click());await page.locator('#private-spend-dialog').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');
  const choice=page.getByRole('combobox',{name:'Send request through',exact:true});assert(await choice.isDisabled());assert.equal(await choice.innerText(),'No contacts yet');assert.match(await page.locator('#private-spend-executor-note').innerText(),/Add and verify a contact first/);await choice.evaluate(button=>button.click());assert.equal(await choice.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.lenz-choice-list:visible').count(),0);
  await page.locator('#private-spend-refresh').click();await page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert(await choice.isDisabled());
  await page.evaluate(async()=>{const store=await import('/chat-store.js'),peer=await import('/peer-crypto.js');await store.updateState(async s=>{s.contacts.push((await peer.createIdentity('Amina')).profile);});});
  await page.locator('#private-spend-refresh').click();await page.waitForFunction(()=>document.querySelector('#private-spend-dialog').getAttribute('aria-busy')==='false');assert.equal(await choice.isDisabled(),false);await choice.click();await page.getByRole('option',{name:'Amina',exact:true}).click();assert.equal(await page.locator('#private-spend-executor').inputValue(),await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).contacts[0].id));assert.deepEqual(errors,[]);assert(requests.every(method=>method==='GET'));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
