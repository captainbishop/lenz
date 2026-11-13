import {startOfflineAccess} from './offline-access.js';
import {marketLogo} from './market-logo.js';
import {MARKET_SOURCES,marketSource} from './evm-markets.js';
import {CHAINS} from './defi-catalog.js';
import {QUOTE_POOL} from './market-quote.js';
import {marketSnapshot,marketFreshness} from './market-snapshot.js';
import {mountMarketQuote,clearMarketQuote} from './market-quote-ui.js';
import {mountPerpTerminal,clearPerpTerminal,updatePerpMetrics} from './perp-terminal.js';
import {creditSurface,poolSurface} from './defi-surfaces.js';
import {themeIcon} from './theme-icon.js';
import {liveRead} from './market-live.js';
import {mountOraclePrices} from './oracle-prices-ui.js';
import {mountMarketPicker} from './market-picker.js';
import {mountDegen} from './degen-ui.js';
import {mountHyperliquid} from './hyperliquid-ui.js';
import {mountPredictions} from './prediction-ui.js';
import {mountMarketOverview} from './market-overview.js';
import {workspaceHeading} from './workspace-heading.js';
const $=s=>document.querySelector(s),providers=MARKET_SOURCES.map(s=>s.key),names=Object.fromEntries(MARKET_SOURCES.map(s=>[s.key,s.name]));
const entry=new URLSearchParams(location.search),entryView=entry.get('view'),entryAction=entry.get('action');
const storageKey='lenz-market-snapshots-v1',data=new Map(),saved=new Set(),failures=new Set();let category=['credit','liquidity','perpetuals','degen','spot','predictions'].includes(entryView)?entryView:'all',selected=null,busy=false,liveState='off',detailShape='',manualGeneration=0,manualController=null;
const liveStorageKey='lenz-live-market-snapshots-v1';
const oraclePrices=mountOraclePrices($('#oracle-prices'));
const degen=mountDegen($('#degen-workspace'));
const hyperliquid=mountHyperliquid($('#hyperliquid-workspace'));
const predictionsTarget=document.createElement('section');predictionsTarget.id='prediction-workspace';predictionsTarget.hidden=true;$('#hyperliquid-workspace').before(predictionsTarget);
const predictions=mountPredictions(predictionsTarget);
const sectionHeading=workspaceHeading({title:'Lending',kind:'credit'});sectionHeading.element.hidden=true;$('.market-body').before(sectionHeading.element);
let openingMarket=null;
const overview=mountMarketOverview($('#market-overview'),{open:openMarket,snapshots:()=>data.values(),refreshSources:()=>$('#refresh-markets').onclick(),forgetSources:forgetMarkets});
function openMarket(view,id){$('#market-search').value='';$('#market-network').value='';category=view;openingMarket=id??null;if(['credit','liquidity'].includes(view))selected=id??null;for(const b of $('#market-filters').children)b.setAttribute('aria-pressed',String(b.dataset.category===view));render();live.setEnabled($('#market-live').checked&&!['degen','spot','perpetuals','predictions'].includes(view));$('#main').scrollIntoView({block:'start'});}
const shape=row=>JSON.stringify([row.id,row.status,row.assets,row.feePips,row.sizeDecimals,row.maxLeverage]);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const selector=el('button');selector.id='market-selector';$('.market-toolbar').insertBefore(selector,$('#market-network'));
const picker=mountMarketPicker(selector,id=>{selected=id;render();});
$('.market-toolbar').append($('#live-status'),$('#refresh-markets'));$('#data-settings').append($('.read-disclosure'),$('#market-sources'),$('.snapshot-bar'));
const phoneLayout=matchMedia('(max-width:760px)');
function placeFilters(){const parent=phoneLayout.matches?$('#data-settings'):$('.market-toolbar');parent.append($('#market-network').closest('.lenz-choice')??$('#market-network'),$('.search'));}
phoneLayout.addEventListener('change',placeFilters);placeFilters();
$('.market-body').before($('#market-status'));
const money=value=>'$'+Number(value).toLocaleString(undefined,{maximumFractionDigits:6});
const age=time=>new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const state=snapshot=>marketFreshness(snapshot,{saved:saved.has(marketSource(snapshot).key),online:navigator.onLine});
function readStates(){
  sourceStatus();
  for(const node of document.querySelectorAll('[data-observation-provider]')){
    const snapshot=data.get(node.dataset.observationProvider);if(snapshot)node.textContent=node.dataset.rowStatus?`${node.dataset.rowStatus} · ${state(snapshot)}`:`${state(snapshot)} · read ${age(snapshot.observedAt)}`;
  }
}
function sourceStatus(){
  $('#market-sources').replaceChildren(...providers.map(p=>{
    const node=el('div',undefined,'source-item');node.append(el('strong',names[p]));
    const snapshot=data.get(p),label=failures.has(p)?(snapshot?'Refresh failed · earlier data retained':'Unavailable'):snapshot?`${state(snapshot)} · ${snapshot.evidence.blockTimestamp?'block '+age(snapshot.evidence.blockTimestamp):age(snapshot.observedAt)}`:busy||liveState==='updating'?'Reading…':'Not loaded';
    node.append(el('small',label,failures.has(p)?'read-error':undefined));return node;
  }));
  $('#refresh-markets').disabled=busy||liveState==='updating'||!navigator.onLine;
  $('#market-live').disabled=busy;
  $('#refresh-markets').hidden=$('#market-live').checked||['all','prices','degen','spot','perpetuals','predictions'].includes(category);

  if(!data.size)$('#market-status').textContent=busy||liveState==='updating'?'Loading markets…':!navigator.onLine?'No saved markets.':failures.size?'Markets unavailable. Try refreshing.':'Load markets to see prices.';
  const stale=[...data.values()].some(s=>state(s)!=='Recently read');
  $('#live-status').textContent=!navigator.onLine?'Offline':!$('#market-live').checked?'Paused':document.hidden?'Paused':failures.size?'Retrying · Earlier data':stale&&liveState==='live'?'Stale · Retrying':liveState==='live'?'Live':liveState==='retrying'?'Retrying · Earlier data':'Connecting…';
}
function metric(row){return row.category==='perpetuals'?money(row.markPrice):row.category==='liquidity'?`${row.feePips/10000}% fee`:`${row.ltvBps/100}% LTV`;}
function details(row,snapshot){
  detailShape=shape(row);
  clearPerpTerminal();clearMarketQuote();const target=$('#market-detail');target.classList.remove('perp-terminal');
  if(row.category==='perpetuals'){mountPerpTerminal(target,row,snapshot);return;}
  const panel=$('#market-detail');panel.replaceChildren();panel.dataset.category=row.category;
  if(row.category==='credit'){panel.append(creditSurface(row));if(entryView==='credit'&&entryAction==='borrow')panel.querySelector('.position-actions button:nth-child(2)').click();}
  else if(row.id!==QUOTE_POOL){panel.append(poolSurface(row),el('p','Quotes not connected for this pool.'));}
  else {
    const nav=el('nav',undefined,'position-actions');nav.setAttribute('aria-label','Pool actions');const area=el('div');
    for(const action of ['Swap','Liquidity']){const button=el('button',action);button.type='button';button.setAttribute('aria-pressed',String(action==='Swap'));button.onclick=()=>{clearMarketQuote();for(const b of nav.children)b.setAttribute('aria-pressed',String(b===button));area.replaceChildren();if(action==='Swap')mountMarketQuote(area,row,data.get(marketSource(snapshot).key)??snapshot);else area.append(poolSurface(row));};nav.append(button);}
    panel.append(nav,area);mountMarketQuote(area,row,snapshot);if(entryView==='liquidity'&&entryAction==='liquidity')nav.children[1].click();
  }
  const dl=el('dl',undefined,'detail-data');
  const pairs=row.category==='perpetuals'?[['Mark price',money(row.markPrice)],['Oracle price',money(row.oraclePrice)],['Current funding',`${(Number(row.funding)*100).toFixed(5)}%`],['Venue max leverage',`${row.maxLeverage}×`],['Size decimals',String(row.sizeDecimals)],['Status',row.status]]:
    row.category==='liquidity'?[['Pool version','Uniswap v3'],['Pool fee',`${row.feePips/10000}%`],['Liquidity',row.status==='liquidity-observed'?'Observed':'Unavailable'],['Assets',row.assets.map(a=>a.symbol).join(' / ')]]:
    [['Loan to value',`${row.ltvBps/100}%`],['Liquidation threshold',`${row.liquidationThresholdBps/100}%`],['Borrowing flag',row.borrowingEnabled?'Enabled':'Disabled'],['Reserve state',row.status]];
  for(const [key,value] of pairs){const line=el('div');line.append(el('dt',key),el('dd',value));dl.append(line);}
  const more=el('details');more.append(el('summary','Market data'),dl);panel.append(more);
  const note=row.category==='perpetuals'?'Funding and liquidation continue offline.':row.category==='credit'?'Reserve settings only. Borrowing capacity needs liquidity, caps and account checks.':'Single pool · No route comparison';
  if(row.category!=='credit')panel.append(el('p',note));
  const evidence=el('details'),readTime=el('p',`${state(snapshot)} · read ${age(snapshot.observedAt)}`);readTime.dataset.observationProvider=marketSource(snapshot).key;evidence.append(el('summary','Source details'),readTime,el('p',snapshot.evidence.statement));
  if(snapshot.evidence.blockNumber)evidence.append(el('p',`Finalized ${CHAINS[snapshot.chainId].name} block ${snapshot.evidence.blockNumber} · ${age(snapshot.evidence.blockTimestamp)}`));
  if(row.address)evidence.append(el('p',row.address));
  if(row.assets)for(const asset of row.assets)evidence.append(el('p',`${asset.symbol} · ${asset.decimals} decimals · ${asset.id}`));
  panel.append(evidence);
}
function refreshDetails(row,snapshot){
  const panel=$('#market-detail');
  if(row.category==='perpetuals'){updatePerpMetrics(panel,row,snapshot);return;}
  if(row.category==='credit'){
    const values=[row.ltvBps,row.liquidationThresholdBps];panel.querySelectorAll('.credit-limits strong').forEach((n,i)=>n.textContent=values[i]/100+'%');panel.querySelectorAll('.credit-marker').forEach((n,i)=>n.style.left=values[i]/100+'%');
    panel.querySelector('.credit-ruler').setAttribute('aria-label',`Reserve limits: ${row.ltvBps/100}% LTV; ${row.liquidationThresholdBps/100}% liquidation threshold. Not account borrowing capacity.`);
    const valuesText=[row.ltvBps/100+'%',row.liquidationThresholdBps/100+'%',row.borrowingEnabled?'Enabled':'Disabled',row.status];panel.querySelectorAll('.detail-data dd').forEach((n,i)=>n.textContent=valuesText[i]);
  }
  const evidence=panel.querySelector('p[data-observation-provider]');if(evidence){evidence.textContent=`${state(snapshot)} · read ${age(snapshot.observedAt)}`;const statement=evidence.nextElementSibling;if(statement)statement.textContent=snapshot.evidence.statement;if(snapshot.evidence.blockNumber&&statement?.nextElementSibling)statement.nextElementSibling.textContent=`Finalized ${CHAINS[snapshot.chainId].name} block ${snapshot.evidence.blockNumber} · ${age(snapshot.evidence.blockTimestamp)}`;}
}
function render(preserve=false){
  const prices=category==='prices';oraclePrices.show(prices);oraclePrices.filter($('#market-search').value);
  const isOverview=category==='all',isDegen=category==='degen',isPrediction=category==='predictions',isHyperliquid=['spot','perpetuals'].includes(category),special=prices||isDegen||isHyperliquid||isPrediction||isOverview;overview.show(isOverview);if(isOverview)overview.update();degen.show(isDegen);hyperliquid.show(isHyperliquid,category,openingMarket);predictions.show(isPrediction,isPrediction?openingMarket:null);openingMarket=null;
  selector.hidden=special;$('.search').hidden=isDegen||isHyperliquid||isPrediction||isOverview;$('#market-status').hidden=isDegen||isHyperliquid||isPrediction||isOverview;$('#live-status').hidden=isDegen||isHyperliquid||isPrediction||isOverview;
  $('#market-network').hidden=special;$('.market-body').hidden=special;$('#market-sources').hidden=special;$('.snapshot-bar').hidden=special;
  sectionHeading.element.hidden=special;if(!special){sectionHeading.setKind(category);sectionHeading.title.textContent=category==='credit'?'Lending':'Liquidity';sectionHeading.description.textContent=category==='credit'?'Reserve settings across supported lending markets.':'Explore pool liquidity, assets and fees.';sectionHeading.description.hidden=false;}
  if(special){picker.close();clearPerpTerminal();clearMarketQuote();sourceStatus();return;}
  const before=selected,focused=document.activeElement?.dataset.marketId;
  sourceStatus();const query=$('#market-search').value.trim().toLowerCase();
  const rows=[...data.values()].flatMap(snapshot=>snapshot.rows.map(row=>({row,snapshot}))).filter(({row})=>(category==='all'||row.category===category)&&(!$('#market-network').value||row.chainId===$('#market-network').value)&&`${row.label} ${marketSource({provider:row.marketId,chainId:row.chainId}).name} ${row.category}`.toLowerCase().includes(query));
  $('#market-count').textContent=data.size?`${rows.length} market${rows.length===1?'':'s'}`:'Markets';
  if(!data.size)$('#market-status').textContent=busy?'Loading…':!navigator.onLine?'No saved markets. Connect to load data.':failures.size?'Could not load markets. Try refreshing.':'Load markets to see prices and pool settings.';
  else $('#market-status').textContent=rows.length?'':'No markets match this search.';
  if(!rows.some(({row})=>row.id===selected))selected=rows[0]?.row.id??null;
  const choices=rows.map(({row,snapshot})=>({id:row.id,label:row.category==='perpetuals'?row.instrument+' / USD':row.label,detail:marketSource(snapshot).name}));picker.update(choices,selected);
  $('#market-rows').replaceChildren(...rows.map(({row,snapshot})=>{
    const button=el('button',undefined,'market-row');button.type='button';button.dataset.marketId=row.id;button.setAttribute('aria-pressed',String(row.id===selected));
    const name=el('span');name.append(el('strong',row.label),el('small',marketSource(snapshot).name));name.querySelector('strong').prepend(marketLogo({kind:'spot',name:row.instrument??row.assets?.[0]?.symbol??row.label.split(/[ /]/)[0],coin:row.instrument??row.label}));const value=el('span',metric(row),'metric'),rowState=el('span',`${row.status} · ${state(snapshot)}`,'row-state');rowState.dataset.observationProvider=marketSource(snapshot).key;rowState.dataset.rowStatus=row.status;value.append(rowState);
    const arrow=el('span','↗','arrow');arrow.setAttribute('aria-hidden','true');button.append(name,value,arrow);
    button.onclick=()=>{selected=row.id;picker.update(choices,selected);for(const sibling of $('#market-rows').children)sibling.setAttribute('aria-pressed',String(sibling===button));details(row,snapshot);if(matchMedia('(max-width:680px)').matches)$('#market-detail').scrollIntoView({block:'start',behavior:'auto'});};return button;
  }));
  const item=rows.find(({row})=>row.id===selected);if(item){if(preserve&&before===selected&&detailShape===shape(item.row))refreshDetails(item.row,item.snapshot);else details(item.row,item.snapshot);}
  else {clearPerpTerminal();clearMarketQuote();$('#market-detail').classList.remove('perp-terminal');$('#market-detail').replaceChildren(el('h2','Market details'),el('p','Select a market.'));}
  if(focused)for(const button of $('#market-rows').children)if(button.dataset.marketId===focused)button.focus({preventScroll:true});
}
try{
  const raw=localStorage.getItem(liveStorageKey)??localStorage.getItem(storageKey);
  if(raw){if(raw.length>2000000)throw Error('Saved data too large');const collection=JSON.parse(raw);if(!Array.isArray(collection)||collection.length>MARKET_SOURCES.length)throw Error('Invalid saved data');
    for(const value of collection){const snapshot=marketSnapshot(value);const key=marketSource(snapshot).key;if(data.has(key))throw Error('Duplicate provider');data.set(key,snapshot);saved.add(key);}
    $('#snapshot-status').textContent='Saved data';
  }
}catch{data.clear();saved.clear();$('#snapshot-status').textContent='Saved data could not be read. Refresh to reload.';}
async function readMarkets(signal){
  return Promise.all(providers.filter(provider=>provider==='hyperliquid'||!$('#market-live').checked||!data.has(provider)||Date.now()-data.get(provider).observedAt>=20000).map(async provider=>{
    try{
      const source=MARKET_SOURCES.find(s=>s.key===provider),request={provider:source.provider,...(source.network&&source.network!=='base'?{network:source.network}:{})};
      const response=await fetch('/api/markets/read',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
      if(!response.ok)throw Error('Market read failed');const text=await response.text();if(text.length>2000000)throw Error('Response too large');
      const snapshot=marketSnapshot(JSON.parse(text));if(marketSource(snapshot).key!==provider||snapshot.expiresAt<=Date.now()||snapshot.observedAt<(data.get(provider)?.observedAt??0))throw Error('Wrong or stale provider response');return {provider,snapshot};
    }catch{return {provider};}
  }));
}
function acceptMarkets(results){
  for(const {provider,snapshot}of results){if(snapshot){data.set(provider,snapshot);saved.delete(provider);failures.delete(provider);}else failures.add(provider);}
  render(true);
  if(results.some(result=>result.snapshot))try{localStorage.setItem(liveStorageKey,JSON.stringify([...data.values()]));$('#snapshot-status').textContent='Market data saved on this device.';}catch{$('#snapshot-status').textContent='Market data could not be saved.';}
  if(failures.size)throw Error('Some market feeds unavailable');
}
const live=liveRead({period:2000,read:readMarkets,accept:acceptMarkets,status:value=>{liveState=value;sourceStatus();}});
$('#market-live').onchange=()=>{try{localStorage.setItem('lenz-market-live-mode',$('#market-live').checked?'on':'off');}catch{}live.setEnabled($('#market-live').checked&&!['degen','spot','perpetuals','predictions'].includes(category));dispatchEvent(new Event('market-live-change'));};
$('#refresh-markets').onclick=async()=>{
  if(busy||!navigator.onLine)return;if($('#market-live').checked){live.wake();return;}
  const ticket=++manualGeneration;manualController=new AbortController();busy=true;failures.clear();sourceStatus();
  try{const results=await readMarkets(manualController.signal);if(ticket===manualGeneration&&navigator.onLine&&!document.hidden)acceptMarkets(results);}catch{}finally{if(ticket===manualGeneration){busy=false;manualController=null;sourceStatus();}}
};
$('#market-search').addEventListener('input',render);
$('#market-network').addEventListener('change',()=>render());
for(const button of $('#market-filters').children){button.setAttribute('aria-pressed',String(button.dataset.category===category));button.onclick=()=>{category=button.dataset.category;for(const sibling of button.parentNode.children)sibling.setAttribute('aria-pressed',String(sibling===button));render();live.setEnabled($('#market-live').checked&&!['degen','spot','perpetuals','predictions'].includes(category));};}
function forgetMarkets(){
  try{manualGeneration++;manualController?.abort();manualController=null;busy=false;$('#market-live').checked=false;$('#market-live').onchange();localStorage.removeItem(storageKey);localStorage.removeItem(liveStorageKey);localStorage.removeItem('lenz-pool-price-v1');localStorage.removeItem('lenz-market-tape-v1');oraclePrices.clear();data.clear();saved.clear();$('#snapshot-status').textContent='Saved data removed.';render();}
  catch{$('#snapshot-status').textContent='Could not remove saved data.';}
};
$('#forget-markets').onclick=forgetMarkets;
themeIcon(document.querySelector('#theme-toggle'));

function connectionChanged(){if(!navigator.onLine){manualGeneration++;manualController?.abort();manualController=null;busy=false;}live.wake();data.size?readStates():render();}
addEventListener('online',connectionChanged);addEventListener('offline',connectionChanged);document.addEventListener('visibilitychange',()=>{if(document.hidden){manualGeneration++;manualController?.abort();manualController=null;busy=false;sourceStatus();}live.wake();});addEventListener('pagehide',()=>{live.stop();manualGeneration++;manualController?.abort();});setInterval(()=>{if(!document.hidden)readStates();},10000);render();
try{$('#market-live').checked=localStorage.getItem('lenz-market-live-mode')!=='off';}catch{$('#market-live').checked=true;}
live.setEnabled($('#market-live').checked&&!['degen','spot','perpetuals','predictions'].includes(category));
dispatchEvent(new Event('market-live-change'));
startOfflineAccess($('#home-cache-status'));
