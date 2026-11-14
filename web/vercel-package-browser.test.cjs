const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),os=require('node:os');

async function run(){
 const {buildVercelPreview}=await import('./build-vercel.mjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-vercel-browser-')),destination=path.join(directory,'package');
 let context,server,serving=false;const errors=[],blocked=[];
 try{
  const built=await buildVercelPreview({destination});
  const config=JSON.parse(await fs.readFile(path.join(destination,'vercel.json'),'utf8')),root=path.join(destination,'public');
  const unavailable=require(path.join(destination,'api/unavailable.js'));
  server=http.createServer(async(req,res)=>{
   try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    for(const rule of config.headers)if(rule.source==='/(.*)'||rule.source===pathname)for(const {key,value} of rule.headers)res.setHeader(key,value);
    if(pathname==='/api'||pathname.startsWith('/api/'))return unavailable(req,res);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));assert(file.startsWith(root+path.sep));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.mp4':'video/mp4','.wasm':'application/wasm','.webmanifest':'application/manifest+json'})[path.extname(file)]??'application/octet-stream');
    res.end(req.method==='HEAD'?undefined:await fs.readFile(file));
   }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));serving=true;
  const base='http://localhost:'+server.address().port,profile=path.join(directory,'profile');
  const launch=()=>chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:390,height:844}});
  context=await launch();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base)return route.continue();blocked.push(url.origin);return route.abort();});
  let page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(base+'/account.html?next=wallet');
  assert.match(response.headers()['content-security-policy'],/frame-ancestors 'none'/);
  await page.locator('#account-create-name').fill('Vercel package test');await page.locator('#account-local').click();await page.waitForURL('**/money.html');await page.locator('#wallet-content').waitFor();
  const identity=await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id);
  const failure=await page.evaluate(async()=>{const response=await fetch('/api/accounts/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return {status:response.status,body:await response.json()};});
  assert.equal(failure.status,503);assert.equal(failure.body.code,'BACKEND_UNAVAILABLE');
  await page.evaluate(async()=>await(await import('/offline-access.js')).ensureOfflineAccess());
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  context=await launch();await context.setOffline(true);page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/account.html?next=wallet','/money.html','/chat.html']){
   const loaded=await page.goto(base+route);assert(loaded.fromServiceWorker(),'Packaged route must reopen from its saved worker: '+route);
   await page.waitForFunction(()=>document.querySelector('#account-name,#my-name')?.textContent==='Vercel package test');
   assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),identity);
  }
  assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),files:built.files,bytes:built.bytes,passed:3,browserRestarted:true,serverStopped:true,apiUnavailable:true,blockedExternalOrigins:[...new Set(blocked)],scope:'Generated Vercel package exercised through a local HTTP fixture applying its headers and API rewrite. Real offline workers and fresh disposable Edge profile. Not Vercel CDN deployment, HTTPS trust, or first-time offline file delivery.'};
  if(process.env.LENZ_VERCEL_REPORT)await fs.writeFile(process.env.LENZ_VERCEL_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));return result;
 }finally{await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
