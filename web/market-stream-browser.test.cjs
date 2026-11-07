const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const {createMarketRoute}=await import('./market-relay.mjs'),{createMarketStream}=await import('./market-stream.mjs'),{tapeFixtures}=await import('../integrations/market-tape-fixtures.mjs');
  const root=path.join(__dirname,'public'),templates=JSON.parse(await fs.readFile(path.join(__dirname,'../integrations/market-discovery-live.json'))).results;
  const sockets=[],calls=[],errors=[],checks=[];let streamAdvance=0,historyUnavailable=false;
  class Socket extends EventTarget{
    readyState=0;sent=[];
    constructor(){super();sockets.push(this);setImmediate(()=>{if(this.readyState===3)return;this.readyState=1;this.dispatchEvent(new Event('open'));});}
    send(value){this.sent.push(JSON.parse(value));}close(){this.readyState=3;}
    emit(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
  }
  const route=createMarketRoute({stream:createMarketStream({Socket,clock:()=>Date.now()+streamAdvance,read:async r=>{if(historyUnavailable)throw Error('Fixture history unavailable');return tapeFixtures(r).snapshot;}}),discover:async(provider,options)=>{
    const template=templates.find(x=>x.provider===provider+(options?.network?':'+options.network:''));if(!template?.observation)throw Error('Fixture unavailable');
    const value=structuredClone(template.observation);value.observedAt=Date.now();value.expiresAt=value.observedAt+60000;
    if(provider==='hyperliquid'){const eth=value.rows.find(r=>r.instrument==='ETH');eth.id='hyperliquid:0:ETH';eth.venueIndex=0;value.rows=[eth];}return value;
  },tape:async r=>tapeFixtures(r).snapshot});
  const server=http.createServer(async(req,res)=>{try{
    if(req.url.startsWith('/api/')){calls.push(req.url);req.headers.host='127.0.0.1:4173';req.headers.origin='http://127.0.0.1:4173';if(await route(req,res))return;res.writeHead(503);res.end();return;}
    if(req.url==='/terminal-test.html'){
      const snapshot=structuredClone(templates.find(x=>x.provider==='hyperliquid').observation);snapshot.observedAt=Date.now();snapshot.expiresAt=Date.now()+60000;const row=snapshot.rows.find(r=>r.instrument==='ETH');row.id='hyperliquid:0:ETH';row.venueIndex=0;
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/markets.css"><link rel="stylesheet" href="/terminal.css"></head><body><main id="market-detail"></main><details id="data-settings" style="position:relative;z-index:2;background:var(--page);padding:20px"><summary>Data settings</summary><label><input type="checkbox" id="market-live" checked>Automatic updates</label></details><script type="module">import {mountPerpTerminal} from "/perp-terminal.js";mountPerpTerminal(document.querySelector("#market-detail"),'+JSON.stringify(row).replaceAll('<','\\u003c')+','+JSON.stringify(snapshot).replaceAll('<','\\u003c')+');document.querySelector("#market-live").onchange=()=>dispatchEvent(new Event("market-live-change"));</script></body></html>');return;
    }
    const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error();
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{for(const width of [1360,390]){
    const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('lenz-market-live-mode','on'));await page.goto(base+'/terminal-test.html');await page.locator('#candle-chart[data-candle-count]').waitFor();
    await page.mouse.move(0,0);await page.locator('#candle-chart').focus();await page.keyboard.press('End');const socket=sockets.at(-1);assert.equal(socket.sent[0].subscription.coin,'ETH');
    const f=tapeFixtures({marketId:'hyperliquid:0:ETH',interval:'1h',privacy:'public'});
    socket.emit({channel:'candle',data:{...f.history.at(-1),c:'3010',h:'3020',l:'2700'}});
    await page.waitForFunction(()=>document.querySelector('.chart-readout').textContent.includes('C 3,010')).catch(async e=>{console.error(JSON.stringify({width,subscriptions:socket.sent,socketState:socket.readyState,sockets:sockets.length,readout:await page.locator('.chart-readout').textContent(),status:await page.locator('#tape-status').textContent(),errors}));throw e;});
    assert.match(await page.locator('#tape-status').textContent(),/Streaming/);checks.push('Native '+width+'px chart updates from a pushed candle');
    const canvas=page.locator('#candle-chart');await canvas.focus();await page.keyboard.press('Home');const inspected=await page.locator('.chart-readout').textContent();await page.keyboard.press('ArrowRight');const nextInspected=await page.locator('.chart-readout').textContent();await page.keyboard.press('Home');
    socket.emit({channel:'candle',data:{...f.history.at(-1),c:'3011',h:'3020',l:'2700'}});
    await page.waitForTimeout(100);assert.equal(await page.locator('.chart-readout').textContent(),inspected,'Live updates must retain the candle being inspected');checks.push('Candle inspection survives live updates at '+width+'px');
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.chart-readout').textContent(),nextInspected,'Inspection must continue from the selected candle');
    await canvas.focus();await page.keyboard.press('End');await page.waitForFunction(()=>document.querySelector('.chart-readout').textContent.includes('C 3,011'));
    await page.locator('[data-interval="5m"]').click();await page.waitForFunction(()=>document.querySelector('#candle-chart')?.getAttribute('data-candle-count')==='96');
    await page.waitForTimeout(100);assert.equal(socket.readyState,3);const next=sockets.at(-1);assert.equal(next.sent[0].subscription.interval,'5m');
    const before=await page.locator('.chart-readout').textContent();socket.emit({channel:'candle',data:{...f.history.at(-1),c:'999999',h:'999999',l:'1'}});await page.waitForTimeout(50);assert.equal(await page.locator('.chart-readout').textContent(),before);checks.push('Interval changes close the old subscription and ignore its late events');
    next.dispatchEvent(new Event('close'));await page.waitForFunction(()=>document.querySelector('#tape-status').textContent.includes('Reconnecting'));
    await page.waitForTimeout(2300);assert(sockets.at(-1)!==next);assert(await page.locator('#candle-chart canvas').count()>0);checks.push('Reconnect restores history without blanking the chart');
    await page.locator('#data-settings summary').click();await page.locator('#market-live').uncheck();const count=sockets.length;await page.waitForTimeout(100);assert.equal(sockets.at(-1).readyState,3);assert.equal(sockets.length,count);checks.push('Turning live mode off releases the stream');
    const following=await page.evaluate(async source=>{
      const {drawDegenCandles,clearDegenCandles}=await import('/degen-chart.js'),target=document.querySelector('#candle-chart'),readout=document.querySelector('.chart-readout');clearDegenCandles(target);
      drawDegenCandles(target,source.slice(0,88),'ETH',readout,{intervalMs:3600000});await new Promise(requestAnimationFrame);
      drawDegenCandles(target,source,'ETH',readout,{intervalMs:3600000});await new Promise(requestAnimationFrame);
      return Number(target.dataset.chartFrom)+Number(target.dataset.visibleCandles);
    },f.snapshot.candles);assert(following>=95,'Latest candles must stay in view as new bars arrive');checks.push('Shared Perps/Degen renderer follows new bars while at the latest candle');
    await page.locator('#market-live').check();await page.waitForTimeout(150);
    const beforeHide=sockets.at(-1);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(100);assert.equal(beforeHide.readyState,3);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(150);assert.notEqual(sockets.at(-1),beforeHide);checks.push('Hiding the page releases its subscription and returning resumes it');
    const beforeOffline=sockets.at(-1);await context.setOffline(true);await page.waitForTimeout(100);assert.equal(beforeOffline.readyState,3);await context.setOffline(false);await page.waitForTimeout(150);assert.notEqual(sockets.at(-1),beforeOffline);checks.push('Offline retains the chart and reconnects only when live mode is enabled');
    historyUnavailable=true;streamAdvance=10800000;await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+10800000;});
    const streamCalls=calls.filter(x=>x==='/api/markets/stream').length;
    sockets.at(-1).emit({channel:'l2Book',data:{...f.book,time:Date.now()+streamAdvance}});
    await page.waitForFunction(()=>document.querySelector('#tape-status').textContent.includes('Chart delayed'));
    await page.waitForTimeout(2300);const recoveryCalls=calls.filter(x=>x==='/api/markets/stream').length-streamCalls;assert(recoveryCalls>=1&&recoveryCalls<=3);checks.push('Fresh books cannot hide old candles; history recovery is bounded');
    await page.screenshot({path:path.join(os.tmpdir(),'lenz-stream-'+width+'.png'),fullPage:true});await context.close();historyUnavailable=false;streamAdvance=0;
  }
  assert.deepEqual(errors,[]);assert(!calls.some(x=>/sign|transfer|accounts|settle/.test(x)));console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
