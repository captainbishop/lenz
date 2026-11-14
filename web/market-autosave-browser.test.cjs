const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');

const publicRoot=path.join(__dirname,'public');
const mime=file=>({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]??'application/octet-stream';
async function journey(run,{storageFailure=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-public-auto-save-'));
 const discovery=(await import('./market-testnet-fixtures.mjs')).testnetMarketReport(JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'))));
 let available=true,context,requests=[],override=null;
 const now=Date.now(),catalog={version:2,environment:'testnet',chainId:'hypercore:testnet',observedAt:now,unavailable:[],rows:[{environment:'testnet',chainId:'hypercore:testnet',id:'spot:1',kind:'spot',coin:'@1',venue:'HyperCore',name:'Fixture Coin / USDC',quote:{index:0,symbol:'USDC'},price:'42',previousPrice:'40',volume:'12345',openInterest:null,funding:null,sides:[],description:''}]};
 const assets={version:1,provider:'coingecko',observedAt:now,assets:[{key:'BTC',id:'bitcoin',name:'Bitcoin',price:12345,change:2,change7d:7,marketCap:1234567,volume:1234,supply:100,history:Array.from({length:168},()=>12345),updatedAt:now}]};
 const lending={version:2,environment:'testnet',chainId:'hypercore:testnet',provider:'hyperliquid',observedAt:now,executable:false,rows:[{id:'hyperlend:0',tokenIndex:0,symbol:'USDC',supplyAPR:3.25,borrowAPR:6.5,availableLiquidity:'1000',totalSupplied:'2000',totalBorrowed:'1000',ltvBps:7500,utilization:.5,price:'1',executable:false}]};
 const prediction=(provider,hydrated=true,id='opened')=>({version:provider==='hyperliquid'?2:1,...(provider==='hyperliquid'?{environment:'testnet',chainId:'hypercore:testnet'}:{}),provider,observedAt:now,events:provider==='polymarket'?[{id:provider+':'+id,provider,title:id==='opened'?'Opened fixture event':'Unopened fixture event',category:'Crypto',volume:100,volumeUnit:'USD',hydrated,observedAt:now,description:'Public event preview',markets:hydrated?[{id:'m1',title:'Fixture outcome',question:'Will the fixture resolve?',rules:'Fixture resolution rules',basis:'Market price',outcomes:[{name:'Yes',probability:.7},{name:'No',probability:.3}]}]:[]}]:[],nextCursor:null});
 const fixtures=(pathname,body)=>{
  if(pathname==='/api/markets/hyper-catalog')return catalog;
  if(pathname==='/api/markets/assets')return assets;
  if(pathname==='/api/markets/lending')return lending;
  if(pathname==='/api/markets/context')return {version:1,provider:'coinmarketcap',observedAt:now,marketCap:1000000,volume24h:100000,btcDominance:55.5};
  if(pathname==='/api/markets/indices')return {fearGreed:{value:42,classification:'Fear',updatedAt:now,observedAt:now},altcoinSeason:{value:28,updatedAt:now,observedAt:now}};
  if(pathname==='/api/markets/read'){
   const key=body.network?body.provider+':'+body.network:body.provider,s=structuredClone(discovery.results.find(x=>x.provider===key)?.observation);
   if(s){s.observedAt=now;s.expiresAt=now+60000;}return s;
  }
  if(pathname==='/api/markets/predictions')return body.eventId?prediction(body.provider,true,body.eventId):{...prediction(body.provider),events:[...prediction(body.provider).events,...prediction(body.provider,true,'unopened').events]};
 };
 const serveFile=async pathname=>{const file=path.resolve(publicRoot,'.'+pathname);assert(file.startsWith(publicRoot+path.sep));return {body:await fs.readFile(file),contentType:mime(file)};};
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://local').pathname;
   if(pathname.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};requests.push({pathname,body});
    const value=available?(override?.(pathname,body)??fixtures(pathname,body)):null;
    if(value===undefined||value===null){res.writeHead(503);res.end('Unavailable');return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return;
   }
   const file=await serveFile(pathname);res.setHeader('content-type',file.contentType);res.setHeader('cache-control','no-store');res.end(file.body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const open=async()=>{
  context=await chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'msedge',headless:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','off'));
  if(storageFailure)await context.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key!=='lenz-market-live-mode')throw new DOMException('Full','QuotaExceededError');return set.call(this,key,value);};});
  return context.pages()[0];
 };
 try{
  let page=await open();await page.goto(base+'/markets.html?view=liquidity');
  await page.locator('#data-settings > summary').click();await page.locator('#market-live').uncheck();await page.locator('#data-settings > summary').click();
  await run({page,context,base,catalog,now,requests,getRequests:()=>requests,setOverride:value=>override=value,
   async restart(route){
    await context.close();context=null;available=false;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    page=await open();await context.setOffline(true);
    // Fixture delivery isolates market persistence from the application-file readiness journey.
    await context.route(base+'/**',async route=>{
     const pathname=new URL(route.request().url()).pathname;
     if(pathname.startsWith('/api/'))return route.abort();
     try{await route.fulfill(await serveFile(pathname));}catch{await route.abort();}
    });
    await page.goto(base+route);assert.equal(await page.evaluate(()=>navigator.onLine),false);return page;
   }});
 }finally{
  await context?.close();if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});
 }
}

test('manual public market reads survive an offline browser restart with automatic updates disabled',async()=>{
 await journey(async({page,restart})=>{
  await page.getByRole('button',{name:'Refresh markets',exact:true}).click();
  await page.locator('.market-row').first().waitFor();
  const rows=await page.locator('.market-row').count(),first=await page.locator('.market-row strong').first().textContent();
  page=await restart('/markets.html?view=liquidity');
  await page.locator('.market-row').first().waitFor({timeout:7000});
  assert.equal(await page.locator('.market-row').count(),rows);
  assert.equal(await page.locator('.market-row strong').first().textContent(),first);
  assert.match(await page.locator('.source-item').first().textContent(),/Saved/i);
  assert.equal(await page.locator('#market-live').isChecked(),false);
 });
});

test('overview catalogue and market pulse reopen automatically saved offline',async()=>{
 await journey(async({page,restart})=>{
  await page.locator('[data-category="all"]').first().click();
  await page.locator('.overview-market').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.market-context')?.textContent.includes('1M'));
  page=await restart('/markets.html');
  await page.locator('.overview-market').first().waitFor({timeout:7000});
  assert.match(await page.locator('.market-context').innerText(),/1M/);
  assert.equal(await page.getByRole('button',{name:/Save .*offline/}).count(),0);
 });
});
test('loaded prediction events and their outcomes survive offline restart',async()=>{
 await journey(async({page,restart})=>{
  await page.locator('[data-category="predictions"]').first().click();
  await page.getByRole('button',{name:/Opened fixture event/}).click();
  await page.locator('.prediction-detail-markets').waitFor();
  await page.keyboard.press('Escape');
  page=await restart('/markets.html?view=predictions');
  await page.getByRole('button',{name:/Opened fixture event/}).click({timeout:7000});
  await page.locator('.prediction-detail-markets').waitFor({timeout:7000});
  assert.match(await page.locator('.prediction-detail-markets').innerText(),/70%/);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/Unopened fixture event/}).click();
  assert.match(await page.locator('.prediction-detail-markets').innerText(),/70%/);
  assert.equal(await page.getByRole('button',{name:'Save events offline'}).count(),0);
 });
});
test('quota errors remain visible for manually refreshed markets',async()=>{
 await journey(async({page})=>{
  await page.getByRole('button',{name:'Refresh markets',exact:true}).click();
  await page.locator('.market-row').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#snapshot-status')?.textContent);
  await page.locator('#data-settings > summary').click();
  assert.match(await page.locator('#snapshot-status').innerText(),/could not be saved/i);
 },{storageFailure:true});
});

for(const boundary of ['hidden','offline','forget'])test('cancelled manual market replies cannot save after '+boundary,async()=>{
 await journey(async({page})=>{
  await page.evaluate(()=>{
   const original=fetch,read=document.querySelector('#refresh-markets').onclick;
   window.fixtureReleases=[];
   window.fetch=async(input,options)=>{
    if(String(input)!=='/api/markets/read')return original(input,options);
    const response=await original(input,{...options,signal:undefined});
    await new Promise(resolve=>fixtureReleases.push(resolve));return response;
   };
   document.querySelector('#refresh-markets').onclick=()=>window.fixtureRead=read();
  });
  await page.getByRole('button',{name:'Refresh markets',exact:true}).click();
  await page.waitForFunction(()=>fixtureReleases.length>0);
  if(boundary==='forget'){
   await page.locator('#data-settings > summary').click();
   await page.getByRole('button',{name:'Remove saved data',exact:true}).click();
  }else await page.evaluate(boundary=>{
   if(boundary==='hidden'){
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
   }else{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});dispatchEvent(new Event('offline'));
   }
  },boundary);
  await page.evaluate(async()=>{for(const release of fixtureReleases)release();await fixtureRead;});
  assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-live-market-snapshots-v1')),null);
 });
});

test('removed overview data clears the screen and an explicit refresh saves it again',async()=>{
 await journey(async({page})=>{
  await page.locator('[data-category="all"]').first().click();
  await page.locator('.overview-market').first().waitFor();

  await page.getByRole('button',{name:'Remove saved overview',exact:true}).click();
  assert.equal(await page.locator('.overview-market').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('lenz-market-context-v1')),null);
  await page.getByRole('button',{name:'Refresh overview',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('lenz-market-context-v1'));
  assert.ok(await page.evaluate(()=>localStorage.getItem('lenz-hyperliquid-testnet-catalog-v2')));
 });
});
