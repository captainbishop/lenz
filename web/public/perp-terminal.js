import {drawDegenCandles as drawCandles,clearDegenCandles as clearChart} from './degen-chart.js';
import {mountMarketQuote} from './market-quote-ui.js';
import {checkedTape,tapeRequest,CANDLE_INTERVALS} from './market-tape.js';
import {marketStream} from './market-stream.js';
import {mergeMarketEvent} from './market-stream-data.js';
import {tapeCache} from './market-tape-cache.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const number=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
let active=null;
export function clearPerpTerminal(){active?.();active=null;}
export function updatePerpMetrics(panel,row,snapshot){
  const values=[number(row.markPrice),number(row.oraclePrice),(Number(row.funding)*100).toFixed(5)+'%',number(row.openInterest)+' '+row.instrument];
  panel.querySelectorAll('.terminal-metrics dd').forEach((node,i)=>node.textContent=values[i]);
  panel.querySelector('.terminal-price').textContent=number(row.markPrice);
  panel.querySelector('.terminal-head').title='Hyperliquid mark/oracle · '+new Date(snapshot.observedAt).toLocaleTimeString();
}
export function mountPerpTerminal(panel,row,snapshot){
  clearPerpTerminal();panel.classList.add('perp-terminal');
  const head=el('div',undefined,'terminal-head'),instrument=el('div',undefined,'terminal-instrument');
  const name=el('div');name.append(el('p','Hyperliquid','terminal-overline'),el('h2',row.instrument+' / USD'));instrument.append(name);head.append(instrument,el('strong',number(row.markPrice),'terminal-price'));panel.replaceChildren(head);
  const metricsDetails=el('details',undefined,'terminal-details');metricsDetails.append(el('summary','Market details'));
  const metrics=el('dl',undefined,'terminal-metrics');for(const[k,v]of [['Mark',number(row.markPrice)],['Oracle',number(row.oraclePrice)],['Funding',(Number(row.funding)*100).toFixed(5)+'%'],['Open interest',number(row.openInterest)+' '+row.instrument]]){const cell=el('div');cell.append(el('dt',k),el('dd',v));metrics.append(cell);}metricsDetails.append(metrics);
  const grid=el('div',undefined,'terminal-grid'),chart=el('section',undefined,'terminal-chart'),book=el('section',undefined,'terminal-book'),ticket=el('section',undefined,'terminal-ticket');grid.append(chart,book,ticket);panel.append(grid);
  grid.dataset.pane='chart';const mobileNav=el('nav',undefined,'terminal-mobile-nav');mobileNav.setAttribute('aria-label','Trading view');for(const [pane,label]of [['chart','Chart'],['book','Book'],['order','Order']]){const button=el('button',label);button.type='button';button.dataset.pane=pane;button.setAttribute('aria-pressed',String(pane==='chart'));button.onclick=()=>{grid.dataset.pane=pane;for(const b of mobileNav.children)b.setAttribute('aria-pressed',String(b===button));};mobileNav.append(button);}panel.insertBefore(mobileNav,grid);
  const toolbar=el('div',undefined,'chart-toolbar'),intervals=el('div',undefined,'chart-intervals');intervals.setAttribute('aria-label','Candle interval');let interval='1h',tape=null,generation=0,controller=null,busy=false,liveBusy=false;
  const automatic=()=>document.querySelector('#market-live')?.checked===true;
  const history=tapeCache({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
  const restoreTape=()=>history.get(tapeRequest({marketId:row.id,interval,privacy:'public'}));
  for(const value of Object.keys(CANDLE_INTERVALS)){const b=el('button',value);b.type='button';b.dataset.interval=value;b.setAttribute('aria-pressed',String(value===interval));b.onclick=()=>{interval=value;invalidate();tape=restoreTape();paint();status.textContent=tape?'Saved · '+new Date(tape.observedAt).toLocaleTimeString():'Loading candles…';for(const n of intervals.children)n.setAttribute('aria-pressed',String(n===b));syncLive();if(!automatic())void load.onclick();};intervals.append(b);}
  const load=el('button');load.id='load-tape';load.type='button';load.setAttribute('aria-label','Refresh chart');load.title='Refresh chart';load.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/></svg>';toolbar.append(intervals,load);chart.append(toolbar);
  const readout=el('p','OHLC / USD','chart-readout'),canvas=el('div',undefined,'chart-canvas');canvas.id='candle-chart';chart.append(readout,canvas);
  const chartFoot=el('div',undefined,'chart-foot'),status=el('p','Loading candles…');status.id='tape-status';status.setAttribute('role','status');chartFoot.append(status);chart.append(chartFoot);
  const tableDetails=el('details',undefined,'candle-data');tableDetails.append(el('summary','Candle data'));chart.append(tableDetails);
  book.append(el('h3','Order book'));const bookLabel=el('div',undefined,'book-labels');bookLabel.append(el('span','Price / USD'),el('span','Size / '+row.instrument));book.append(bookLabel);const bookRows=el('div');bookRows.id='order-book';book.append(bookRows);
  mountMarketQuote(ticket,row);
  const account=el('details',undefined,'terminal-account');account.append(el('summary','Positions & orders'),el('p','Position and order reads unavailable.','account-empty'));panel.append(account,metricsDetails);
  const foot=el('div',undefined,'terminal-foot');foot.append(el('span','HyperCore · Public market data'),el('span','Funding & liquidation continue offline'));panel.append(foot);
  tape=restoreTape();
  function saveTape(){try{history.put(tape);}catch{}}
  function invalidate(){generation++;controller?.abort();controller=null;busy=false;update();}
  let chartRecoveryAt=0;
  function update(){
    load.disabled=busy||liveBusy||!navigator.onLine||document.hidden;const stale=tape&&Date.now()>=tape.expiresAt;
    if(tape&&(stale||!navigator.onLine))status.textContent=(!navigator.onLine?'Offline · Saved':'Book delayed')+' · '+new Date(tape.bookTime).toLocaleTimeString();
    const oldCandle=tape&&Date.now()-tape.candles.at(-1).time>2*CANDLE_INTERVALS[interval];
    if(oldCandle&&navigator.onLine){status.textContent='Chart delayed · Last candle '+new Date(tape.candles.at(-1).time).toLocaleString();if(automatic()&&!document.hidden&&!liveBusy&&Date.now()>=chartRecoveryAt){chartRecoveryAt=Date.now()+60000;queueMicrotask(()=>{if(panel.isConnected&&automatic()&&!document.hidden&&navigator.onLine)live.wake();});}}
    book.classList.toggle('book-stale',Boolean(stale||!navigator.onLine));
  }
  function paintChart(){
    tableDetails.querySelector('table')?.remove();if(!tape){clearChart(canvas);canvas.replaceChildren(el('span',navigator.onLine?'Loading candles...':'No saved candles','chart-empty'));readout.textContent='';return;}
    const candles=tape.candles;drawCandles(canvas,candles,row.instrument,readout,{intervalMs:CANDLE_INTERVALS[interval]});
    if(!tableDetails.open)return;
    const table=el('table'),thead=el('thead'),tr=el('tr');for(const label of ['Time','Open','High','Low','Close','Volume'])tr.append(el('th',label));thead.append(tr);const tbody=el('tbody');for(const c of candles){const tr=el('tr');for(const value of [new Date(c.time).toLocaleString(),c.open,c.high,c.low,c.close,c.volume])tr.append(el('td',value));tbody.append(tr);}table.append(thead,tbody);tableDetails.append(table);
  }
  tableDetails.addEventListener('toggle',()=>{if(tableDetails.open)paintChart();});
  function paint(){paintChart();paintBook();}
  function paintBook(){
    bookRows.replaceChildren();
    if(!tape){bookRows.append(el('p','Depth unavailable','book-empty'));return;}
    const levels=tape.levels.map(side=>side.slice(0,9)),maxSize=Math.max(...levels.flat().map(l=>Number(l.size)));
    const renderSide=(side,index)=>{const rows=index===1?[...side].reverse():side;const group=el('div',undefined,index===1?'book-asks':'book-bids');for(const l of rows){const line=el('div',undefined,'book-level');line.style.setProperty('--depth',Number(l.size)/maxSize*100+'%');line.append(el('span',number(l.price)),el('span',number(l.size)));group.append(line);}bookRows.append(group);};
    renderSide(levels[1],1);const spread=Number(levels[1][0].price)-Number(levels[0][0].price),mid=(Number(levels[0][0].price)+Number(levels[1][0].price))/2;const middle=el('div',undefined,'book-spread');middle.append(el('strong',number(mid)),el('small','Spread '+number(spread)));bookRows.append(middle);renderSide(levels[0],0);update();
  }
  let lastSave=0;
  const live=marketStream({request:()=>tapeRequest({marketId:row.id,interval,privacy:'public'}),allowed:()=>navigator.onLine&&!document.hidden&&automatic()&&panel.isConnected,
    accept:event=>{
      tape=mergeMarketEvent(tape,event);
      if(event.kind==='snapshot')paint();else if(event.kind==='book')paintBook();else if(tape)paintChart();
      if(Date.now()-lastSave>=2000){saveTape();lastSave=Date.now();}
    },
    status:value=>{liveBusy=value==='connecting';if(value==='streaming')status.textContent='Streaming · '+new Date().toLocaleTimeString();else if(value==='connecting')status.textContent=tape?'Saved · Connecting…':'Loading candles…';else if(value==='retrying')status.textContent=tape?'Reconnecting · Saved data':'Market data unavailable · Retrying';else if(value==='paused')status.textContent='Paused · Snapshot retained';else if(value==='off'&&tape)status.textContent='Snapshot '+new Date(tape.bookTime).toLocaleTimeString()+' · Hyperliquid';update();}
  });
  function syncLive(){invalidate();live.setEnabled(automatic());}
  load.onclick=async()=>{
    if(automatic()){live.wake();return;}
    if(busy||!navigator.onLine||document.hidden)return;const request=tapeRequest({marketId:row.id,interval,privacy:'public'}),ticket=++generation;controller=new AbortController();busy=true;update();status.textContent=tape?'Saved · Updating':'Loading candles…';
    try{const response=await fetch('/api/markets/tape',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Unavailable');const text=await response.text();if(text.length>262144)throw Error('Too large');const checked=checkedTape(JSON.parse(text),request);if(ticket!==generation||!navigator.onLine||document.hidden||!panel.isConnected)return;tape=checked;saveTape();paint();status.textContent='Saved · '+new Date(tape.bookTime).toLocaleTimeString();}
    catch{if(ticket===generation)status.textContent=tape?'Refresh failed · Earlier snapshot':'Market data unavailable · Retry';}finally{if(ticket===generation){busy=false;controller=null;update();}}
  };
  const connection=()=>{invalidate();live.wake();update();},visibility=()=>{if(document.hidden)invalidate();live.wake();};addEventListener('offline',connection);addEventListener('online',connection);addEventListener('market-live-change',syncLive);document.addEventListener('visibilitychange',visibility);const timer=setInterval(update,1000);active=()=>{clearChart(canvas);live.stop();invalidate();clearInterval(timer);removeEventListener('offline',connection);removeEventListener('online',connection);removeEventListener('market-live-change',syncLive);document.removeEventListener('visibilitychange',visibility);};paint();syncLive();if(!automatic())void load.onclick();
}
