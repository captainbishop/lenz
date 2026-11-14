const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{try{
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);assert(file.startsWith(root+path.sep));
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 const templates=JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'),'utf8')).results.filter(r=>r.ok),sample=structuredClone(templates.find(r=>r.provider==='uniswap').observation),checks=[];
 try{
  for(const mode of ['normal','offline','stale','paused']){
   const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let release,started;
   const ready=new Promise(r=>started=r),delayed=new Promise(r=>release=r);
   if(mode==='paused')await page.addInitScript(()=>{const original=window.fetch;window.fetch=(url,options)=>original(url,String(url).endsWith('/api/markets/read')?{...options,signal:undefined}:options);});
   await page.route('**/api/**',async route=>{
    if(route.request().url().endsWith('/api/markets/read')&&route.request().postDataJSON().provider==='uniswap'&&!route.request().postDataJSON().network){
     started();if(mode==='offline'||mode==='paused')await delayed;
     const snapshot=structuredClone(sample);snapshot.observedAt=Date.now()-(mode==='stale'?120000:0);snapshot.expiresAt=snapshot.observedAt+60000;
     await route.fulfill({json:snapshot}).catch(()=>{});return;
    }
    await delayed;await route.fulfill({status:503,json:{error:'Fixture source still unavailable'}}).catch(()=>{});
   });
   await page.goto(base+'/markets.html');await ready;
   if(mode!=='normal'){
    if(mode==='offline')await context.setOffline(true);
    if(mode==='paused'){await page.locator('#data-settings>summary').click();await page.locator('#market-live').setChecked(false);}
    if(mode!=='stale')release();await page.waitForTimeout(150);assert.equal(await page.locator('#market-overview .overview-market').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-live-market-snapshots-v1')),null);
    checks.push(mode==='stale'?'Expired provider responses cannot render or save':mode==='paused'?'Paused reads cannot paint when the fetch implementation ignores abort':'Revoked public reads cannot paint after going offline');if(mode==='stale')release();
   }else{
    await page.locator('#market-overview .overview-market').first().waitFor({timeout:1500});
    assert.match(await page.locator('#market-overview .overview-market').first().textContent(),/fee/);
    assert.match(await page.locator('.overview-status').textContent(),/Loading market overview/);
    const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('lenz-live-market-snapshots-v1')));assert.equal(saved.length,1);assert.equal(saved[0].provider,'uniswap');
    checks.push('First validated market renders and saves before other providers or catalogue finish');release();
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log(JSON.stringify({passed:checks.length,checks}));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
