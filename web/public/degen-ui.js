import {DEGEN_SOURCES,DEGEN_NETWORKS,DEGEN_INTERVALS,checkedNetworks,degenRequest,tokenLinkRequest,checkedMarket,checkedDiscovery,checkedCandles,groupTokens,tokenKey,marketURL} from './degen-model.js';
import {drawDegenCandles,clearDegenCandles,priceText} from './degen-chart.js';
import {mountDegenTrades} from './degen-trades.js';
import {degenPost as post} from './degen-http.js';
import {workspaceHeading} from './workspace-heading.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const compact=value=>value===null?'—':new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:2}).format(value);
const usd=value=>value===null?'—':'$'+compact(value);
const percent=value=>value===null?'—':`${value>0?'+':''}${value.toFixed(2)}%`;
const refreshIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/></svg>';
export function mountDegen(root){
  root.innerHTML=`<div class="degen-controls"><nav aria-label="Token discovery"><button type="button" data-feed="trending" aria-pressed="true">Trending</button><button type="button" data-feed="new" aria-pressed="false">New pools</button><button type="button" data-feed="watch" aria-pressed="false">Watchlist</button></nav><form class="degen-search"><label for="degen-query">Find token</label><input id="degen-query" type="search" maxlength="240" placeholder="Token, address or pool link" autocomplete="off"><button type="submit" aria-label="Search tokens"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg></button></form><button class="degen-refresh" type="button" aria-label="Refresh tokens" title="Refresh tokens">${refreshIcon}</button></div><div class="degen-meta"><p class="degen-state" role="status"></p><label><span>Chain</span> <select class="degen-chain" aria-label="Filter token chains"><option value="">All chains</option></select></label></div><div class="degen-grid"><section class="degen-list" aria-label="Tokens"><div class="degen-columns"><span>Token / chain</span><span>Price · 24h</span></div><div class="degen-rows"></div></section><section class="degen-detail" aria-label="Selected token"><p>Select a token to see its markets.</p></section></div><details class="degen-data"><summary>Data sources</summary><button type="button" class="degen-more-chains">Load more chains</button><p class="degen-providers"></p><p>Public data queries go to the listed providers. Listings are not endorsements. Boosted listings are labelled.</p><p>Watchlists and saved prices stay on this device. Trading is not connected for these markets.</p></details>`;
  const hero=workspaceHeading({title:'Degen',description:'Discover tokens, pools and recent trades.',kind:'degen'});hero.actions.append(root.querySelector('.degen-refresh'));root.prepend(hero.element);
  const $=s=>root.querySelector(s),storage='lenz-degen-v1',snapshots=new Map(),watches=new Map(),charts=new Map(),failures=new Set();
  let active=false,mode='trending',query='',selected=null,selectedPool=null,interval='5m',generation=0,chartGeneration=0,controller=null,chartController=null,timer=null,busy=false,storageError='';
  let network=new URLSearchParams(location.search).get('network')??'',networkPage=1,tape=null,chartTimer=null,chartPending=null,feedRetryTimer=null,warmTimer=null,warming=null,warmGeneration=0;
  if(!/^[a-z0-9_-]{0,50}$/.test(network))network='';
  const networkNames=new Map(Object.entries(DEGEN_NETWORKS));if(network&&!networkNames.has(network))networkNames.set(network,network);
  const automatic=()=>document.querySelector('#market-live')?.checked!==false;
  try{const raw=localStorage.getItem(storage);if(raw){if(raw.length>1800000)throw Error();const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.watches)||data.watches.length>100||!Array.isArray(data.snapshots)||data.snapshots.length>12||!Array.isArray(data.charts)||data.charts.length>12)throw Error();for(const row of data.watches){const r=checkedMarket(row);watches.set(tokenKey(r),r);}for(const value of data.snapshots){const v=checkedDiscovery(value,value.request,{saved:true});snapshots.set(JSON.stringify(v.request),v);}for(const value of data.charts){const v=checkedCandles(value,value.request,{saved:true});charts.set(JSON.stringify(v.request),v);}}}catch{snapshots.clear();watches.clear();charts.clear();storageError='Saved token data could not be read.';}
  function save(){try{localStorage.setItem(storage,JSON.stringify({version:1,watches:[...watches.values()],snapshots:[...snapshots.values()].slice(-12),charts:[...charts.values()].slice(-12)}));storageError='';}catch{storageError='Changes could not be saved on this device.';}status();}
  function requests(){if(mode==='watch'){const row=watches.get(selected);return row?[{provider:row.source,kind:'pool',network:row.network,pool:row.pool}]:[];}if(mode!=='search')return [{provider:'geckoterminal',kind:'feed',feed:mode,...(network?{network}:{})}];const link=tokenLinkRequest(query);return link?[link]:Object.keys(DEGEN_SOURCES).map(provider=>degenRequest({provider,kind:'search',query,...(network&&provider==='geckoterminal'?{network}:{})}));}
  function remember(value){const key=JSON.stringify(value.request),old=snapshots.get(key);if(old&&old.observedAt>value.observedAt)return;snapshots.delete(key);snapshots.set(key,value);while(snapshots.size>12)snapshots.delete(snapshots.keys().next().value);}
  async function snapshotRead(request,signal){const raw=await post(request,signal);return {...checkedDiscovery(raw,request,{saved:raw.stale===true}),stale:raw.stale===true,retryAfterMs:raw.stale===true?Math.max(1000,Math.min(300000,Number(raw.retryAfterMs)||60000)):0};}
  function warmOtherFeed(){
    clearTimeout(warmTimer);if(!active||!automatic()||!navigator.onLine||document.hidden||!['trending','new'].includes(mode)||warming)return;
    const request=degenRequest({provider:'geckoterminal',kind:'feed',feed:mode==='trending'?'new':'trending',...(network?{network}:{})}),key=JSON.stringify(request),saved=snapshots.get(key);
    if(saved&&Date.now()-saved.observedAt<60000&&!saved.stale)return;
    warmTimer=setTimeout(()=>{if(!active||!automatic()||!navigator.onLine||document.hidden)return;const ticket=warmGeneration,abort=new AbortController(),promise=snapshotRead(request,abort.signal);warming={key,promise,abort};promise.then(value=>{if(ticket!==warmGeneration)return;remember(value);save();}).catch(()=>{}).finally(()=>{if(warming?.promise===promise)warming=null;});},400);
  }
  function rows(){if(mode==='watch')return [...watches.values()];return requests().flatMap(r=>snapshots.get(JSON.stringify(r))?.rows??[]);}
  function status(){
    let req=[];try{req=requests();}catch{}
    const values=req.map(r=>snapshots.get(JSON.stringify(r))).filter(Boolean),oldest=values.length?Math.min(...values.map(v=>v.observedAt)):null;
    const age=oldest?`${Math.max(0,Math.floor((Date.now()-oldest)/1000))}s ago`:'';
    const count=groupTokens(rows()).length;
    $('.degen-state').textContent=storageError||(!navigator.onLine?'Offline · Saved data':busy&&!count?'Loading tokens…':failures.size?'Some sources unavailable · Earlier data retained':mode==='watch'?`${watches.size} watched · Saved prices`:oldest?`${count} token${count===1?'':'s'} · ${age}${values.some(v=>v.stale)||Date.now()-oldest>120000?' · Saved':''}${busy?' · Updating':''}`:'No token data loaded');
    $('.degen-providers').textContent=req.map(r=>`${DEGEN_SOURCES[r.provider]}${failures.has(r.provider)?' · Unavailable':snapshots.has(JSON.stringify(r))?' · Reported market data':''}`).join(' / ')||'Saved watchlist observations';
    $('.degen-refresh').disabled=busy||!navigator.onLine;
  }
  function render(){
    const groups=groupTokens(rows());
    for(const g of groups)if(g.token.chain.gecko&&!networkNames.has(g.token.chain.gecko))networkNames.set(g.token.chain.gecko,g.token.chain.name);
    $('.degen-chain').replaceChildren(new Option('All chains',''),...[...networkNames].map(([id,name])=>new Option(name,id)));$('.degen-chain').value=network;
    const visible=groups.filter(g=>!network||g.token.chain.gecko===network);
    if(!visible.some(g=>g.key===selected)){selected=visible[0]?.key??null;selectedPool=null;}
    $('.degen-rows').replaceChildren(...visible.map(g=>{
      const r=g.token,button=el('button',undefined,'degen-row');button.type='button';button.dataset.token=g.key;button.setAttribute('aria-pressed',String(g.key===selected));
      const label=el('span'),number=el('span');label.append(el('strong',r.symbol),el('small',`${r.chain.name} · ${r.venue}`));number.append(el('strong',r.price===null?'—':'$'+priceText(r.price)),el('small',percent(r.change),r.change>0?'degen-up':r.change<0?'degen-down':''));button.append(label,number);button.onclick=()=>{selected=g.key;selectedPool=null;render();};return button;
    }));
    if(!visible.length)$('.degen-rows').append(el('p',mode==='watch'?'Save a token with the star beside its name.':busy?'Loading…':'No matching tokens. Search an address or change the filter.','degen-empty'));
    renderDetail(visible.find(g=>g.key===selected));status();
  }
  function renderDetail(group){
    const panel=$('.degen-detail');if(!group){clearTimeout(chartTimer);chartPending=null;tape?.stop();chartGeneration++;chartController?.abort();clearDegenCandles(panel.querySelector('.degen-canvas'));panel.replaceChildren(el('p','Select a token to see its markets.'));return;}
    const row=group.markets.find(r=>r.id===selectedPool)??group.token;selectedPool=row.id;
    if(panel.dataset.pool===row.id&&panel.querySelector('.degen-canvas')){panel.querySelector('.degen-price').textContent=row.price===null?'—':'$'+priceText(row.price);const values=[percent(row.change),usd(row.liquidity),usd(row.volume),usd(row.marketCap)];panel.querySelectorAll('.degen-stats dd').forEach((n,i)=>n.textContent=values[i]);tape?.resume();loadChart(row);return;}
    tape?.stop();chartPending=null;clearDegenCandles(panel.querySelector('.degen-canvas'));panel.dataset.pool=row.id;panel.replaceChildren();
    const head=el('div',undefined,'degen-token-head'),identity=el('div'),title=el('h2',row.symbol);identity.append(title,el('p',`${row.name} · ${row.chain.name}`));
    const star=el('button',undefined,'degen-star');star.type='button';star.setAttribute('aria-label','Watch '+row.symbol);star.setAttribute('aria-pressed',String(watches.has(group.key)));star.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>';
    star.onclick=()=>{if(watches.has(group.key))watches.delete(group.key);else if(watches.size<100)watches.set(group.key,row);else{storageError='Watchlist limit reached (100 tokens).';status();return;}star.setAttribute('aria-pressed',String(watches.has(group.key)));save();if(mode==='watch'){panel.dataset.pool='';render();}};
    const price=el('strong',row.price===null?'—':'$'+priceText(row.price),'degen-price');head.append(identity,star,price);panel.append(head);
    const stats=el('dl',undefined,'degen-stats');for(const [name,value]of [['24h',percent(row.change)],['Liquidity',usd(row.liquidity)],['Volume · 24h',usd(row.volume)],['Market cap',usd(row.marketCap)]]){const item=el('div');item.append(el('dt',name),el('dd',value));stats.append(item);}panel.append(stats);
    const toolbar=el('div',undefined,'degen-chart-tools'),nav=el('nav');nav.setAttribute('aria-label','Token candle interval');for(const value of Object.keys(DEGEN_INTERVALS)){const b=el('button',value);b.type='button';b.setAttribute('aria-pressed',String(value===interval));b.onclick=()=>{interval=value;for(const n of nav.children)n.setAttribute('aria-pressed',String(n===b));loadChart(row,true);};nav.append(b);}toolbar.append(nav,el('span','USD · GeckoTerminal'));panel.append(toolbar);
    const readout=el('p','','degen-readout'),canvas=el('div',undefined,'degen-canvas'),chartState=el('p','','degen-chart-state');canvas.append(el('p','Loading candles…'));const tapeMount=el('div');panel.append(readout,canvas,chartState,tapeMount);
    const pools=el('div',undefined,'degen-pools');pools.append(el('h3','Markets'));for(const market of group.markets){const b=el('button',undefined,'degen-pool');b.type='button';b.setAttribute('aria-pressed',String(market.id===row.id));const name=el('span');name.append(el('strong',`${market.venue} · ${market.symbol} / ${market.quote}`),el('small',DEGEN_SOURCES[market.source]+(market.boosted?' · Boosted':'')));b.append(name,el('span',usd(market.liquidity)));b.onclick=()=>{selectedPool=market.id;renderDetail(group);};pools.append(b);}panel.append(pools);
    const actions=el('div',undefined,'degen-actions'),copy=el('button','Copy token link');copy.type='button';const link=new URL(location.href);link.search='';link.searchParams.set('view','degen');link.searchParams.set('pool',marketURL(row));copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.href);copy.textContent='Copied';}catch{copy.textContent='Copy unavailable';}};
    const source=el('a','Open source ↗');source.href=marketURL(row);source.target='_blank';source.rel='noopener noreferrer';actions.append(copy,source);panel.append(actions);
    const details=el('details',undefined,'degen-token-data');details.append(el('summary','Token details'),el('p',`Address · ${row.address}`),el('p',`Pool · ${row.pool}`),el('p',`Pool created · ${row.createdAt?new Date(row.createdAt).toLocaleString():'Unavailable'}`),el('p',`FDV · ${usd(row.fdv)}`),el('p','Reported data · Trading not connected'));panel.append(details);loadChart(row);tape=mountDegenTrades(tapeMount,row,{allowed:()=>active&&automatic()});
  }
  async function loadChart(row,manual=false){
    const request={provider:'geckoterminal',kind:'candles',network:row.chain.gecko,pool:row.pool,address:row.address,interval},key=JSON.stringify(request);
    // Feed refreshes must not cancel this token's pending read or retry window.
    if(!manual&&chartPending===key)return;
    chartPending=null;
    clearTimeout(chartTimer);const ticket=++chartGeneration;chartController?.abort();chartController=new AbortController();const canvas=$('.degen-canvas'),readout=$('.degen-readout'),state=$('.degen-chart-state');if(!canvas)return;
    if(!row.chain.gecko){canvas.replaceChildren(el('p','Candles unavailable for this chain'));state.textContent='';return;}
    const saved=charts.get(key);if(saved){drawDegenCandles(canvas,saved.candles,row.symbol,readout,{intervalMs:DEGEN_INTERVALS[interval]});state.textContent=`Saved candles · ${new Date(saved.observedAt).toLocaleTimeString()}`;}else{clearDegenCandles(canvas);canvas.replaceChildren(el('p','Loading candles…'));readout.textContent='';}
    if(saved&&!manual&&Date.now()-saved.observedAt<60000)return;
    if(!active||!navigator.onLine||document.hidden||(!automatic()&&!manual)){if(!saved)canvas.replaceChildren(el('p',!navigator.onLine?'No saved candles':'Candles paused'));return;}
    chartPending=key;const retry=delay=>{chartTimer=setTimeout(()=>{chartPending=null;loadChart(row,manual);},delay);};
    chartTimer=setTimeout(async()=>{try{const raw=await post(request,chartController.signal),stale=raw.stale===true;let data=checkedCandles(raw,request,{saved:stale});if(ticket!==chartGeneration||!active)return;if(saved&&saved.observedAt>data.observedAt)data=saved;charts.delete(key);charts.set(key,data);while(charts.size>12)charts.delete(charts.keys().next().value);drawDegenCandles(canvas,data.candles,row.symbol,readout,{intervalMs:DEGEN_INTERVALS[interval]});const last=data.candles.at(-1);if(stale){const delay=Number.isFinite(raw.retryAfterMs)?Math.max(1000,Math.min(300000,raw.retryAfterMs)):60000;state.textContent=`Saved ${new Date(data.observedAt).toLocaleString()} · Retrying in ${Math.ceil(delay/1000)}s`;retry(delay);}else{chartPending=null;state.textContent=`${new Date(data.observedAt).toLocaleTimeString()} · ${last?'Last candle '+new Date(last.time).toLocaleString():'No trades in this interval'}`;}save();}
    catch(error){if(ticket!==chartGeneration||!active||error.name==='AbortError')return;const delay=Number.isFinite(error.retryAfterMs)?Math.max(1000,Math.min(300000,error.retryAfterMs)):15000;state.textContent=`Retrying in ${Math.ceil(delay/1000)}s${saved?' · Saved candles':''}`;if(!saved)canvas.replaceChildren(el('p','Waiting for chart data'));retry(delay);}},200);
  }
  async function refresh(){
    clearTimeout(feedRetryTimer);
    if(!active||document.hidden||!navigator.onLine)return;let req;try{req=requests();}catch(error){$('.degen-state').textContent=error.message;return;}
    const ticket=++generation;controller?.abort();controller=new AbortController();busy=true;failures.clear();status();
    await Promise.all(req.map(async request=>{try{const key=JSON.stringify(degenRequest(request)),value=await(warming?.key===key?warming.promise:snapshotRead(request,controller.signal));if(ticket!==generation||!active)return;remember(value);if(value.stale&&automatic()){clearTimeout(feedRetryTimer);feedRetryTimer=setTimeout(()=>{if(ticket===generation)refresh();},value.retryAfterMs);}}catch(error){if(ticket===generation&&active){failures.add(request.provider);if(error.retryAfterMs&&automatic()){clearTimeout(feedRetryTimer);feedRetryTimer=setTimeout(()=>{if(ticket===generation)refresh();},error.retryAfterMs);}}}}));
    if(ticket!==generation||!active)return;busy=false;
    if(mode==='watch')for(const request of req)for(const row of snapshots.get(JSON.stringify(request))?.rows??[])if(watches.has(tokenKey(row)))watches.set(tokenKey(row),row);
    render();save();warmOtherFeed();
  }
  function choose(next){clearTimeout(warmTimer);generation++;controller?.abort();busy=false;failures.clear();mode=next;query='';$('#degen-query').value='';selected=null;selectedPool=null;$('.degen-detail').dataset.pool='';for(const b of root.querySelectorAll('[data-feed]'))b.setAttribute('aria-pressed',String(b.dataset.feed===mode));render();const fresh=requests().every(r=>{const v=snapshots.get(JSON.stringify(r));return v&&!v.stale&&Date.now()-v.observedAt<60000;});if(automatic()&&!fresh)refresh();else warmOtherFeed();}
  for(const button of root.querySelectorAll('[data-feed]'))button.onclick=()=>choose(button.dataset.feed);
  $('.degen-search').onsubmit=event=>{event.preventDefault();const candidate=$('#degen-query').value.trim();try{if(!candidate){choose('trending');return;}tokenLinkRequest(candidate)??degenRequest({provider:'dexscreener',kind:'search',query:candidate});}catch(error){$('.degen-state').textContent=error.message;return;}query=candidate;mode='search';selected=null;for(const b of root.querySelectorAll('[data-feed]'))b.setAttribute('aria-pressed','false');render();refresh();};
  $('.degen-chain').onchange=()=>{network=$('.degen-chain').value;selected=null;selectedPool=null;render();refresh();};
  $('.degen-more-chains').onclick=async()=>{const button=$('.degen-more-chains');button.disabled=true;try{const request={provider:'geckoterminal',kind:'networks',page:networkPage},data=checkedNetworks(await post(request,AbortSignal.timeout(15000)),request);for(const n of data.networks)networkNames.set(n.id,n.name);networkPage++;button.hidden=!data.hasMore||networkPage>20;render();}catch(error){$('.degen-state').textContent=error.message;}finally{button.disabled=false;}};$('.degen-refresh').onclick=async()=>{await refresh();const row=groupTokens(rows()).find(g=>g.key===selected)?.markets.find(r=>r.id===selectedPool);if(row&&!automatic()){loadChart(row,true);tape?.refresh();}};
  function stop(){clearTimeout(warmTimer);warmGeneration++;warming?.abort.abort();warming=null;clearTimeout(feedRetryTimer);clearTimeout(chartTimer);chartPending=null;tape?.stop();generation++;chartGeneration++;controller?.abort();chartController?.abort();busy=false;clearInterval(timer);timer=null;}
  function wake(){stop();if(!active)return;status();if(!document.hidden&&navigator.onLine&&automatic()){refresh();timer=setInterval(()=>{if(!document.hidden&&navigator.onLine&&!busy)refresh();},65000);}}
  document.addEventListener('visibilitychange',wake);addEventListener('online',wake);addEventListener('offline',()=>{stop();status();});addEventListener('market-live-change',wake);addEventListener('pagehide',stop);
  addEventListener('storage',event=>{
    if(event.key!==storage)return;
    try{
      const value=JSON.parse(event.newValue);if(value?.version!==1||!Array.isArray(value.watches)||value.watches.length>100)throw Error();
      const next=value.watches.map(checkedMarket);
      // Price/cache writes from another tab do not change the user's watchlist.
      // Rebuilding here cancels the active chart read and its provider backoff.
      if(JSON.stringify(next)===JSON.stringify([...watches.values()]))return;
      watches.clear();for(const row of next)watches.set(tokenKey(row),row);
      if(active){if(mode==='watch')render();else $('.degen-star')?.setAttribute('aria-pressed',String(watches.has(selected)));}
    }catch{storageError='Watchlist update could not be read.';status();}
  });
  const linked=new URLSearchParams(location.search).get('pool');if(linked){try{tokenLinkRequest(linked);query=linked;mode='search';$('#degen-query').value=linked;}catch{storageError='Token link is not supported.';}}
  return {show(value){if(active===value)return;active=value;root.hidden=!value;if(!value){stop();clearDegenCandles($('.degen-canvas'));$('.degen-detail').dataset.pool='';return;}render();wake();}};
}
