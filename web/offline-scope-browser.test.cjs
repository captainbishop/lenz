const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
async function upgrade({overrides={},record=true}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-offline-upgrade-'));
 const source=overrides['chat-sw.js']??await fs.readFile(path.join(__dirname,'public/chat-sw.js'),'utf8');
 // An older cache revision with the same module graph isolates worker ownership.
 const previous=source.replace(/const CACHE = '[^']+';/,"const CACHE = 'proof-u-chat-prior-opening-test';");
 let modern=false,context,serving=true;
 const server=http.createServer(async(req,res)=>{try{
  const file=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream');
  if(file==='/installation-test.html'){res.end('<!doctype html><title>Offline installation test</title>');return;}
  if(file==='/chat-sw.js'){res.end(modern?source:previous);return;}
  res.end(await fs.readFile(path.join(__dirname,'public',file.slice(1))));
 }catch{res.writeHead(404);res.end();}});
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'allow'});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];await page.goto(base+'/installation-test.html');
  const install=async(scope,update=false)=>page.evaluate(async({scope,update})=>{
   const r=update?await navigator.serviceWorker.getRegistration(scope):await navigator.serviceWorker.register('/chat-sw.js',{scope});if(update)await r.update();
   const worker=r.installing??r.waiting??r.active;
   if(worker.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);resolve();}else if(worker.state==='redundant'){worker.removeEventListener('statechange',changed);reject(Error('Installation failed'));}};worker.addEventListener('statechange',changed);changed();});
  },{scope,update});
  await install('/chat.html');await install('/money.html');modern=true;await install('/chat.html',true);
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  context=await open();await context.setOffline(true);page=context.pages()[0];
  const response=await page.goto(base+'/money.html').catch(()=>null);
  assert(response?.fromServiceWorker(),'Updating Conversations must preserve the older Wallet cache during an interrupted upgrade');
  await page.locator('#device-profile > summary').click();await page.locator('#wallet-private').click();await page.locator('#wallet-content').waitFor();
  const result={checkedAt:new Date().toISOString(),passed:1,failed:0,serverStopped:true,browserRestarted:true,partialUpgrade:true,scope:'Two real worker scopes with distinct cache revisions; synthetic previous revision using current module graph. No user account or financial operation.'};
  if(record&&process.env.LENZ_OFFLINE_REPORT)await fs.writeFile(process.env.LENZ_OFFLINE_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log('PASS an interrupted Conversations update preserves the older offline Wallet');return result;
 }finally{await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={run:upgrade};
if(require.main===module)upgrade().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
