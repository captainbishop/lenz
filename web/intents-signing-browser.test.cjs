const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function run(){
 const {fixture,wallet,managerKey,now}=await import('./intents-spend-fixture.mjs'),offer=fixture();
 const modules=new Set(['/intents-spend.js','/intents-vendor/quote.js','/intents-vendor/codecs.js','/evm-vendor/offline-budget.js','/wallet-prompt.js']);
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private signing fixture</title>');return;}
  if(!modules.has(pathname)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'public',pathname)));}catch{res.writeHead(404);res.end();}
 });
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.exposeBinding('signFixture',async(_source,text)=>{assert.equal(text,offer.generated.intent.payload);return wallet.signMessage(text);});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async()=>{window.spend=await import('/intents-spend.js');window.quote=await import('/intents-vendor/quote.js');});
  await context.setOffline(true);page.on('request',request=>requests.push(request.url()));
  const result=await page.evaluate(async({offer,managerKey,now})=>{
   const methods=[],listeners=new Map();let sign=text=>signFixture(text);
   const provider={on:(name,handler)=>listeners.set(name,handler),removeListener:name=>listeners.delete(name),async request({method,params}){
    methods.push(method);if(['eth_requestAccounts','eth_accounts'].includes(method))return [offer.terms.owner];if(method==='eth_chainId')return '0x1';
    if(method==='personal_sign')return sign(new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/../g),byte=>parseInt(byte,16))));
    throw Error('Unexpected wallet method');
   }};
   const options={now:()=>now,verifySignature:q=>quote.verifyQuoteSignature(q,managerKey)},signed=await spend.signConfidentialSpend(provider,offer,options);
   const changed=structuredClone(offer);changed.quote.quoteRequest.recipient='0x'+'33'.repeat(20);const before=methods.length;
   let invalidRejected=false;try{await spend.signConfidentialSpend(provider,changed,options);}catch{invalidRejected=true;}
   const invalidReachedWallet=methods.length!==before;
   let ready,release;const started=new Promise(resolve=>ready=resolve);sign=()=>new Promise(resolve=>{release=resolve;ready();});
   const controller=new AbortController(),pending=spend.signConfidentialSpend(provider,offer,{...options,signal:controller.signal});
   const cancelled=pending.then(()=>false,()=>true);await started;controller.abort();const cancellationRejected=await cancelled;
   let duplicateBlocked=false;try{await spend.signConfidentialSpend(provider,offer,options);}catch(error){duplicateBlocked=/still open/.test(error.message);}
   release(await signFixture(offer.generated.intent.payload));
   // The caller's cancellation settles before the underlying wallet request.
   const until=performance.now()+5000;
   while(listeners.size&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,0));
   if(listeners.size)throw Error('Cancelled wallet request did not release its listeners');
   sign=text=>signFixture(text);const retry=await spend.signConfidentialSpend(provider,offer,options);
   return {offline:!navigator.onLine,signed,retry,invalidRejected,invalidReachedWallet,cancellationRejected,duplicateBlocked,listeners:listeners.size,methods};
  },{offer,managerKey,now});
  assert(result.offline);assert.equal(result.signed.payload,offer.generated.intent.payload);assert.equal(result.signed.standard,'erc191');
  assert(result.invalidRejected);assert.equal(result.invalidReachedWallet,false);
  assert(result.cancellationRejected);assert(result.duplicateBlocked);assert.equal(result.retry.payload,offer.generated.intent.payload);assert.equal(result.listeners,0);
  assert.deepEqual(new Set(result.methods),new Set(['eth_requestAccounts','eth_accounts','eth_chainId','personal_sign']));
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  return {passed:3,scope:'Loaded signing modules in offline Edge with a disposable wallet provider; no cache restart, installed-wallet, submission or settlement claim.'};
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
module.exports={run};if(require.main===module)run().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
