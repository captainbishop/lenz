import {workspaceHeading,sectionArtwork} from './workspace-heading.js';
import {PREDICTION_PROVIDERS,checkedPredictions} from './prediction-model.js';
import {mountHyperliquid} from './hyperliquid-ui.js';
import {PERP_ICONS} from './perp-icons.js';
import {HYPERLIQUID_ARTWORK} from './hyperliquid-artwork.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(label,fn,cls)=>{const b=el('button',label,cls);b.type='button';b.onclick=fn;return b;};
const compact=value=>Number(value).toLocaleString(undefined,{notation:'compact',maximumFractionDigits:1});
const percent=value=>value===null?'—':(value*100).toLocaleString(undefined,{maximumFractionDigits:1})+'%';
const date=value=>value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'No closing date';
const stamp=value=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const savedKey='lenz-prediction-snapshots-v1';
const categories=['All events','Crypto','Sports','Politics','Economy','Science & tech','Culture','Other'];
function artwork(event){
 const box=el('span',undefined,'prediction-art');box.append(sectionArtwork('predictions'));
 const symbol=event.artworkSymbol,entry=symbol&&Object.hasOwn(HYPERLIQUID_ARTWORK,'builder:'+symbol)?HYPERLIQUID_ARTWORK['builder:'+symbol]:null;
 const local=entry&&entry.coin===symbol?entry.src:symbol&&Object.hasOwn(PERP_ICONS,symbol)?PERP_ICONS[symbol]:null;
 const source=event.provider==='hyperliquid'?local:event.provider==='kalshi'?'/api/markets/prediction-image?event='+encodeURIComponent(event.id):event.image?'/api/markets/prediction-image?url='+encodeURIComponent(event.image):null;
 if(source){const img=el('img');img.alt='';img.width=72;img.height=72;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.src=source;img.onload=()=>box.classList.add('has-image');img.onerror=()=>img.remove();box.append(img);}
 return box;
}
function probability(outcome){
 const line=el('div',undefined,'prediction-probability');line.append(el('span',outcome.name),el('strong',percent(outcome.probability)));
 const meter=el('span',undefined,'prediction-meter'),fill=el('span');meter.setAttribute('aria-hidden','true');fill.style.width=(outcome.probability??0)*100+'%';meter.append(fill);line.append(meter);return line;
}
export function mountPredictions(target){
 let visible=false,provider='',category='All events',search='',sort='activity',limit=18,selected=null,timer=null,generation=0,detailSnapshot=null,saveError='';
 const snapshots=new Map(),failures=new Set(),controllers=new Map();
 const automatic=()=>document.querySelector('#market-live')?.checked===true;
 const allowed=()=>visible&&navigator.onLine&&!document.hidden;
 target.classList.add('prediction-workspace');
 const discovery=el('div'),hero=workspaceHeading({title:'Predictions',kind:'predictions',description:'Polymarket, Kalshi and Hyperliquid.'});
 const refresh=button('↻',()=>load(true));
 refresh.setAttribute('aria-label','Refresh events');refresh.title='Refresh events';hero.actions.append(refresh);
 for(const [b,d]of [[refresh,'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2']]){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',d);svg.append(path);b.replaceChildren(svg);}
 const status=el('p',undefined,'prediction-status');status.setAttribute('role','status');
 const controls=el('div',undefined,'prediction-controls'),query=el('input');query.type='search';query.placeholder='Search events';query.setAttribute('aria-label','Search events');query.maxLength=100;query.oninput=()=>{search=query.value.trim().toLowerCase();limit=18;paint();};
 const markets=el('select');markets.setAttribute('aria-label','Prediction market');for(const [key,name] of [['','All markets'],...Object.entries(PREDICTION_PROVIDERS)]){const o=el('option',name);o.value=key;markets.append(o);}markets.onchange=()=>{provider=markets.value;limit=18;paint();};
 const order=el('select');order.setAttribute('aria-label','Sort events');for(const [key,name] of [['activity','Activity'],['closing','Closing soon'],['name','A–Z']]){const o=el('option',name);o.value=key;order.append(o);}order.onchange=()=>{sort=order.value;paint();};controls.append(query,markets,order);
 const filters=el('nav',undefined,'prediction-categories');filters.setAttribute('aria-label','Prediction categories');
 for(const label of categories){const b=button(label,()=>{category=label;limit=18;paint();});b.dataset.category=label;filters.append(b);}
 const coverage=el('div',undefined,'prediction-coverage'),count=el('h3'),sourceStates=el('div',undefined,'prediction-sources');coverage.append(count,sourceStates);
 const grid=el('div',undefined,'prediction-grid'),more=button('More events ↓',()=>{limit+=18;paint();},'prediction-more');
 const note=el('details',undefined,'prediction-data-note');note.append(el('summary','About these prices'),el('p','A selection of public events, not the full provider catalogue. Activity is ranked within each provider. Percentages reflect market prices or bid / ask midpoints, not guaranteed probabilities or executable quotes. Kalshi volume is measured in contracts; Polymarket volume is in USD.'));
 discovery.append(hero.element,controls,filters,coverage,status,grid,more,note);
 const native=el('div'),back=button('← All events',()=>{native.hidden=true;discovery.hidden=false;hyper.show(false);paint();target.querySelector(`[data-event-id="${CSS.escape(selected??'')}"]`)?.focus();},'prediction-back'),nativeMarket=el('section');nativeMarket.hidden=true;native.append(back,nativeMarket);native.hidden=true;
 const hyper=mountHyperliquid(nativeMarket);
 const dialog=el('dialog',undefined,'prediction-dialog');dialog.setAttribute('aria-label','Prediction event details');dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 target.append(discovery,native,dialog);
 function save(){try{localStorage.setItem(savedKey,JSON.stringify([...snapshots.values()]));saveError='';}catch{saveError='Could not save events on this device.';}}
 function allEvents(){return [...snapshots.values()].flatMap(s=>s.events);}
 function paintStatus(){
  refresh.hidden=automatic()&&!failures.size&&navigator.onLine;refresh.disabled=controllers.size>0||!navigator.onLine;
  status.textContent=(!navigator.onLine?'Offline · Showing saved events':controllers.size?'Updating events…':failures.size?'Some sources could not refresh. Earlier events are marked saved.':'')+(saveError?' · '+saveError:'');
  if(dialog.open&&detailSnapshot){const p=detailSnapshot.provider,newer=snapshots.get(p)?.observedAt>detailSnapshot.observedAt,saved=!navigator.onLine||failures.has(p)||newer||Date.now()-detailSnapshot.observedAt>120000;dialog.querySelector('.prediction-card-source').textContent=`${PREDICTION_PROVIDERS[p]} · Read ${stamp(detailSnapshot.observedAt)}${saved?' · Saved':''}${newer?' · Newer prices available; reopen this event.':''}`;}
  const nativeAction=dialog.querySelector('[data-native-market]');if(nativeAction)nativeAction.disabled=!navigator.onLine;
 }
 function paint(){
  const focused=document.activeElement?.dataset.eventId;
  let events=allEvents().filter(e=>(!provider||e.provider===provider)&&(category==='All events'||e.category===category)&&(!search||`${e.title} ${e.markets.map(m=>m.title).join(' ')}`.toLowerCase().includes(search)));
  if(sort==='closing')events.sort((a,b)=>(a.endsAt??Infinity)-(b.endsAt??Infinity));
  else if(sort==='name')events.sort((a,b)=>a.title.localeCompare(b.title));
  else{
   const groups=Object.keys(PREDICTION_PROVIDERS).map(p=>events.filter(e=>e.provider===p).sort((a,b)=>(b.volume??-1)-(a.volume??-1)));
   events=[];for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const group of groups)if(group[i])events.push(group[i]);
  }
  count.textContent=`${events.length} events`;
  for(const b of filters.children){b.setAttribute('aria-pressed',String(category===b.dataset.category));const available=allEvents().some(e=>(!provider||e.provider===provider)&&e.category===b.dataset.category);b.hidden=b.dataset.category!=='All events'&&!available&&category!==b.dataset.category;}
  sourceStates.replaceChildren();for(const [id,name]of Object.entries(PREDICTION_PROVIDERS)){const snapshot=snapshots.get(id),state=controllers.has(id)?'Updating':!snapshot?'Unavailable':!navigator.onLine||failures.has(id)||Date.now()-snapshot.observedAt>120000?'Saved':'Read';const n=el('span',`${name} · ${state}`,state==='Saved'||state==='Unavailable'?'is-saved':'');n.title=snapshot?`Read ${stamp(snapshot.observedAt)}`:name;sourceStates.append(n);}
  grid.replaceChildren();
  for(const event of events.slice(0,limit)){
   const card=button('',()=>openEvent(event),'prediction-card');card.dataset.eventId=event.id;card.dataset.lenzCard='';card.dataset.lenzTone=event.category==='Crypto'?'blue':event.category==='Economy'?'gold':'purple';
   const head=el('div',undefined,'prediction-card-heading'),title=el('h4',event.title);head.append(artwork(event),title);
   const source=el('div',undefined,'prediction-card-source');source.append(el('span',PREDICTION_PROVIDERS[event.provider]),el('span',event.category));
   const outcomes=el('div',undefined,'prediction-card-outcomes');
   if(event.markets.length===1){for(const outcome of event.markets[0].outcomes.slice(0,3))outcomes.append(probability(outcome));}
   else for(const market of event.markets.slice(0,3)){
    const leader=market.outcomes.find(o=>o.name.toLowerCase()==='yes')??[...market.outcomes].sort((a,b)=>(b.probability??-1)-(a.probability??-1))[0];outcomes.append(probability({name:market.title+(leader.name.toLowerCase()==='yes'?'':` · ${leader.name}`),probability:leader.probability}));
   }
   const foot=el('div',undefined,'prediction-card-footer');foot.append(el('span',event.volume===null?'Volume unavailable':`${event.volumeUnit==='USD'?'$':''}${compact(event.volume)}${event.volumeUnit==='USD'?'':' '+event.volumeUnit} / 24h`),el('span','↗','arrow'));
   const snapshot=snapshots.get(event.provider),read=el('small',`${!navigator.onLine||failures.has(event.provider)||Date.now()-snapshot.observedAt>120000?'Saved · ':''}Read ${stamp(snapshot.observedAt)}`,'prediction-card-time');
   card.append(source,head,outcomes,el('small',event.markets.length>1?`${event.markets.length} markets · ${date(event.endsAt)}`:date(event.endsAt),'prediction-card-date'),foot,read);grid.append(card);
  }
  if(!events.length){const empty=el('div',undefined,'prediction-empty');empty.append(sectionArtwork('predictions'),el('h4',controllers.size?'Finding events…':'No events here yet'),el('p',search||category!=='All events'?'Try another category or search.':navigator.onLine?'Refresh to try the public sources again.':'Connect to load events, or open a saved selection.'));grid.append(empty);}
  more.hidden=events.length<=limit;paintStatus();if(focused)[...grid.children].find(c=>c.dataset.eventId===focused)?.focus({preventScroll:true});
 }
 function openEvent(event){
  selected=event.id;
  dialog.replaceChildren();const close=button('×',()=>dialog.close(),'prediction-close');close.setAttribute('aria-label','Close event');
  const head=el('div',undefined,'prediction-detail-heading');head.append(artwork(event),el('h3',event.title));
  const snapshot=snapshots.get(event.provider);detailSnapshot=snapshot;dialog.append(close,el('p',undefined,'prediction-card-source'),head);
  dialog.append(el('p',event.hyperId?'View the chart and order book in Lenz when connected.':'Prices shown for discovery. Trading continues on the provider.','prediction-status'));
  const body=el('div',undefined,'prediction-detail-markets');let shown=0;
  const next=button('More markets ↓',appendMarkets,'prediction-more');
  function appendMarkets(){for(const m of event.markets.slice(shown,shown+20)){
   const part=el('section',undefined,'prediction-detail-market');part.append(el('h4',m.question||m.title));for(const outcome of m.outcomes)part.append(probability(outcome));part.append(el('p',`${m.basis} · Closes ${date(m.endsAt)}`,'prediction-card-date'));
   const rules=el('details');rules.append(el('summary','Resolution rules'),el('p',m.rules||'Read the provider’s rules before trading.'));part.append(rules);body.append(part);
  }shown+=20;next.hidden=shown>=event.markets.length;}
  appendMarkets();dialog.append(body,next);
  const actions=el('div',undefined,'prediction-detail-actions');
  if(event.hyperId){const open=button('Open market in Lenz',()=>{dialog.close();discovery.hidden=true;native.hidden=false;hyper.show(true,'predictions',event.hyperId);back.focus();});open.dataset.nativeMarket=event.hyperId;actions.append(open);}
  if(event.provider!=='hyperliquid'){const name=PREDICTION_PROVIDERS[event.provider],link=el('a',event.url?`View on ${name} ↗`:`Open ${name} ↗`);link.href=event.url??(event.provider==='polymarket'?'https://polymarket.com':'https://kalshi.com');link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
  if(event.provider==='kalshi'){const ticker=event.id.slice('kalshi:'.length),copy=button('Copy event code',async()=>{try{await navigator.clipboard.writeText(ticker);copy.textContent='Copied';}catch{copy.textContent=ticker;}});actions.append(copy);dialog.append(el('p',`Find this event on Kalshi: ${ticker}`,'prediction-status'));}
  dialog.append(actions);dialog.showModal();paintStatus();close.focus();
 }
 function cancel(){generation++;clearTimeout(timer);for(const c of controllers.values())c.abort();controllers.clear();}
 async function load(force=false){
  if(!allowed())return;clearTimeout(timer);const ticket=generation;
  await Promise.all(Object.keys(PREDICTION_PROVIDERS).map(async id=>{
   if(controllers.has(id)||!force&&snapshots.has(id)&&Date.now()-snapshots.get(id).observedAt<60000)return;
   const c=new AbortController();controllers.set(id,c);paintStatus();
   try{const res=await fetch('/api/markets/predictions',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({provider:id,privacy:'public'}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(25000)])});if(!res.ok)throw Error();const raw=await res.text();if(raw.length>8*1024*1024)throw Error();const value=JSON.parse(raw),snapshot=checkedPredictions(value);if(snapshot.provider!==id)throw Error();if(ticket!==generation||!allowed())return;if(snapshot.observedAt>=(snapshots.get(id)?.observedAt??0))snapshots.set(id,snapshot);if(value.stale)failures.add(id);else failures.delete(id);save();}
   catch{if(ticket===generation&&!c.signal.aborted)failures.add(id);}
   finally{if(ticket===generation){controllers.delete(id);paint();}}
  }));
  if(ticket===generation&&allowed()&&automatic())timer=setTimeout(()=>load(),60000);
 }
 function wake(){cancel();if(allowed())void load();paint();}
 document.addEventListener('visibilitychange',wake);addEventListener('online',wake);addEventListener('offline',wake);addEventListener('pagehide',cancel);addEventListener('market-live-change',()=>{cancel();if(allowed()&&automatic())void load();paintStatus();});
 try{const raw=localStorage.getItem(savedKey);if(raw&&raw.length<=8*1024*1024){const data=JSON.parse(raw);if(Array.isArray(data)&&data.length<=3)for(const v of data){const s=checkedPredictions(v);snapshots.set(s.provider,s);}}}catch{}
 paint();
 return {show(value,hyperId){target.hidden=!value;if(visible===value&&!hyperId)return;visible=value;if(!value){cancel();dialog.close();hyper.show(false);}else if(hyperId){selected='hyperliquid:'+hyperId;discovery.hidden=true;native.hidden=false;hyper.show(true,'predictions',hyperId);}else{paint();void load();if(!native.hidden)hyper.show(true,'predictions');}}};
}
