const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

for(const worker of ['chat-sw.js','sw.js'])test(worker+' retains private outcome services after a full offline restart',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-private-cache-'));let context,serving=true;
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/install'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cache fixture</title>');return;}
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[pathname==='/'?'.html':path.extname(pathname)]??'application/octet-stream');
  try{res.end(await fs.readFile(path.join(__dirname,'public',pathname==='/'?'index.html':pathname)));}catch{res.writeHead(404);res.end();}
 });
 const open=()=>chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'allow'});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  context=await open();let page=context.pages()[0];await page.goto(base+'/install');
  await page.evaluate(async worker=>{
   const registration=await navigator.serviceWorker.register('/'+worker,{scope:worker==='sw.js'?'/':'/money.html'});
   const active=registration.installing??registration.waiting??registration.active;
   if(active.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(active.state==='activated')resolve();if(active.state==='redundant')reject(Error('Cache installation failed'));};active.addEventListener('statechange',changed);changed();});
  },worker);
  await context.close();context=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));serving=false;
  context=await open();await context.setOffline(true);page=context.pages()[0];
  const response=await page.goto(base+(worker==='sw.js'?'/':'/money.html'));assert(response.fromServiceWorker());
  const imports=await page.evaluate(async()=>{
   const [inbox,outbox,spend,status]=await Promise.all([import('/intents-courier.js'),import('/intents-spend-outbox.js'),import('/intents-spend.js'),import('/intents-status.js')]);
   return [inbox.observeConfidentialRequest,inbox.submitConfidentialRequest,outbox.confidentialSpendOutbox.acceptReport,spend.checkConfidentialSpend,status.checkConfidentialObservation].map(value=>typeof value);
  });
  assert.deepEqual(imports,Array(5).fill('function'));
 }finally{
  await context?.close();if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
 }
});
