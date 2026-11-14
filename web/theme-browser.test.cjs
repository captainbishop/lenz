const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {chooseTheme}=require('./theme-test-ui.cjs');
const base=(process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173');
(async()=>{
 const files=['app-theme.js','theme-icon.js','theme-tokens.css','app-theme.css','chat-layout.css','money.css','near-wallet.css','home.css','home-defi.css','markets.css','degen.css','terminal.css','form-controls.css','wallet-portfolio.css','index.html','money.html','markets.html','routes.html','chat.html','account.html','recovery.html','home-videos.js','money.js','markets.js','routes.js','sw.js','chat-sw.js'].map(f=>'web/public/'+f).concat('web/theme-browser.test.cjs');
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',file))).digest('hex')]))),sources=await hashes();
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'reduce'}),page=await context.newPage(),checks=[];
 const screens=path.join(os.tmpdir(),'lenz-theme-review');await fs.mkdir(screens,{recursive:true});
 const choose=(p,name)=>chooseTheme(p,name.toLowerCase());
 const theme=async(p,value)=>p.waitForFunction(v=>document.documentElement.dataset.theme===v,value);
 try{
  await context.route('**/api/**',route=>route.abort());await page.goto(base+'/money.html');
  await theme(page,'light');await page.emulateMedia({colorScheme:'dark'});await theme(page,'dark');await page.emulateMedia({colorScheme:'light'});await theme(page,'light');
  checks.push('initial appearance follows device changes before an explicit choice');
  for(const mode of ['dim','dark','light']){await page.locator('#theme-toggle').click();await theme(page,mode);assert.match(await page.locator('#theme-toggle').getAttribute('aria-label'),new RegExp('Appearance: '+mode));}
  assert.equal(await page.locator('#theme-menu').count(),0);assert.equal(await page.locator('#theme-toggle').getAttribute('aria-haspopup'),null);
  await choose(page,'Dim');await page.reload();await theme(page,'dim');const second=await context.newPage();await second.goto(base+'/routes.html');await theme(second,'dim');
  await choose(second,'Dark');await theme(page,'dark');await page.emulateMedia({colorScheme:'light'});await theme(page,'dark');
  checks.push('each click cycles Light, Dim, Dark; the preference persists across pages, reloads and tabs');
  await page.locator('#theme-toggle').focus();await page.keyboard.press('Enter');await theme(page,'light');await page.keyboard.press('Space');await theme(page,'dim');assert.equal(await page.evaluate(()=>document.activeElement.id),'theme-toggle');
  checks.push('Enter and Space cycle appearance without opening a menu or moving focus');
  const backgrounds=new Set();for(const mode of ['Light','Dim','Dark']){
   await choose(page,mode);await theme(page,mode.toLowerCase());backgrounds.add(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor));
   const contrast=await page.evaluate(()=>{
    const luma=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
    const ratio=(a,b)=>{const x=luma(a),y=luma(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const note=document.querySelector('.onboarding-note'),root=getComputedStyle(document.body);
    return {note:ratio(getComputedStyle(note).color,root.backgroundColor)};
   });assert(contrast.note>=4.5,mode+' onboarding text contrast '+contrast.note);
   assert.match(await page.locator('#theme-toggle').getAttribute('aria-label'),new RegExp('Appearance: '+mode.toLowerCase()));
   for(const width of [390,1280]){await page.setViewportSize({width,height:844});await page.screenshot({path:path.join(screens,mode.toLowerCase()+'-'+width+'.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('#theme-toggle').boundingBox();assert(box.width>=44&&box.height>=44);}
  }assert.equal(backgrounds.size,3);checks.push('three distinct palettes fit phone and desktop with an accessible theme target');
  for(const url of ['/','/markets.html','/chat.html','/account.html','/recovery.html']){await page.goto(base+url);await choose(page,'Light');await page.locator('#theme-toggle').click();await theme(page,'dim');assert.equal(await page.locator('#theme-menu').count(),0);}checks.push('homepage, markets, conversations, account and recovery use the shared cycle');
  await page.locator('#open-tab').click();await page.locator('#backup-phrase').fill('disposable unfinished recovery entry');await page.locator('#theme-toggle').click();assert.equal(await page.locator('#backup-phrase').inputValue(),'disposable unfinished recovery entry');assert.equal(await page.evaluate(()=>document.activeElement.id),'theme-toggle');checks.push('changing appearance preserves an unfinished recovery form');
  const denied=await browser.newContext({colorScheme:'light'});await denied.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Blocked','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};});const blocked=await denied.newPage();await blocked.goto(base+'/money.html');await choose(blocked,'Dim');await blocked.emulateMedia({colorScheme:'dark'});await theme(blocked,'dim');await denied.close();checks.push('blocked preference storage keeps the explicit choice for the current page');
  assert.deepEqual(await hashes(),sources,'Theme sources changed during verification');
  await fs.writeFile(path.join(__dirname,'theme-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,sources,scope:'Disposable Edge contexts; public API calls blocked; no user account or wallet operations.'},null,2)+'\n');console.log('Passed '+checks.length+' theme browser groups.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
