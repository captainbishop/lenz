const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const base=(process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173');
(async()=>{
 const files=['app-theme.js','theme-icon.js','theme-tokens.css','app-theme.css','chat-layout.css','money.css','near-wallet.css','home.css','home-defi.css','markets.css','degen.css','terminal.css','form-controls.css','wallet-portfolio.css','index.html','money.html','markets.html','routes.html','chat.html','account.html','recovery.html','home-videos.js','money.js','markets.js','routes.js','sw.js','chat-sw.js'].map(f=>'web/public/'+f).concat('web/theme-browser.test.cjs');
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex')]))),sources=await hashes();
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'reduce'}),page=await context.newPage(),checks=[];
 const screens=path.join(os.tmpdir(),'lenz-theme-review');await fs.mkdir(screens,{recursive:true});
 const choose=async(p,name)=>{await p.locator('#theme-toggle').click();await p.getByRole('menuitemradio',{name,exact:true}).click();};
 const theme=async(p,value)=>p.waitForFunction(v=>document.documentElement.dataset.theme===v,value);
 try{
  await context.route('**/api/**',route=>route.abort());await page.goto(base+'/money.html');
  await page.locator('#theme-toggle').click();await page.getByRole('menu',{name:'Appearance'}).waitFor({timeout:3000});
  for(const name of ['Auto','Light','Dim','Dark'])assert.equal(await page.getByRole('menuitemradio',{name,exact:true}).count(),1);
  await page.getByRole('menuitemradio',{name:'Dim',exact:true}).click();await theme(page,'dim');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-expanded'),'false');
  await page.reload();await theme(page,'dim');const second=await context.newPage();await second.goto(base+'/routes.html');await theme(second,'dim');
  await choose(second,'Dark');await theme(page,'dark');checks.push('Light, Dim, Dark and Auto use one saved preference across reloads, pages and tabs');
  await page.emulateMedia({colorScheme:'light'});await theme(page,'dark');await choose(page,'Auto');await theme(page,'light');await page.emulateMedia({colorScheme:'dark'});await theme(page,'dark');await page.emulateMedia({colorScheme:'light'});await theme(page,'light');checks.push('Auto follows system changes; an explicit appearance is not overridden');
  await page.locator('#theme-toggle').focus();await page.keyboard.press('Enter');await page.getByRole('menuitemradio',{name:'Auto',exact:true}).waitFor();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Auto');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await theme(page,'dim');assert.equal(await page.evaluate(()=>document.activeElement.id),'theme-toggle');await page.locator('#theme-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#theme-toggle').getAttribute('aria-expanded'),'false');checks.push('keyboard arrows, Home/End, selection and Escape preserve focus');
  const backgrounds=new Set();for(const mode of ['Light','Dim','Dark']){
   await choose(page,mode);await theme(page,mode.toLowerCase());backgrounds.add(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor));
   const contrast=await page.evaluate(()=>{
    const luma=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
    const ratio=(a,b)=>{const x=luma(a),y=luma(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const note=document.querySelector('.onboarding-note'),root=getComputedStyle(document.body),panel=getComputedStyle(document.querySelector('#theme-menu'));
    return {note:ratio(getComputedStyle(note).color,root.backgroundColor),menu:ratio(panel.color,panel.backgroundColor)};
   });assert(contrast.note>=4.5,mode+' onboarding text contrast '+contrast.note);assert(contrast.menu>=4.5,mode+' menu text contrast '+contrast.menu);
   await page.locator('#theme-toggle').click();assert.equal(await page.getByRole('menuitemradio',{name:mode,exact:true}).getAttribute('aria-checked'),'true');
   for(const width of [390,1280]){await page.setViewportSize({width,height:844});await page.screenshot({path:path.join(screens,mode.toLowerCase()+'-'+width+'.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.getByRole('menu',{name:'Appearance'}).boundingBox();assert(box.x>=8&&box.x+box.width<=width-8);}
   await page.keyboard.press('Escape');
  }assert.equal(backgrounds.size,3);checks.push('three distinct palettes and selected states fit phone and desktop with reduced motion');
  for(const url of ['/','/markets.html','/chat.html','/account.html','/recovery.html']){await page.goto(base+url);await theme(page,'dark');await page.locator('#theme-toggle').click();await page.getByRole('menu',{name:'Appearance'}).waitFor();await page.keyboard.press('Escape');}checks.push('homepage, markets, conversations, account and recovery expose the shared picker');
  await page.locator('#open-tab').click();await page.locator('#backup-phrase').fill('disposable unfinished recovery entry');await page.locator('#theme-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#backup-phrase').inputValue(),'disposable unfinished recovery entry');assert.equal(await page.evaluate(()=>document.activeElement.id),'theme-toggle');checks.push('Escape closes appearance without clearing an unfinished recovery form');
  const denied=await browser.newContext({colorScheme:'light'});await denied.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Blocked','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};});const blocked=await denied.newPage();await blocked.goto(base+'/money.html');await choose(blocked,'Dim');await blocked.emulateMedia({colorScheme:'dark'});await theme(blocked,'dim');await denied.close();checks.push('blocked preference storage keeps the explicit choice for the current page');
  assert.deepEqual(await hashes(),sources,'Theme sources changed during verification');
  await fs.writeFile(path.join(__dirname,'theme-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,sources,scope:'Disposable Edge contexts; public API calls blocked; no user account or wallet operations.'},null,2)+'\n');console.log('Passed '+checks.length+' theme browser groups.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
