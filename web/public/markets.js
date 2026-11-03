import {marketSnapshot,marketFreshness} from './market-snapshot.js';
import {mountMarketQuote,clearMarketQuote} from './market-quote-ui.js';
const $=s=>document.querySelector(s),providers=['uniswap','aave','hyperliquid'],names={uniswap:'Uniswap · Base',aave:'Aave · Base',hyperliquid:'Hyperliquid · HyperCore'};
const storageKey='lenz-market-snapshots-v1',data=new Map(),saved=new Set(),failures=new Set();let category='all',selected=null,busy=false;
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const money=value=>'$'+Number(value).toLocaleString(undefined,{maximumFractionDigits:6});
const age=time=>new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const state=snapshot=>marketFreshness(snapshot,{saved:saved.has(snapshot.provider),online:navigator.onLine});
function readStates(){
  sourceStatus();
  for(const node of document.querySelectorAll('[data-observation-provider]')){
    const snapshot=data.get(node.dataset.observationProvider);if(snapshot)node.textContent=node.dataset.rowStatus?`${node.dataset.rowStatus} · ${state(snapshot)}`:`${state(snapshot)} · read ${age(snapshot.observedAt)}`;
  }
}
function sourceStatus(){
  $('#market-sources').replaceChildren(...providers.map(p=>{
    const node=el('div',undefined,'source-item');node.append(el('strong',names[p]));
    const snapshot=data.get(p),label=failures.has(p)?(snapshot?'Refresh failed · earlier data retained':'Unavailable'):snapshot?`${state(snapshot)} · ${snapshot.evidence.blockTimestamp?'block '+age(snapshot.evidence.blockTimestamp):age(snapshot.observedAt)}`:busy?'Reading…':'Not loaded';
    node.append(el('small',label,failures.has(p)?'read-error':undefined));return node;
  }));
  $('#refresh-markets').disabled=busy||!navigator.onLine;$('#save-markets').disabled=busy||!data.size;
}
function metric(row){return row.category==='perpetuals'?money(row.markPrice):row.category==='liquidity'?`${row.feePips/10000}% fee`:`${row.ltvBps/100}% LTV`;}
function details(row,snapshot){
  const panel=$('#market-detail');panel.replaceChildren(el('p',row.category.toUpperCase(),'eyebrow'),el('h2',row.label),el('span',names[row.marketId],'detail-chain'));
  const hasQuote=mountMarketQuote(panel,row);
  const dl=el('dl',undefined,'detail-data');
  const pairs=row.category==='perpetuals'?[['Mark price',money(row.markPrice)],['Oracle price',money(row.oraclePrice)],['Current funding',`${(Number(row.funding)*100).toFixed(5)}%`],['Venue max leverage',`${row.maxLeverage}×`],['Size decimals',String(row.sizeDecimals)],['Status',row.status]]:
    row.category==='liquidity'?[['Pool version','Uniswap v3'],['Pool fee',`${row.feePips/10000}%`],['Liquidity',row.status==='liquidity-observed'?'Observed':'Unavailable'],['Assets',row.assets.map(a=>a.symbol).join(' / ')]]:
    [['Loan to value',`${row.ltvBps/100}%`],['Liquidation threshold',`${row.liquidationThresholdBps/100}%`],['Borrowing flag',row.borrowingEnabled?'Enabled':'Disabled'],['Reserve state',row.status]];
  for(const [key,value] of pairs){const line=el('div');line.append(el('dt',key),el('dd',value));dl.append(line);}
  if(hasQuote){const more=el('details');more.append(el('summary','Market data'),dl);panel.append(more);}else panel.append(dl);
  const note=row.category==='perpetuals'?'Funding and liquidation continue offline.':row.category==='credit'?'Reserve settings only. Borrowing capacity needs liquidity, caps and account checks.':'Single pool · No route comparison';
  panel.append(el('p',note));
  const evidence=el('details'),readTime=el('p',`${state(snapshot)} · read ${age(snapshot.observedAt)}`);readTime.dataset.observationProvider=snapshot.provider;evidence.append(el('summary','Source details'),readTime,el('p',snapshot.evidence.statement));
  if(snapshot.evidence.blockNumber)evidence.append(el('p',`Finalized Base block ${snapshot.evidence.blockNumber} · ${age(snapshot.evidence.blockTimestamp)}`));
  if(row.address)evidence.append(el('p',row.address));
  if(row.assets)for(const asset of row.assets)evidence.append(el('p',`${asset.symbol} · ${asset.decimals} decimals · ${asset.id}`));
  panel.append(evidence);
}
function render(){
  sourceStatus();const query=$('#market-search').value.trim().toLowerCase();
  const rows=[...data.values()].flatMap(snapshot=>snapshot.rows.map(row=>({row,snapshot}))).filter(({row})=>(category==='all'||row.category===category)&&`${row.label} ${names[row.marketId]} ${row.category}`.toLowerCase().includes(query));
  $('#market-count').textContent=data.size?`${rows.length} market${rows.length===1?'':'s'}`:'Markets';
  if(!data.size)$('#market-status').textContent=busy?'Loading…':!navigator.onLine?'No saved markets. Connect to load data.':failures.size?'Could not load markets. Try refreshing.':'Load markets to see prices and pool settings.';
  else $('#market-status').textContent=rows.length?'':'No markets match this search.';
  if(!rows.some(({row})=>row.id===selected))selected=rows[0]?.row.id??null;
  $('#market-rows').replaceChildren(...rows.map(({row,snapshot})=>{
    const button=el('button',undefined,'market-row');button.type='button';button.dataset.marketId=row.id;button.setAttribute('aria-pressed',String(row.id===selected));
    const name=el('span');name.append(el('strong',row.label),el('small',names[row.marketId]));const value=el('span',metric(row),'metric'),rowState=el('span',`${row.status} · ${state(snapshot)}`,'row-state');rowState.dataset.observationProvider=snapshot.provider;rowState.dataset.rowStatus=row.status;value.append(rowState);
    const arrow=el('span','↗','arrow');arrow.setAttribute('aria-hidden','true');button.append(name,value,arrow);
    button.onclick=()=>{selected=row.id;for(const sibling of $('#market-rows').children)sibling.setAttribute('aria-pressed',String(sibling===button));details(row,snapshot);if(matchMedia('(max-width:680px)').matches)$('#market-detail').scrollIntoView({block:'start',behavior:'auto'});};return button;
  }));
  const item=rows.find(({row})=>row.id===selected);if(item)details(item.row,item.snapshot);
  else {clearMarketQuote();$('#market-detail').replaceChildren(el('h2','Market details'),el('p','Select a market.'));}
}
try{
  const raw=localStorage.getItem(storageKey);
  if(raw){if(raw.length>2000000)throw Error('Saved data too large');const collection=JSON.parse(raw);if(!Array.isArray(collection)||collection.length>3)throw Error('Invalid saved data');
    for(const value of collection){const snapshot=marketSnapshot(value);if(data.has(snapshot.provider))throw Error('Duplicate provider');data.set(snapshot.provider,snapshot);saved.add(snapshot.provider);}
    $('#snapshot-status').textContent='Saved data · Refresh for current values.';
  }
}catch{data.clear();saved.clear();$('#snapshot-status').textContent='Saved data could not be read. Refresh to reload.';}
$('#refresh-markets').onclick=async()=>{
  if(busy||!navigator.onLine)return;busy=true;failures.clear();render();
  await Promise.all(providers.map(async provider=>{
    try{
      const response=await fetch('/api/markets/read',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({provider}),signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw Error('Market read failed');const text=await response.text();if(text.length>2000000)throw Error('Response too large');
      const snapshot=marketSnapshot(JSON.parse(text));if(snapshot.provider!==provider)throw Error('Wrong provider response');data.set(provider,snapshot);saved.delete(provider);
    }catch{failures.add(provider);}render();
  }));busy=false;$('#refresh-markets').textContent='Refresh ↗';render();
};
$('#market-search').addEventListener('input',render);
for(const button of $('#market-filters').children)button.onclick=()=>{category=button.dataset.category;for(const sibling of button.parentNode.children)sibling.setAttribute('aria-pressed',String(sibling===button));render();};
$('#save-markets').onclick=()=>{
  try{localStorage.setItem(storageKey,JSON.stringify([...data.values()]));$('#snapshot-status').textContent=`Saved ${data.size} sources on this device.`;}
  catch{$('#snapshot-status').textContent='Could not save data. Try again.';}
};
$('#forget-markets').onclick=()=>{
  try{localStorage.removeItem(storageKey);for(const p of saved)data.delete(p);saved.clear();$('#snapshot-status').textContent='Saved data removed.';render();}
  catch{$('#snapshot-status').textContent='Could not remove saved data.';}
};
function theme(){const dark=document.documentElement.dataset.theme==='dark';$('#theme-toggle').textContent=dark?'Light':'Dark';$('#theme-toggle').setAttribute('aria-label',`Switch to ${dark?'light':'dark'} theme`);}
$('#theme-toggle').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('lenz-home-theme',next);}catch{}theme();};
new MutationObserver(theme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});theme();
addEventListener('online',()=>data.size?readStates():render());addEventListener('offline',()=>data.size?readStates():render());setInterval(()=>{if(!document.hidden)readStates();},10000);render();
if('serviceWorker' in navigator){
  try{
    const registration=await navigator.serviceWorker.register('/sw.js'),worker=registration.installing??registration.waiting??registration.active;
    if(!worker)throw Error('No offline worker');
    if(worker.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);resolve();}if(worker.state==='redundant'){worker.removeEventListener('statechange',changed);reject(Error('Cache failed'));}};worker.addEventListener('statechange',changed);changed();});
    const channel=new MessageChannel();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{channel.port1.close();reject(Error('Cache check timed out'));},10000);channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();data.complete?resolve():reject(Error('Cache incomplete'));};worker.postMessage({type:'home-status'},[channel.port2]);});
    $('#home-cache-status').textContent='Page available offline · Market data saved separately';
  }
  catch{$('#home-cache-status').textContent='Offline page unavailable';}
}
