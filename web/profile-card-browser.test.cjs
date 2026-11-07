const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),checks=[];
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(12000);
    await page.goto(base+'/chat.html');await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Private chat is ready'));
    const original=await page.evaluate(async()=>{
      const {createIdentity}=await import('/peer-crypto.js'),{updateState}=await import('/chat-store.js');
      return updateState(async state=>{state.identity=await createIdentity('Night Deer');state.identity.profile.avatar='moon';return state.identity.profile.id;});
    });await page.reload();await page.locator('#show-card').click();await page.locator('#share-contact[open]').waitFor();
    for(const [width,height]of [[390,844],[320,667],[1360,900]])for(const theme of ['light','dim','dark']){
      await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      const box=await page.locator('#share-contact').boundingBox();assert(box.width<=400&&box.height<=height-20);
      assert(await page.locator('#share-contact').evaluate(n=>n.scrollHeight<=n.clientHeight+1),'The normal ID card fits without internal scrolling');
      assert(await page.locator('#save-qr').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
      const qr=await page.locator('#contact-qr').screenshot();
      const decoded=await page.evaluate(async base64=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const {scanPixels,decodeContact}=await import('/contact-card.js');const value=scanPixels(img,img.width,img.height);return (await decodeContact(value)).id;},qr.toString('base64'));assert.equal(decoded,original);
      await page.locator('#share-contact').screenshot({path:path.join(os.tmpdir(),`lenz-id-card-${theme}-${width}.png`)});checks.push(`Card and all actions fit; displayed QR decodes at ${width}px in ${theme}`);
    }
    const full=await page.locator('#my-lenz-id').inputValue();await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedID=text;}}});});await page.locator('#copy-lenz-id').click();assert.equal(await page.evaluate(()=>window.copiedID),full);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('denied')};});await page.locator('#copy-lenz-id').click();assert(await page.locator('#share-contact .share-details').evaluate(n=>n.open));assert.equal(await page.evaluate(()=>document.activeElement.id),'my-lenz-id');checks.push('Copy preserves the complete ID; clipboard denial exposes the selectable ID');
    const download=page.waitForEvent('download');await page.locator('#save-qr').click();assert.equal((await download).suggestedFilename(),'lenz-id.png');checks.push('Save QR still downloads the contact image');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#share-contact').evaluate(n=>n.open),false);
    assert.equal(await page.evaluate(async()=> (await(await import('/chat-store.js')).readState()).identity.profile.id),original);checks.push('Closing and restyling preserve the account identity');
    await context.close();console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
