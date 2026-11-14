const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function fixture(mode,check){
 const requests=[],errors=[];let attempts=0;
 const server=http.createServer(async(req,res)=>{
  try{
   requests.push(req.url);res.setHeader('Cache-Control','no-store');
   const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><header><nav></nav></header><script type="module" src="/carrier-ui.js"></script>');return;}
   if(req.url==='/near-config.json'){json({network:'testnet',ready:true,contract:'reserve.lenz.testnet'});return;}
   if(req.url==='/rhea-config.json'){
    attempts++;if(mode==='stalled')return;
    if(attempts===1){res.writeHead(503);res.end();return;}
    json({network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'});return;
   }
   if(req.url==='/carrier-config.json'){json({version:1,carriers:[]});return;}
   if(req.url==='/nostr-config.json'){json({version:1,relays:[]});return;}
   if(/^\/[a-z0-9/-]+\.js$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'public',req.url.slice(1))));return;}
   res.writeHead(404);res.end();
  }catch(error){errors.push(error.message);res.writeHead(500);res.end();}
 });
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.deliveryTimers=[];window.setInterval=fn=>{deliveryTimers.push(fn);return deliveryTimers.length;};});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#carrier-status')?.textContent==='Create your profile to set up delivery.',null,{timeout:3000});
  assert(requests.includes('/carrier-config.json'));assert(requests.includes('/nostr-config.json'));
  await check({page,attempts:()=>attempts});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('automatic chat initializes while optional swap configuration is stalled',()=>fixture('stalled',async()=>{}));
test('a temporary swap configuration failure retries without a reload or connection change',()=>fixture('retry',async({page,attempts})=>{
 await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.endsWith('/rhea-config.json')));assert.equal(attempts(),1);
 const retried=page.waitForResponse(response=>response.url().endsWith('/rhea-config.json')&&response.ok(),{timeout:3000});
 await page.evaluate(()=>{const clock=Date.now;Date.now=()=>clock()+31000;for(const timer of deliveryTimers)timer();});
 await retried;assert.equal(attempts(),2);
}));
