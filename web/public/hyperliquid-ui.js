import {workspaceHeading} from './workspace-heading.js';
import {HYPERLIQUID_KINDS,checkedHyperliquidCatalog,hyperliquidRequest} from './hyperliquid-catalog.js';
import {checkedHyperliquidEvent} from './hyperliquid-feed.js';
import {marketStream} from './market-stream.js';
import {mergeMarketEvent} from './market-stream-data.js';
import {CANDLE_INTERVALS} from './market-tape.js';
import {drawDegenCandles,clearDegenCandles,priceText} from './degen-chart.js';
import {marketLogo} from './market-logo.js';
import {mountHyperliquidTrading,clearHyperliquidTrading} from './hyperliquid-order-ui.js';

const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const button=(text,action)=>{const e=node('button',text);e.type='button';e.onclick=action;return e;};
const utilityPaths={refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3A7 7 0 0 0 18 17',save:'M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5',remove:'M4 7h16 M9 7V3h6v4 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',previous:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7'};
function iconButton(label,icon,action){
  const b=button('',action),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
  b.className='hyper-icon-button';b.setAttribute('aria-label',label);b.title=label;svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',utilityPaths[icon]);svg.append(path);b.append(svg);return b;
}
const savedKey='lenz-hyperliquid-catalog-v1';
const time=value=>Date.now()-value<86400000?new Date(value).toLocaleTimeString():new Date(value).toLocaleString();
const price=value=>value===null||value===undefined?'—':priceText(value);

export function mountHyperliquid(target){
  let missingSelection=false,preferred=null,visible=false,catalog=null,selected=null,side=0,kind='all',venue='',search='',page=0,interval='1m',tape=null,trades=[],generation=0,readAbort=null,catalogAbort=null,streamState='off',loaded=false,saveError='';
  const enabled=()=>Boolean(document.querySelector('#market-live')?.checked);
  const allowed=()=>visible&&navigator.onLine&&!document.hidden;
  const request=()=>hyperliquidRequest({marketId:`hypercore:${selected.kind}:${selected.sides[side]?.coin??selected.coin}`,interval,privacy:'public'});
  target.classList.add('hyper-workspace');
  const hero=workspaceHeading({title:'Markets',description:'Explore supported trading markets.'}),intro=hero.element,heading=hero.title,description=hero.description;intro.classList.add('hyper-heading');
  const refresh=iconButton('Refresh markets','refresh',()=>void loadCatalog()),save=iconButton('Save offline','save',()=>{try{localStorage.setItem(savedKey,JSON.stringify(catalog));saveError='Catalogue saved on this device.';}catch{saveError='Could not save on this device.';}catalogStatus();}),forget=iconButton('Remove saved','remove',()=>{try{localStorage.removeItem(savedKey);saveError='Saved catalogue removed.';}catch{saveError='Could not remove saved data.';}catalogStatus();});
  const actions=hero.actions;actions.classList.add('hyper-actions');actions.append(refresh,save,forget);
  const status=node('p',undefined,'hyper-status');status.setAttribute('role','status');
  const controls=node('div',undefined,'hyper-controls'),query=node('input');query.type='search';query.placeholder='Search tokens, questions or venues';query.maxLength=100;query.setAttribute('aria-label','Search trading markets');query.oninput=()=>{missingSelection=false;search=query.value.toLowerCase().trim();page=0;renderList();};
  const venues=node('select');venues.setAttribute('aria-label','Trading venue');venues.onchange=()=>{missingSelection=false;venue=venues.value;page=0;renderList();};controls.append(query,venues);
  const layout=node('div',undefined,'hyper-layout'),list=node('section',undefined,'hyper-list'),listCount=node('p'),rows=node('div',undefined,'hyper-rows'),pagination=node('div',undefined,'hyper-pagination');list.setAttribute('aria-label','Hyperliquid markets');list.append(listCount,rows,pagination);
  const detail=node('section',undefined,'hyper-detail');detail.setAttribute('aria-label','Selected trading market');detail.append(node('p','Select a market to explore.'));layout.append(list,detail);target.append(intro,status,controls,layout);
  let chart,readout,book,feed,feedStatus,quotePrice,sideButtons,detailsTitle;
  const stream=marketStream({request,parse:hyperliquidRequest,checkEvent:checkedHyperliquidEvent,endpoint:'/api/markets/hyper-stream',allowed:()=>allowed()&&Boolean(selected),status:value=>{streamState=value;paintFreshness();},accept:event=>{
    if(event.kind==='trades'){
      const seen=new Map(trades.map(t=>[t.tid,t]));for(const t of event.trades)seen.set(t.tid,t);
      trades=[...seen.values()].sort((a,b)=>b.time-a.time||b.tid-a.tid).slice(0,60);paintTrades();
    }else{tape=mergeMarketEvent(tape,event);paintTape(event.kind!=='book');}
  }});

  function catalogStatus(){
    save.disabled=!catalog;refresh.disabled=Boolean(catalogAbort)||!navigator.onLine;
    const message=catalog?`${navigator.onLine?'Read':'Offline catalogue'} ${new Date(catalog.observedAt).toLocaleString()}${catalog.unavailable.length?' · Some sources unavailable':''}`:navigator.onLine?'Loading markets…':'No saved markets.';
    status.textContent=message+(saveError?' · '+saveError:'');
  }
  function renderList(){
    const focused=document.activeElement?.dataset.marketId;
    const matches=(catalog?.rows??[]).filter(r=>matchesKind(r)&&(!venue||r.venue===venue)&&(!search||`${r.name} ${r.venue} ${r.quote.symbol}`.toLowerCase().includes(search))).sort((a,b)=>Number(b.volume??0)-Number(a.volume??0)||a.name.localeCompare(b.name));
    if(visible&&preferred&&catalog){const wanted=matches.find(row=>row.id===preferred);preferred=null;if(wanted&&wanted.id!==selected?.id){select(wanted,false);return;}if(!wanted){missingSelection=true;cancelFeed();clearDegenCandles(chart);selected=null;tape=null;trades=[];chart=null;feedStatus=null;feed=null;detail.replaceChildren(node('p','This market is no longer available.'));}}
    if(visible&&!missingSelection&&matches.length&&!matches.some(row=>row.id===selected?.id)){select(matches[0],false);return;}
    if(visible&&!matches.length&&selected){cancelFeed();clearDegenCandles(chart);selected=null;tape=null;trades=[];chart=null;feedStatus=null;feed=null;detail.replaceChildren(node('p','No markets match your search.'));}
    page=Math.min(page,Math.max(0,Math.ceil(matches.length/40)-1));listCount.textContent=`${matches.length} markets`;rows.replaceChildren();
    for(const row of matches.slice(page*40,page*40+40)){
      const b=button('',()=>select(row));b.className='hyper-row';b.dataset.marketId=row.id;b.setAttribute('aria-pressed',String(selected?.id===row.id));
      const name=node('span',undefined,'hyper-row-name');name.append(node('strong',row.name),node('small',`${HYPERLIQUID_KINDS[row.kind]} · ${row.venue} · ${row.quote.symbol}`));
      b.append(marketLogo(row),name,node('span',row.kind==='outcome'?'2 sides':price(row.price),'hyper-row-price'));rows.append(b);
    }
    if(!matches.length)rows.append(node('p','No markets match your search.'));
    const previous=iconButton('Previous','previous',()=>{page--;renderList();}),next=iconButton('Next','next',()=>{page++;renderList();});previous.disabled=page===0;next.disabled=(page+1)*40>=matches.length;
    pagination.replaceChildren(previous,node('span',`${page+1} / ${Math.max(1,Math.ceil(matches.length/40))}`),next);
    if(focused)[...rows.children].find(row=>row.dataset.marketId===focused)?.focus({preventScroll:true});
  }
  function select(row,scroll=true){
    if(selected?.id===row.id)return;missingSelection=false;
    cancelFeed();clearHyperliquidTrading();selected=row;side=0;tape=null;trades=[];clearDegenCandles(chart);detail.replaceChildren();
    const header=node('div',undefined,'hyper-detail-heading'),identity=node('div');detailsTitle=node('h3',row.name);identity.append(node('p',`${HYPERLIQUID_KINDS[row.kind]} · ${row.venue}`,'hyper-kicker'),detailsTitle);quotePrice=node('strong',`${price(row.price)} ${row.quote.symbol}`,'hyper-price');header.append(marketLogo(row),identity,quotePrice);
    sideButtons=node('div',undefined,'hyper-sides');
    for(const [i,s] of row.sides.entries()){const b=button(`${s.name} · ${price(s.price)} ${row.quote.symbol}`,()=>{if(side===i)return;side=i;tape=null;trades=[];clearDegenCandles(chart);chart.replaceChildren(node('p','Loading chart…'));readout.textContent='';paintSides();paintTrades();book.replaceChildren();startFeed();});sideButtons.append(b);}
    const toolbar=node('div',undefined,'hyper-chart-tools'),intervals=node('div',undefined,'chart-intervals');intervals.setAttribute('role','group');intervals.setAttribute('aria-label','Candle interval');
    for(const value of ['1m','5m','15m','1h','4h','1d']){const b=button(value,()=>{if(interval===value)return;interval=value;tape=null;clearDegenCandles(chart);chart.replaceChildren(node('p','Loading chart…'));readout.textContent='';for(const control of intervals.children)control.setAttribute('aria-pressed',String(control===b));startFeed();});b.dataset.interval=value;b.setAttribute('aria-pressed',String(value===interval));intervals.append(b);}
    toolbar.append(intervals,iconButton('Refresh chart','refresh',()=>startFeed()));feedStatus=node('p',undefined,'hyper-feed-status');feedStatus.setAttribute('role','status');toolbar.append(feedStatus);
    chart=node('div',undefined,'hyper-chart');chart.append(node('p','Loading chart…'));readout=node('p',undefined,'hyper-readout');
    const lower=node('div',undefined,'hyper-lower'),bookPanel=node('section'),tradePanel=node('section');bookPanel.append(node('h4','Order book'),node('p',`Price (${row.quote.symbol}) · Size`));book=node('div',undefined,'hyper-book');bookPanel.append(book);tradePanel.append(node('h4','Recent trades'),node('p',`Time · Side · Price (${row.quote.symbol}) · Size`));feed=node('div',undefined,'hyper-trades');tradePanel.append(feed);lower.append(bookPanel,tradePanel);
    const terms=node('details',undefined,'hyper-terms');terms.append(node('summary',row.kind==='outcome'?'Outcome details':'Market details'),node('p',row.description||`${row.name} on HyperCore.`));
    if(row.kind==='builder'||row.kind==='perp')terms.append(node('p',`Maximum leverage: ${row.leverage??'—'}× · Funding: ${row.funding===null?'—':(Number(row.funding)*100).toFixed(5)+'%'} · Collateral: ${row.quote.symbol}`));
    detail.append(header,sideButtons,toolbar,chart,readout);mountHyperliquidTrading(detail,row);detail.append(lower,terms);paintSides();paintTrades();renderList();startFeed();if(scroll&&matchMedia('(max-width:760px)').matches)detail.scrollIntoView({block:'start',behavior:'auto'});
  }
  function paintSides(){for(const [i,b] of [...sideButtons?.children??[]].entries())b.setAttribute('aria-pressed',String(i===side));if(selected?.kind==='outcome')quotePrice.textContent=`${price(selected.sides[side].price)} ${selected.quote.symbol}`;}
  function paintTrades(){
    if(!feed)return;feed.replaceChildren();
    for(const t of trades.slice(0,30)){const row=node('div',undefined,'hyper-trade');row.append(node('time',time(t.time)),node('span',t.side==='B'?'Buy':'Sell',t.side==='B'?'hyper-buy':'hyper-sell'),node('span',price(t.px)),node('span',price(t.sz)));feed.append(row);}
    if(!trades.length)feed.append(node('p',!navigator.onLine?'Connect to load recent trades.':enabled()?'Waiting for trades on this market.':'Turn on automatic updates for trades.'));
  }
  function paintFreshness(){
    if(!feedStatus)return;
    const freshBook=tape&&Date.now()-tape.bookTime<30000,last=tape?.candles.at(-1),delayed=last&&Date.now()-last.time>2*CANDLE_INTERVALS[interval];
    const state=!navigator.onLine?'Offline':!visible||document.hidden?'Paused':!enabled()?'Paused':streamState==='retrying'?'Reconnecting':streamState==='streaming'?'Streaming':'Connecting';
    feedStatus.textContent=`${delayed?'Chart delayed · ':''}${state}${tape?` · Book ${freshBook?'':'last read '}${time(tape.bookTime)} · ${last?'Candle '+time(last.time):'No candles yet'}`:''}`;
  }
  function paintTape(draw=true){
    if(!tape||!chart)return;
    if(draw)drawDegenCandles(chart,tape.candles,request().marketId,readout,{intervalMs:CANDLE_INTERVALS[interval]});
    const last=tape.candles.at(-1);if(last)quotePrice.textContent=`${price(last.close)} ${selected.quote.symbol}`;
    book.replaceChildren();const bid=node('div'),ask=node('div');
    for(const [i,container] of [bid,ask].entries()){
      container.append(node('strong',i?'Asks':'Bids',i?'hyper-sell':'hyper-buy'));
      for(const level of tape.levels[i].slice(0,8)){const row=node('div',undefined,'hyper-level');row.append(node('span',price(level.price)),node('span',price(level.size)));container.append(row);}
      if(!tape.levels[i].length)container.append(node('p',i?'No asks':'No bids'));
    }
    book.append(bid,ask);paintFreshness();
  }
  function cancelFeed(){generation++;readAbort?.abort();readAbort=null;stream.stop();}
  function startFeed(){
    cancelFeed();paintTrades();if(!selected||!allowed()){if(chart&&!tape&&!navigator.onLine)chart.replaceChildren(node('p','Connect to load this chart.'));paintFreshness();return;}
    if(enabled()){stream.setEnabled(true);paintTrades();return;}
    const ticket=generation,abort=new AbortController();readAbort=abort;const expected=request();
    void fetch('/api/markets/hyper-tape',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(expected),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])}).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(value=>{if(ticket!==generation)return;tape=mergeMarketEvent(tape,checkedHyperliquidEvent({kind:'snapshot',tape:value},expected));paintTape();}).catch(()=>{if(ticket===generation){feedStatus.textContent='Chart unavailable. Try refreshing.';if(!tape)chart.replaceChildren(node('p','Chart unavailable.'));}}).finally(()=>{if(ticket===generation)readAbort=null;});
  }
  async function loadCatalog(){
    if(!allowed()||catalogAbort)return;
    const abort=new AbortController();catalogAbort=abort;saveError='';catalogStatus();
    try{
      const response=await fetch('/api/markets/hyper-catalog',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)])});
      if(!response.ok)throw Error();const value=checkedHyperliquidCatalog(await response.json());if(abort.signal.aborted)return;
      catalog=value;loaded=true;updateDirectory();
    }catch{if(!abort.signal.aborted)saveError=catalog?'Refresh unavailable · earlier catalogue retained.':'Markets unavailable. Try refreshing.';}
    finally{if(catalogAbort===abort)catalogAbort=null;catalogStatus();}
  }
  function updateDirectory(){
    venues.replaceChildren();for(const value of ['',...new Set(catalog.rows.filter(matchesKind).map(r=>r.venue))].sort()){const o=node('option',value?(value==='HyperCore'?'Hyperliquid':`Hyperliquid · ${value}`):'All venues');o.value=value;venues.append(o);}if(![...venues.options].some(o=>o.value===venue))venue='';venues.value=venue;
    if(selected){const row=catalog.rows.find(r=>r.id===selected.id);if(!row){cancelFeed();clearDegenCandles(chart);selected=null;tape=null;detail.replaceChildren(node('p','This market is no longer in the current catalogue.'));}else selected=row;}
    renderList();catalogStatus();
  }
  function wake(){if(!allowed()){cancelFeed();catalogAbort?.abort();}else{if(!loaded)void loadCatalog();startFeed();}paintFreshness();catalogStatus();}
  document.addEventListener('visibilitychange',wake);addEventListener('online',wake);addEventListener('offline',wake);addEventListener('market-live-change',()=>{if(visible)startFeed();});
  addEventListener('pagehide',()=>{visible=false;cancelFeed();catalogAbort?.abort();});addEventListener('pageshow',()=>{if(!target.hidden){visible=true;wake();}});
  setInterval(()=>{if(visible)paintFreshness();},1000);
  function restoreCatalog(){try{const raw=localStorage.getItem(savedKey);if(raw&&raw.length<=8*1024*1024){const saved=checkedHyperliquidCatalog(JSON.parse(raw));if(!catalog||saved.observedAt>catalog.observedAt){catalog=saved;updateDirectory();}}}catch{}}
  restoreCatalog();
  catalogStatus();
  function matchesKind(row){return kind==='all'||row.kind===kind||kind==='perpetuals'&&['perp','builder'].includes(row.kind);}
  return {show(value,view,marketId){
    if(value&&marketId){missingSelection=false;preferred=marketId;search='';query.value='';venue='';venues.value='';page=0;}
    target.hidden=!value;if(!value)clearHyperliquidTrading();const nextKind=({spot:'spot',perpetuals:'perpetuals',predictions:'outcome'})[view]??kind;
    if(visible===value&&kind===nextKind){if(preferred)renderList();return;}
    visible=false;if(value)restoreCatalog();
    if(value&&kind!==nextKind){
      kind=nextKind;missingSelection=false;page=0;search='';query.value='';venue='';cancelFeed();clearDegenCandles(chart);selected=null;tape=null;trades=[];chart=null;feedStatus=null;feed=null;detail.replaceChildren(node('p','Select a market to explore.'));
      if(catalog)updateDirectory();
    }
    hero.setKind(kind==='outcome'?'predictions':kind);heading.textContent=({spot:'Spot',perpetuals:'Perpetuals',outcome:'Predictions'})[kind]??'Markets';
    description.textContent=kind==='outcome'?'Explore events, price forecasts and other outcomes.':kind==='perpetuals'?'Explore perpetual markets across supported venues.':'Explore spot markets across supported venues.';
    visible=value;wake();if(value){renderList();if(selected&&!detail.querySelector('.hyper-action'))mountHyperliquidTrading(detail,selected);}
  }};
}
