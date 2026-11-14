const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
async function run(){
 const {fixture,wallet,managerKey,now}=await import('./intents-spend-fixture.mjs'),offer=fixture(),browser=await chromium.launch({channel:'msedge',headless:true});
 let online=true;const errors=[],offlineResponses=[];
 const server=http.createServer(async(req,res)=>{
  if(!online){res.writeHead(503);res.end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname,file=pathname==='/'?'/index.html':pathname;
  for(const [k,v]of Object.entries(securityHeaders(pathname)))res.setHeader(k,v);
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
  try{res.end(await fs.readFile(path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>r.abort());
  await page.goto(base+'/money.html');await page.waitForFunction(()=>document.querySelector('[data-offline-state]')?.dataset.offlineState==='ready',{},{timeout:60000});
  await context.setOffline(true);online=false;await page.reload();
  page.on('response',r=>offlineResponses.push({url:r.url(),cached:r.fromServiceWorker()}));
  await context.exposeBinding('offlineWalletSignature',async(_source,text)=>{assert.equal(text,offer.generated.intent.payload);return wallet.signMessage(text);});
  const result=await page.evaluate(async({offer,managerKey,now})=>{
   const {signConfidentialSpend}=await import('/intents-spend.js'),{verifyQuoteSignature}=await import('/intents-vendor/quote.js');
   const {createConfidentialSpendOutbox}=await import('/intents-spend-outbox.js');
   if(typeof createConfidentialSpendOutbox!=='function')throw Error('Offline approval storage is unavailable');
   const methods=[],handlers=new Map(),provider={on:(e,h)=>handlers.set(e,h),removeListener:e=>handlers.delete(e),async request({method,params}){
    methods.push(method);if(['eth_requestAccounts','eth_accounts'].includes(method))return [offer.terms.owner];if(method==='eth_chainId')return '0x1';
    if(method==='personal_sign')return offlineWalletSignature(new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/../g),b=>parseInt(b,16))));throw Error('Unexpected offline wallet request');
   }};
   const signed=await signConfidentialSpend(provider,offer,{now:()=>now,verifySignature:q=>verifyQuoteSignature(q,managerKey)});
   return {signed,methods,listeners:handlers.size,offline:!navigator.onLine};
  },{offer,managerKey,now});
  assert(result.offline);assert.equal(result.signed.payload,offer.generated.intent.payload);assert.equal(result.listeners,0);
  for(const module of ['/intents-spend.js','/intents-vendor/quote.js','/intents-spend-outbox.js'])assert(offlineResponses.some(r=>r.url===base+module&&r.cached),'Module missing from offline cache: '+module);
  assert(offlineResponses.every(r=>r.cached));assert.deepEqual(errors,[]);
  console.log('PASS private quote verification and exact owner signing load offline with a disposable provider');
  return {passed:1,methods:result.methods,scope:'Windows Edge offline cache and synthetic EIP1193 wallet; no installed-wallet compatibility, funds, submission or settlement.'};
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
module.exports={run};if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
