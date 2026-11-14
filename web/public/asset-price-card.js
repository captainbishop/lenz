import {assetIcon} from './asset-icon.js';
import {EVM_MARKETS} from './evm-markets.js';
import {MARKET_ASSETS,checkedMarketAssets} from './market-assets.js';
import {marketSparkline} from './market-sparkline.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export const priceChange=(price,previous)=>finite(price)&&finite(previous)&&Number(previous)>0?(Number(price)/Number(previous)-1)*100:null;
const number=v=>finite(v)?Number(v)>0&&Number(v)<.000001?Number(v).toExponential(3):Number(v).toLocaleString(undefined,{maximumSignificantDigits:7}):'—';
const compact=v=>finite(v)?Number(v).toLocaleString(undefined,{notation:'compact',maximumFractionDigits:2}):'—';
const change=v=>finite(v)?`${Number(v)>0?'▲ ':Number(v)<0?'▼ ':''}${Math.abs(Number(v)).toLocaleString(undefined,{maximumFractionDigits:2})}%`:'24h —';
let context=null,pending=null,nextRead=0,generation=0,saveError='';const listeners=new Set();
try{const raw=localStorage.getItem('lenz-asset-prices-v1');if(raw&&raw.length<=128000)context={...checkedMarketAssets(JSON.parse(raw)),stale:true};}catch{}
export function saveAssetPrices(){if(context)localStorage.setItem('lenz-asset-prices-v1',JSON.stringify(context));}
export function forgetAssetPrices(){generation++;localStorage.removeItem('lenz-asset-prices-v1');context=null;nextRead=0;saveError='';notify();}
function notify(){for(const entry of listeners){if(entry.element.isConnected)entry.paint();else listeners.delete(entry);}}
function wake(){notify();if([...listeners].some(e=>e.element.checkVisibility())&&document.querySelector('#market-live')?.checked!==false)void loadAssetPrices();}
setInterval(wake,60000);document.addEventListener('visibilitychange',wake);addEventListener('offline',notify);addEventListener('market-live-change',wake);
export async function loadAssetPrices(){
 if(!navigator.onLine||document.hidden||Date.now()<nextRead)return;
 const ticket=generation;pending??=(async()=>{try{const r=await fetch('/api/markets/assets',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const raw=await r.text();if(raw.length>128000)throw Error();const value=checkedMarketAssets(JSON.parse(raw));if(ticket!==generation||!navigator.onLine||document.hidden)return;context=value;try{saveAssetPrices();saveError='';}catch{saveError='Price could not be saved on this device.';}nextRead=Date.now()+(context.stale?60000:300000);}catch{nextRead=Date.now()+60000;}finally{pending=null;notify();}})();return pending;
}
addEventListener('online',()=>{nextRead=0;void loadAssetPrices();});
addEventListener('pagehide',()=>{generation++;});addEventListener('offline',()=>{generation++;});document.addEventListener('visibilitychange',()=>{if(document.hidden)generation++;});
export function assetPriceCard(options){
 if(!options.referenceKey&&options.contract&&options.network){const network=Object.entries(EVM_MARKETS).find(([key,n])=>key===options.network||n.chainId===options.network)?.[1],token=network?.tokens.find(t=>t.id===options.contract);if(token)options={...options,referenceKey:token.symbol};}
 const element=el('span',undefined,'asset-price-card'),identity=el('span',undefined,'asset-price-identity'),copy=el('span'),name=el(options.nameTag??'strong',options.name??options.symbol),subtitle=el('small',options.subtitle??''),values=el('span',undefined,'asset-price-values'),price=el('strong',undefined,'asset-price-value'),delta=el('small',undefined,'asset-price-change'),plot=el('span',undefined,'asset-price-plot');
 let spark=marketSparkline({key:options.historyKey,source:options.historySource});plot.append(spark.element);
 copy.append(name,subtitle);identity.append(options.icon??assetIcon(options),copy);values.append(price,delta);element.append(identity,values,plot);element.dataset.assetKey=options.referenceKey??'';
 const metrics=el('dl',undefined,'asset-price-metrics'),stamp=el('small',undefined,'asset-price-source');if(options.metrics)element.append(metrics);if(options.metrics||options.referenceKey)element.append(stamp);
 let current={...options};
 function paint(){
  const ref=context?.assets.find(a=>a.key===current.referenceKey),useReference=current.referencePrice===true;
  const amount=useReference?ref?.price:current.price,changed=useReference||current.referenceChange?ref?.change:current.change;
  price.textContent=current.priceLabel??(finite(amount)?(current.quote==='USD'?'$':'')+number(amount)+(current.quote&&current.quote!=='USD'?' '+current.quote:''):'—');
  price.title=finite(amount)?String(amount)+(current.quote?' '+current.quote:''):'';
  delta.textContent=change(changed);delta.className='asset-price-change '+(changed>0?'is-up':changed<0?'is-down':'');delta.title='24h change';
  const points=current.history??(current.historySource?null:ref?.history);
  spark.update({points,value:amount,observedAt:current.observedAt,label:current.historyLabel??(ref&&finite(ref.change7d)?(ref.change7d>0?'+':'')+ref.change7d.toFixed(2)+'% · 7d':'7d'),updatedAt:current.historyUpdatedAt??ref?.updatedAt,stale:current.historySource?false:context?.stale});
  stamp.textContent=[ref?(!navigator.onLine?'Saved · Updated '+new Date(ref.updatedAt).toLocaleString():context.stale||Date.now()-ref.updatedAt>600000?'Saved price':''):'',ref?saveError:''].filter(Boolean).join(' · ');
  if(current.metrics){metrics.replaceChildren();for(const [label,value]of [['Market cap',finite(current.marketCap??ref?.marketCap)?'$'+compact(current.marketCap??ref?.marketCap):'—'],['24h volume',finite(current.volume??ref?.volume)?(current.volumeQuote??'USD')==='USD'?'$'+compact(current.volume??ref?.volume):compact(current.volume)+' '+current.volumeQuote:'—'],['Circulating supply',finite(ref?.supply)?compact(ref.supply)+' '+ref.key:'—'],['Sentiment','Not supplied']]){const cell=el('div');cell.append(el('dt',label),el('dd',value));metrics.append(cell);}}

 }
 const entry={element,paint};if(current.referenceKey&&Object.hasOwn(MARKET_ASSETS,current.referenceKey))queueMicrotask(()=>{if(element.isConnected){listeners.add(entry);if(element.checkVisibility())void loadAssetPrices();}});paint();
 return {element,priceElement:price,update(value){if(Object.hasOwn(value,'historySource')&&JSON.stringify(value.historySource)!==JSON.stringify(current.historySource)){spark=marketSparkline({key:current.historyKey,source:value.historySource});plot.replaceChildren(spark.element);}current={...current,...value};paint();}};
}
