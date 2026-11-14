import {HYPERLIQUID} from './hyperliquid-environment.js';
import {hyperliquidRequest} from './hyperliquid-catalog.js';
import {checkedHyperliquidEvent} from './hyperliquid-feed.js';
import {degenRequest,checkedCandles} from './degen-model.js';

const ns='http://www.w3.org/2000/svg',entries=new Map(),views=new Map();
let running=0;
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
const automatic=()=>document.querySelector('#market-live')?.checked!==false;
const online=()=>navigator.onLine&&!document.hidden;
export const hyperHistory=row=>({kind:'hyperliquid',marketId:`${HYPERLIQUID.chainId}:${row.kind}:${row.sides?.[0]?.coin??row.coin}`});
export const poolHistory=row=>row.chain.gecko?{kind:'pool',network:row.chain.gecko,pool:row.pool,address:row.address}:null;

function identify(source){
 if(source?.kind==='hyperliquid')return {endpoint:'/api/markets/hyper-tape',request:hyperliquidRequest({marketId:source.marketId,interval:'1h',privacy:'public'}),label:'7d'};
 if(source?.kind==='pool')return {endpoint:'/api/degen/read',request:degenRequest({provider:'geckoterminal',kind:'candles',network:source.network,pool:source.pool,address:source.address,interval:'1h'}),label:'7d'};
 return null;
}
function repaint(entry){for(const view of entry.views){if(view.element.isConnected)view.paint();else{observer.unobserve(view.element);views.delete(view.element);entry.views.delete(view);}}}
async function read(entry){
 running++;entry.pending=true;
 try{
  const r=await fetch(entry.source.endpoint,{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(entry.source.request),signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error('History unavailable');const raw=await r.text();if(raw.length>300000)throw Error('History too large');const value=JSON.parse(raw);
  const snapshot=entry.source.request.provider?checkedCandles(value,entry.source.request,{saved:value.stale===true}):checkedHyperliquidEvent({kind:'snapshot',tape:value},entry.source.request).tape;
  const candles=snapshot.candles.filter(c=>c.time>=Date.now()-7*86400000);
  entry.points=candles.map(c=>Number(c.close));entry.times=candles.map(c=>c.time);entry.at=snapshot.observedAt;entry.failed=value.stale===true;entry.next=Date.now()+(entry.failed?Math.max(3000,Math.min(60000,Number(value.retryAfterMs)||60000)):300000);
 }catch{entry.failed=true;entry.next=Date.now()+60000;}finally{entry.pending=false;running--;repaint(entry);pump();}
}
function pump(){
 if(!online())return;
 for(const [key,entry]of entries){
  if(!entry.views.size&&entries.size>300){entries.delete(key);continue;}
  if(running>=3)break;
  if(entry.source&&!entry.pending&&Date.now()>=entry.next&&(!entry.at||automatic())&&[...entry.views].some(v=>v.visible&&v.element.isConnected))void read(entry);
 }
}
const observer=new IntersectionObserver(changes=>{for(const item of changes){const view=views.get(item.target);if(view)view.visible=item.isIntersecting;}pump();},{rootMargin:'80px'});
function wake(){for(const entry of entries.values())repaint(entry);pump();}
setInterval(pump,5000);setInterval(wake,60000);document.addEventListener('visibilitychange',wake);addEventListener('online',wake);addEventListener('offline',wake);addEventListener('market-live-change',wake);

export function marketSparkline({key,source}={}){
 const element=document.createElement('span');element.className='market-sparkline';let current={};
 let descriptor=null;try{descriptor=identify(source);}catch{}
 const id=descriptor?JSON.stringify(descriptor.request):key;
 let entry=id?entries.get(id):null;
 if(!entry){entry={source:descriptor,points:[],times:[],at:0,next:0,pending:false,failed:false,views:new Set()};if(id)entries.set(id,entry);}
 function paint(){
  const supplied=Array.isArray(current.points)&&current.points.length>=2&&current.points.length<=300&&current.points.every(number);
  const points=supplied?current.points.map(Number):entry.points,times=supplied?current.times:entry.times;
  const label=(supplied?(current.label??'Price history'):(entry.source?.label??'Since opened')).replace(/ · (?:CoinGecko|GeckoTerminal|Hyperliquid)$/,'');
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 160 58');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',points.length>=2?label+' price history':'Waiting for price history');
  const low=Math.min(...points),high=Math.max(...points),range=high-low;
  const first=times?.[0],duration=times?.at(-1)-first;
  const positions=points.map((p,i)=>[4+(duration>0?(times[i]-first)/duration:i/Math.max(1,points.length-1))*152,range?52-(p-low)*46/range:29]);
  if(points.length>=2){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',positions.map(p=>p.join(',')).join(' '));svg.append(line);}else if(points.length===1){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx','156');dot.setAttribute('cy','29');dot.setAttribute('r','2.5');dot.setAttribute('fill','currentColor');svg.append(dot);}
  element.className='market-sparkline '+(points.length<2?'is-waiting':points.at(-1)>=points[0]?'is-up':'is-down');
  const caption=document.createElement('small');caption.textContent=points.length>=2?label:entry.pending?'Loading chart…':'Awaiting history';
  const at=supplied?current.updatedAt:entry.at;if(at)element.title=label+' · '+new Date(at).toLocaleString();
  if(points.length>=2&&(!navigator.onLine||current.stale||entry.failed||at&&Date.now()-at>600000))caption.textContent='Saved · '+label;
  element.replaceChildren(svg,caption);
 }
 const view={element,paint,visible:false};queueMicrotask(()=>{if(element.isConnected){entry.views.add(view);views.set(element,view);observer.observe(element);}});
 return {element,update(options){current=options;
  if(!descriptor&&id&&number(options.value)){const at=options.observedAt??Date.now(),last=entry.times.at(-1);if(Number.isSafeInteger(at)&&at>0&&at<=Date.now()+5000&&(!last||at>last)){entry.points.push(Number(options.value));entry.times.push(at);entry.points=entry.points.slice(-168);entry.times=entry.times.slice(-168);entry.at=at;}}
  paint();return element;
 }};
}
