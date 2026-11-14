import {marketSparkline} from './market-sparkline.js';
import {workspaceHeading,sectionArtwork} from './workspace-heading.js';
import {PREDICTION_PROVIDERS,checkedPredictions,mergePredictionPage} from './prediction-model.js';
import {mountHyperliquid} from './hyperliquid-ui.js';
import {PERP_ICONS} from './perp-icons.js';
import {HYPERLIQUID_ARTWORK} from './hyperliquid-artwork.js';
import {HYPERLIQUID} from './hyperliquid-environment.js';
import {showComingSoon} from './release-availability.js';

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
 const source=event.provider==='hyperliquid'&&local?local:event.provider==='kalshi'?'/api/markets/prediction-image?event='+encodeURIComponent(event.id):event.image?'/api/markets/prediction-image?url='+encodeURIComponent(event.image):null;
 if(source){const img=el('img');let retries=0;img.alt='';img.width=72;img.height=72;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.onload=()=>box.classList.add('has-image');img.onerror=()=>{if(retries++<2&&navigator.onLine)setTimeout(()=>{if(img.isConnected&&navigator.onLine)img.src=source;},retries*2000);else img.remove();};img.src=source;box.append(img);}
 return box;
}
function probability(outcome,key,observedAt){
 const line=el('div',undefined,'prediction-probability');line.append(el('span',outcome.name),el('strong',percent(outcome.probability)));
 const meter=el('span',undefined,'prediction-meter'),fill=el('span');meter.setAttribute('aria-hidden','true');fill.style.width=(outcome.probability??0)*100+'%';meter.append(fill);const spark=marketSparkline({key,source:outcome.coin?{kind:'hyperliquid',marketId:HYPERLIQUID.chainId+':outcome:'+outcome.coin}:null});spark.update({value:outcome.probability,observedAt});line.append(spark.element);return line;
}
export function mountPredictions(target){
 let visible=false,provider='',category='All events',search='',sort='activity',limit=18,selected=null,timer=null,generation=0,detailSnapshot=null,detailController=null,saveError='';
 const snapshots=new Map(),failures=new Set(),controllers=new Map(),details=new Map();
 const automatic=()=>document.querySelector('#market-live')?.checked===true;
 const allowed=()=>visible&&navigator.onLine&&!document.hidden;
 target.classList.add('prediction-workspace');
 const discovery=el('div'),hero=workspaceHeading({title:'Predictions',kind:'predictions',description:'Polymarket, Kalshi and Hyperliquid.'});
 const refresh=button('↻',()=>load(true));
 refresh.setAttribute('aria-label','Refresh events');refresh.title='Refresh events';hero.actions.append(refresh);
 for(const [b,d]of [[refresh,'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2'],]){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',d);svg.append(path);b.replaceChildren(svg);}
 const status=el('p',undefined,'prediction-status');status.setAttribute('role','status');
 const controls=el('div',undefined,'prediction-controls'),query=el('input');query.type='search';query.placeholder='Search events';query.setAttribute('aria-label','Search events');query.maxLength=100;query.oninput=()=>{search=query.value.trim().toLowerCase();limit=18;paint();};
 const markets=el('select');markets.setAttribute('aria-label','Prediction market');for(const [key,name] of [['','All markets'],...Object.entries(PREDICTION_PROVIDERS)]){const o=el('option',name);o.value=key;markets.append(o);}markets.onchange=()=>{provider=markets.value;limit=18;paint();};
 const order=el('select');order.setAttribute('aria-label','Sort events');for(const [key,name] of [['activity','Activity'],['closing','Closing soon'],['name','A–Z']]){const o=el('option',name);o.value=key;order.append(o);}order.onchange=()=>{sort=order.value;paint();};controls.append(query,markets,order);
 const filters=el('nav',undefined,'prediction-categories');filters.setAttribute('aria-label','Prediction categories');
 for(const label of categories){const b=button(label,()=>{category=label;limit=18;paint();});b.dataset.category=label;filters.append(b);}
 const coverage=el('div',undefined,'prediction-coverage'),count=el('h3'),sourceStates=el('div',undefined,'prediction-sources');coverage.append(count,sourceStates);
 const grid=el('div',undefined,'prediction-grid'),more=button('More events ↓',async()=>{const needPage=more.dataset.nextPage==='true';limit+=18;if(needPage)await load(false,true);paint();},'prediction-more');
 const note=el('details',undefined,'prediction-data-note');note.append(el('summary','About these prices'),el('p','Browse the providers’ event pages with More events. Search and category filters apply to the events loaded so far. Open an event to read its outcomes and rules. Activity is ranked within each provider. Percentages reflect observed prices, not guaranteed probabilities. Kalshi volume is in contracts; Polymarket volume is in USD. Save retains the loaded events and outcomes you have opened.'));
 discovery.append(hero.element,controls,filters,coverage,status,grid,more,note);
 const native=el('div'),back=button('← All events',()=>{native.hidden=true;discovery.hidden=false;hyper.show(false);hero.showTools(true);paint();target.querySelector(`[data-event-id="${CSS.escape(selected??'')}"]`)?.focus();},'prediction-back'),nativeMarket=el('section');nativeMarket.hidden=true;native.append(back,nativeMarket);native.hidden=true;
 const hyper=mountHyperliquid(nativeMarket);
 const dialog=el('dialog',undefined,'prediction-dialog');dialog.setAttribute('aria-label','Prediction event details');dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 dialog.addEventListener('close',()=>{detailController?.abort();detailController=null;});
 target.append(discovery,native,dialog);
 function save(){try{localStorage.setItem(savedKey,JSON.stringify([...snapshots.values()].map(s=>({...s,events:s.events.map(e=>details.get(e.id)??e)}))));saveError='';}catch{saveError='Could not save events on this device.';}}
 function allEvents(){return [...snapshots.values()].flatMap(s=>s.events);}
 function paintStatus(){
  refresh.hidden=automatic()&&!failures.size&&navigator.onLine;refresh.disabled=controllers.size>0||!navigator.onLine;
  status.textContent=[!navigator.onLine?'Offline · Showing saved events':controllers.size?'Updating events…':failures.size?'Some sources could not refresh. Earlier events are marked saved.':'',saveError].filter(Boolean).join(' · ');
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
  count.textContent=`${events.length.toLocaleString()} events loaded`;
  const totals=allEvents().filter(e=>e.provider==='polymarket'),sum=key=>totals.length&&totals.some(e=>e[key]!==null)?totals.reduce((n,e)=>n+(e[key]??0),0):null;
  const dollars=key=>sum(key)===null?'—':'$'+compact(sum(key));
  hero.setMetrics([{label:'Events loaded',value:allEvents().length.toLocaleString()},{label:'Total volume',raw:sum('totalVolume'),value:dollars('totalVolume'),detail:'Polymarket'},{label:'24h volume',raw:sum('volume'),value:dollars('volume'),detail:'Polymarket'},{label:'Sources',value:String(snapshots.size)}],'Figures cover loaded events. Kalshi contract counts are kept separate from USD totals.');
  for(const b of filters.children){b.setAttribute('aria-pressed',String(category===b.dataset.category));const available=allEvents().some(e=>(!provider||e.provider===provider)&&e.category===b.dataset.category);b.hidden=b.dataset.category!=='All events'&&!available&&category!==b.dataset.category;}
  sourceStates.replaceChildren();for(const [id,name]of Object.entries(PREDICTION_PROVIDERS)){const snapshot=snapshots.get(id),state=controllers.has(id)?'Updating':!snapshot?'Unavailable':!navigator.onLine||failures.has(id)||Date.now()-snapshot.observedAt>120000?'Saved':'Read';const n=el('span',`${name} · ${state}`,state==='Saved'||state==='Unavailable'?'is-saved':'');n.title=snapshot?`Read ${stamp(snapshot.observedAt)}`:name;sourceStates.append(n);}
  grid.replaceChildren();
  for(const event of events.slice(0,limit)){
   const card=button('',()=>openEvent(event),'prediction-card');card.dataset.eventId=event.id;card.dataset.lenzCard='';card.dataset.lenzTone=event.category==='Crypto'?'blue':event.category==='Economy'?'gold':'purple';
   const head=el('div',undefined,'prediction-card-heading'),title=el('h4',event.title);head.append(artwork(event),title);
   const source=el('div',undefined,'prediction-card-source');source.append(el('span',PREDICTION_PROVIDERS[event.provider]),el('span',event.category));
   const outcomes=el('div',undefined,'prediction-card-outcomes');
   if(event.markets.length===1){for(const outcome of event.markets[0].outcomes.slice(0,3))outcomes.append(probability(outcome,event.id+':'+event.markets[0].id+':'+outcome.name,event.observedAt));}
   else for(const market of event.markets.slice(0,3)){
    const leader=market.outcomes.find(o=>o.name.toLowerCase()==='yes')??[...market.outcomes].sort((a,b)=>(b.probability??-1)-(a.probability??-1))[0];outcomes.append(probability({name:market.title+(leader.name.toLowerCase()==='yes'?'':` · ${leader.name}`),probability:leader.probability,coin:leader.coin},event.id+':'+market.id+':'+leader.name,event.observedAt));
   }
   if(!event.hydrated){outcomes.append(el('p',event.description?event.description.slice(0,150)+(event.description.length>150?'…':''):'Explore the outcomes and resolution rules.','prediction-preview-copy'),el('span','View outcomes →','prediction-preview-action'));}
   const foot=el('div',undefined,'prediction-card-footer');foot.append(el('span',event.volume===null?'Volume unavailable':`${event.volumeUnit==='USD'?'$':''}${compact(event.volume)}${event.volumeUnit==='USD'?'':' '+event.volumeUnit} / 24h`),el('span','↗','arrow'));
   const snapshot=snapshots.get(event.provider),at=event.observedAt??snapshot.observedAt,read=el('small',`${!navigator.onLine||failures.has(event.provider)||Date.now()-at>120000?'Saved · ':''}Read ${stamp(at)}`,'prediction-card-time');
   card.append(source,head,outcomes,el('small',event.markets.length>1?`${event.markets.length} markets · ${date(event.endsAt)}`:date(event.endsAt),'prediction-card-date'),foot,read);grid.append(card);
  }
  if(!events.length){const empty=el('div',undefined,'prediction-empty');empty.append(sectionArtwork('predictions'),el('h4',controllers.size?'Finding events…':'No events here yet'),el('p',search||category!=='All events'?'Try another category or search.':navigator.onLine?'Refresh to try the public sources again.':'Connect to load events, or open a saved selection.'));grid.append(empty);}
  const hasNext=[...snapshots.values()].some(s=>(!provider||s.provider===provider)&&s.nextCursor);more.dataset.nextPage=String(events.length<=limit&&hasNext);more.hidden=events.length<=limit&&!hasNext;more.disabled=controllers.size>0;more.textContent=controllers.size?'Loading events…':events.length<=limit&&hasNext?'Load next event page ↓':'More events ↓';paintStatus();if(focused)[...grid.children].find(c=>c.dataset.eventId===focused)?.focus({preventScroll:true});
 }
 function openEvent(event){
  selected=event.id;
  detailController?.abort();detailController=null;
  const remembered=details.get(event.id);if(!event.hydrated&&remembered&&(!navigator.onLine||Date.now()-remembered.observedAt<60000))event=remembered;
  dialog.replaceChildren();const close=button('×',()=>dialog.close(),'prediction-close');close.setAttribute('aria-label','Close event');
  const head=el('div',undefined,'prediction-detail-heading');head.append(artwork(event),el('h3',event.title));
  const snapshot=snapshots.get(event.provider);detailSnapshot={...snapshot,observedAt:event.observedAt??snapshot.observedAt};dialog.append(close,el('p',undefined,'prediction-card-source'),head);
  dialog.append(el('p','Outcome trading · Coming soon','prediction-status'));
  if(!event.hydrated){const message=el('p',navigator.onLine?'Loading outcomes and rules…':'Outcome details were not saved. Connect to load them.','prediction-detail-loading');dialog.append(message);if(event.description)dialog.append(el('p',event.description,'prediction-preview-copy'));if(!dialog.open)dialog.showModal();paintStatus();close.focus();if(navigator.onLine){const c=new AbortController();detailController=c;readProvider(event.provider,{eventId:event.id.slice(event.provider.length+1)},c.signal).then(value=>{if(detailController!==c||!dialog.open||selected!==event.id)return;const full=value.events.find(e=>e.id===event.id);if(!full)throw Error('No active outcomes');details.set(full.id,full);save();detailController=null;openEvent(full);}).catch(()=>{if(detailController!==c)return;detailController=null;message.textContent='Outcomes could not load. Your event list is still available.';dialog.append(button('Retry outcomes',()=>openEvent(event)));});}return;}
  const body=el('div',undefined,'prediction-detail-markets');let shown=0;
  const next=button('More markets ↓',appendMarkets,'prediction-more');
  function appendMarkets(){for(const m of event.markets.slice(shown,shown+20)){
   const part=el('section',undefined,'prediction-detail-market');part.append(el('h4',m.question||m.title));for(const outcome of m.outcomes)part.append(probability(outcome,event.id+':'+m.id+':'+outcome.name,event.observedAt));part.append(el('p',`${m.basis} · Closes ${date(m.endsAt)}`,'prediction-card-date'));
   const rules=el('details');rules.append(el('summary','Resolution rules'),el('p',m.rules||'Resolution rules are unavailable.'));part.append(rules);body.append(part);
  }shown+=20;next.hidden=shown>=event.markets.length;}
  appendMarkets();dialog.append(body,next);
  const actions=el('div',undefined,'prediction-detail-actions');
  const trade=button('Trade',()=>showComingSoon(trade));actions.append(trade);
  if(event.hyperId){const open=button('Open market in Lenz',()=>{dialog.close();discovery.hidden=true;native.hidden=false;hero.showTools(false);hyper.show(true,'predictions',event.hyperId);back.focus();});open.dataset.nativeMarket=event.hyperId;actions.append(open);}
  if(event.provider==='kalshi'){const ticker=event.id.slice('kalshi:'.length),copy=button('Copy event code',async()=>{try{await navigator.clipboard.writeText(ticker);copy.textContent='Copied';}catch{copy.textContent=ticker;}});actions.append(copy);dialog.append(el('p',`Event code: ${ticker}`,'prediction-status'));}
  dialog.append(actions);if(!dialog.open)dialog.showModal();paintStatus();close.focus();
 }
 async function readProvider(id,options,signal){const res=await fetch('/api/markets/predictions',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({provider:id,privacy:'public',...options}),signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});if(!res.ok)throw Error();const raw=await res.text();if(raw.length>8*1024*1024)throw Error();const value=JSON.parse(raw),snapshot=checkedPredictions(value);if(snapshot.provider!==id)throw Error();return {...snapshot,stale:value.stale===true};}
 function cancel(){generation++;clearTimeout(timer);for(const c of controllers.values())c.abort();controllers.clear();detailController?.abort();detailController=null;}
 async function load(force=false,extend=false){
  if(!allowed())return;clearTimeout(timer);const ticket=generation;
  await Promise.all(Object.keys(PREDICTION_PROVIDERS).map(async id=>{
   const prior=snapshots.get(id),cursor=extend?prior?.nextCursor:null;
   if(controllers.has(id)||extend&&(!cursor||provider&&provider!==id)||!extend&&!force&&prior&&Date.now()-prior.observedAt<60000)return;
   const c=new AbortController();controllers.set(id,c);paintStatus();
   try{const value=await readProvider(id,cursor?{cursor}:{},c.signal);if(ticket!==generation||!allowed())return;const snapshot=mergePredictionPage(prior,value,{extend,reset:force});snapshots.set(id,snapshot);if(value.stale)failures.add(id);else failures.delete(id);save();}
   catch{if(ticket===generation&&!c.signal.aborted)failures.add(id);}
   finally{if(ticket===generation){controllers.delete(id);paint();}}
  }));
  if(ticket===generation&&allowed()&&automatic())timer=setTimeout(()=>load(),60000);
 }
 function wake(){cancel();if(allowed())void load();paint();}
 document.addEventListener('visibilitychange',wake);addEventListener('online',wake);addEventListener('offline',wake);addEventListener('pagehide',cancel);addEventListener('market-live-change',()=>{cancel();if(allowed()&&automatic())void load();paintStatus();});
 try{const raw=localStorage.getItem(savedKey);if(raw&&raw.length<=8*1024*1024){const data=JSON.parse(raw);if(Array.isArray(data)&&data.length<=3)for(const v of data){try{const s=checkedPredictions(v);if(snapshots.has(s.provider))throw Error('Duplicate prediction source');snapshots.set(s.provider,s);for(const e of s.events)if(e.hydrated)details.set(e.id,e);}catch{}}}}catch{}
 paint();
 return {show(value,hyperId){target.hidden=!value;hero.showTools(value&&native.hidden);if(visible===value&&!hyperId)return;visible=value;if(!value){cancel();dialog.close();hyper.show(false);}else if(hyperId){selected='hyperliquid:'+hyperId;discovery.hidden=true;native.hidden=false;hero.showTools(false);hyper.show(true,'predictions',hyperId);}else{paint();void load();if(!native.hidden)hyper.show(true,'predictions');}}};
}
