import {mountMarketQuote} from './market-quote-ui.js';
import {checkedTape,tapeRequest} from './market-tape.js';
import {liveRead} from './market-live.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const number=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
const svg=(name,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
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
  const toolbar=el('div',undefined,'chart-toolbar'),intervals=el('div',undefined,'chart-intervals');intervals.setAttribute('aria-label','Candle interval');let interval='1h',tape=null,shown=96,selectedCandle=null,generation=0,controller=null,busy=false,liveBusy=false;
  const automatic=()=>document.querySelector('#market-live')?.checked===true;
  for(const value of ['15m','1h','4h']){const b=el('button',value);b.type='button';b.dataset.interval=value;b.setAttribute('aria-pressed',String(value===interval));b.onclick=()=>{interval=value;invalidate();tape=null;paint();status.textContent='Loading candles…';for(const n of intervals.children)n.setAttribute('aria-pressed',String(n===b));syncLive();if(!automatic())void load.onclick();};intervals.append(b);}

  const load=el('button');load.id='load-tape';load.type='button';load.setAttribute('aria-label','Refresh chart');load.title='Refresh chart';load.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/></svg>';toolbar.append(intervals,load);chart.append(toolbar);
  const readout=el('p','OHLC / USD','chart-readout'),canvas=el('div',undefined,'chart-canvas');canvas.id='candle-chart';chart.append(readout,canvas);
  const chartFoot=el('div',undefined,'chart-foot'),status=el('p','Loading candles…');status.id='tape-status';status.setAttribute('role','status');const zoom=el('button','Last 48');zoom.type='button';zoom.disabled=true;zoom.onclick=()=>{shown=shown===96?48:96;zoom.textContent=shown===96?'Last 48':'Full range';paintChart();};chartFoot.append(status,zoom);chart.append(chartFoot);
  const tableDetails=el('details',undefined,'candle-data');tableDetails.append(el('summary','Candle data'));chart.append(tableDetails);
  book.append(el('h3','Order book'));const bookLabel=el('div',undefined,'book-labels');bookLabel.append(el('span','Price / USD'),el('span','Size / '+row.instrument));book.append(bookLabel);const bookRows=el('div');bookRows.id='order-book';book.append(bookRows);
  mountMarketQuote(ticket,row);
  const account=el('details',undefined,'terminal-account');account.append(el('summary','Positions & orders'),el('p','Position and order reads unavailable.','account-empty'));panel.append(account,metricsDetails);
  const foot=el('div',undefined,'terminal-foot');foot.append(el('span','HyperCore · Public market data'),el('span','Funding & liquidation continue offline'));panel.append(foot);
  try{const raw=localStorage.getItem('lenz-market-tape-v1');if(raw&&raw.length<=262144){const value=JSON.parse(raw);if(value.observedAt<=Date.now()+5000)tape=checkedTape(value,tapeRequest({marketId:row.id,interval,privacy:'public'}),{now:value.observedAt});}}catch{}
  function saveTape(){try{localStorage.setItem('lenz-market-tape-v1',JSON.stringify(tape));}catch{}}
  function invalidate(){generation++;controller?.abort();controller=null;busy=false;update();}
  function update(){load.disabled=busy||liveBusy||!navigator.onLine||document.hidden;const stale=tape&&Date.now()>=tape.expiresAt;if(tape&&(stale||!navigator.onLine))status.textContent=(!navigator.onLine?'Offline · Saved':'Stale')+' · '+new Date(tape.bookTime).toLocaleTimeString();book.classList.toggle('book-stale',Boolean(stale||!navigator.onLine));}
  function candleReadout(c){readout.textContent=new Date(c.time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'  ·  O '+number(c.open)+'  H '+number(c.high)+'  L '+number(c.low)+'  C '+number(c.close);}
  function paintChart(){
    const focused=canvas.contains(document.activeElement),previous=selectedCandle;canvas.replaceChildren();tableDetails.querySelector('table')?.remove();if(!tape){canvas.append(el('span',navigator.onLine?'Loading candles…':'No saved candles','chart-empty'));readout.textContent='';return;}
    const candles=tape.candles.slice(-shown),width=Math.max(300,canvas.clientWidth),height=Math.max(260,canvas.clientHeight),left=12,right=70,top=24,bottom=52,lo=Math.min(...candles.map(c=>Number(c.low))),hi=Math.max(...candles.map(c=>Number(c.high))),range=Math.max(hi-lo,hi*.001),y=p=>top+(hi+range*.08-Number(p))/(range*1.16)*(height-top-bottom),intervalMs=({ '15m':900000,'1h':3600000,'4h':14400000 })[interval],span=candles.at(-1).time-candles[0].time+intervalMs,step=(width-left-right)*intervalMs/span,x=i=>left+(candles[i].time-candles[0].time+intervalMs/2)/span*(width-left-right);
    const drawing=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':row.instrument+' candlesticks. Use arrow keys to read prices.',tabindex:'0'});canvas.append(drawing);
    const logoWidth=Math.min(280,(width-right-left)*.6),logoHeight=logoWidth*.4;
    const watermark=svg('g',{transform:`translate(${(width-right+left-logoWidth)/2} ${(height-bottom+top-logoHeight)/2}) scale(${logoWidth/360})`,class:'chart-watermark','aria-hidden':'true'});
    const mark=svg('g',{transform:'translate(0 8)',fill:'none',stroke:'var(--ink)','stroke-width':14,'stroke-linecap':'round','stroke-linejoin':'round'});
    mark.append(svg('path',{d:'M30 20 V78 Q30 98 50 98 H74'}),svg('path',{d:'M98 108 V50 Q98 30 78 30 H54'}));
    const wordmark=svg('text',{x:148,y:98,'font-size':82,'letter-spacing':-3});wordmark.textContent='Lenz';watermark.append(mark,wordmark);drawing.append(watermark);
    for(let i=0;i<5;i++){const price=hi-(hi-lo)*i/4,lineY=y(price);drawing.append(svg('line',{x1:0,x2:width-right,y1:lineY,y2:lineY,class:'chart-grid'}));const label=svg('text',{x:width-right+10,y:lineY+4,class:'axis-label'});label.textContent=number(price);drawing.append(label);}
    const volumes=Math.max(...candles.map(c=>Number(c.volume)),1);
    candles.forEach((c,i)=>{const up=Number(c.close)>=Number(c.open),g=svg('g',{'data-candle':i,class:up?'candle-up':'candle-down'}),bodyY=Math.min(y(c.open),y(c.close));g.append(svg('line',{x1:x(i),x2:x(i),y1:y(c.high),y2:y(c.low)}),svg('rect',{x:x(i)-Math.max(1,step*.29),y:bodyY,width:Math.max(2,step*.58),height:Math.max(1,Math.abs(y(c.open)-y(c.close)))}),svg('rect',{x:x(i)-step*.29,y:height-24-Number(c.volume)/volumes*28,width:step*.58,height:Number(c.volume)/volumes*28,class:'volume-bar'}));drawing.append(g);});
    for(const i of [0,Math.floor(candles.length/2),candles.length-1]){const label=svg('text',{x:x(i),y:height-3,'text-anchor':i===0?'start':i===candles.length-1?'end':'middle',class:'axis-label'});label.textContent=new Date(candles[i].time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit'});drawing.append(label);}
    const crosshair=svg('line',{x1:0,x2:0,y1:top,y2:height-bottom,class:'chart-crosshair',visibility:'hidden'});drawing.append(crosshair);
    const select=i=>{selectedCandle=Math.max(0,Math.min(candles.length-1,i));candleReadout(candles[selectedCandle]);crosshair.setAttribute('x1',x(selectedCandle));crosshair.setAttribute('x2',x(selectedCandle));crosshair.setAttribute('visibility','visible');};
    drawing.onpointermove=e=>{const bounds=drawing.getBoundingClientRect(),position=(e.clientX-bounds.left)/bounds.width*width;let nearest=0;for(let i=1;i<candles.length;i++)if(Math.abs(x(i)-position)<Math.abs(x(nearest)-position))nearest=i;select(nearest);};drawing.onfocus=()=>select(candles.length-1);drawing.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?candles.length-1:(selectedCandle??candles.length-1)+(e.key==='ArrowLeft'?-1:1));}};candleReadout(candles.at(-1));
    if(focused){drawing.focus({preventScroll:true});select(previous??candles.length-1);}
    const table=el('table'),thead=el('thead'),tr=el('tr');for(const label of ['Time','Open','High','Low','Close','Volume'])tr.append(el('th',label));thead.append(tr);const tbody=el('tbody');for(const c of candles){const tr=el('tr');for(const value of [new Date(c.time).toLocaleString(),c.open,c.high,c.low,c.close,c.volume])tr.append(el('td',value));tbody.append(tr);}table.append(thead,tbody);tableDetails.append(table);
  }
  function paint(){
    paintChart();bookRows.replaceChildren();zoom.disabled=!tape;
    if(!tape){bookRows.append(el('p','Depth unavailable','book-empty'));return;}
    const levels=tape.levels.map(side=>side.slice(0,9)),maxSize=Math.max(...levels.flat().map(l=>Number(l.size)));
    const renderSide=(side,index)=>{const rows=index===1?[...side].reverse():side;const group=el('div',undefined,index===1?'book-asks':'book-bids');for(const l of rows){const line=el('div',undefined,'book-level');line.style.setProperty('--depth',Number(l.size)/maxSize*100+'%');line.append(el('span',number(l.price)),el('span',number(l.size)));group.append(line);}bookRows.append(group);};
    renderSide(levels[1],1);const spread=Number(levels[1][0].price)-Number(levels[0][0].price),mid=(Number(levels[0][0].price)+Number(levels[1][0].price))/2;const middle=el('div',undefined,'book-spread');middle.append(el('strong',number(mid)),el('small','Spread '+number(spread)));bookRows.append(middle);renderSide(levels[0],0);update();
  }
  const live=liveRead({period:10000,allowed:()=>navigator.onLine&&!document.hidden&&automatic()&&panel.isConnected,
    read:async signal=>{const request=tapeRequest({marketId:row.id,interval,privacy:'public'});const response=await fetch('/api/markets/tape',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Unavailable');const text=await response.text();if(text.length>262144)throw Error('Too large');const checked=checkedTape(JSON.parse(text),request);if(tape&&checked.bookTime<tape.bookTime)throw Error('Older book');return checked;},
    accept:checked=>{tape=checked;saveTape();paint();},
    status:value=>{liveBusy=value==='updating';if(value==='live')status.textContent='Live · '+new Date(tape.bookTime).toLocaleTimeString();else if(value==='retrying')status.textContent=tape?'Retrying · Earlier snapshot':'Market data unavailable · Retrying';else if(value==='paused')status.textContent='Paused · Snapshot retained';else if(value==='off'&&tape)status.textContent='Snapshot '+new Date(tape.bookTime).toLocaleTimeString()+' · Hyperliquid';update();}
  });
  function syncLive(){invalidate();live.setEnabled(automatic());}

  load.onclick=async()=>{
    if(automatic()){live.wake();return;}
    if(busy||!navigator.onLine||document.hidden)return;const request=tapeRequest({marketId:row.id,interval,privacy:'public'}),ticket=++generation;controller=new AbortController();busy=true;update();status.textContent='Loading candles…';
    try{const response=await fetch('/api/markets/tape',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Unavailable');const text=await response.text();if(text.length>262144)throw Error('Too large');const checked=checkedTape(JSON.parse(text),request);if(ticket!==generation||!navigator.onLine||document.hidden||!panel.isConnected)return;tape=checked;saveTape();paint();status.textContent='Saved · '+new Date(tape.bookTime).toLocaleTimeString();}
    catch{if(ticket===generation)status.textContent=tape?'Refresh failed · Earlier snapshot':'Market data unavailable · Retry';}finally{if(ticket===generation){busy=false;controller=null;update();}}
  };
  const resize=new ResizeObserver(()=>{if(tape&&canvas.clientWidth)paintChart();});resize.observe(canvas);
  const connection=()=>{invalidate();live.wake();update();},visibility=()=>{if(document.hidden)invalidate();live.wake();};addEventListener('offline',connection);addEventListener('online',connection);addEventListener('market-live-change',syncLive);document.addEventListener('visibilitychange',visibility);const timer=setInterval(update,1000);active=()=>{live.stop();invalidate();resize.disconnect();clearInterval(timer);removeEventListener('offline',connection);removeEventListener('online',connection);removeEventListener('market-live-change',syncLive);document.removeEventListener('visibilitychange',visibility);};paint();syncLive();if(!automatic())void load.onclick();
}
