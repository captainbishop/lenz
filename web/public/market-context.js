import {checkedIndices} from './market-indices.js';
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const svgNode=(tag,attributes)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attributes))e.setAttribute(k,v);return e;};
function indexCard(kind,value){
 const fear=kind==='fearGreed',title=fear?'Fear and Greed Index':'Altcoin Season Index',card=node('article',undefined,'market-index-card '+(fear?'fear-greed-card':'alt-season-card'));
 const heading=node('h4',title),info=node('span','ⓘ','market-index-info');info.title=fear?'Market sentiment from 0 (extreme fear) to 100 (extreme greed).':'How many of the top 100 eligible coins outperformed Bitcoin over 90 days. Bitcoin season: 25 or below. Altcoin season: 75 or above.';heading.append(info);card.append(heading);
 if(fear){
  const gauge=node('div',undefined,'fear-greed-gauge'),svg=svgNode('svg',{viewBox:'0 0 240 135','aria-hidden':'true'});
  const point=score=>{const a=Math.PI*(1-score/100);return [120+106*Math.cos(a),120-106*Math.sin(a)];};
  for(const [i,color]of ['var(--index-fear)','var(--index-caution)','var(--index-neutral)','var(--index-optimism)','var(--index-greed)'].entries()){const a=point(i*20+2),b=point((i+1)*20-2);svg.append(svgNode('path',{d:`M${a} A106 106 0 0 1 ${b}`,stroke:color,fill:'none','stroke-width':9,'stroke-linecap':'round'}));}
  if(value){const [cx,cy]=point(value.value);svg.append(svgNode('circle',{cx,cy,r:11,class:'index-indicator'}));}
  const reading=node('div',undefined,'fear-greed-reading');reading.append(node('strong',value?String(value.value):'—'),node('span',value?.classification??(value?'Sentiment':'Unavailable')));gauge.append(svg,reading);card.append(gauge);
 }else{
  const reading=node('div',undefined,'alt-season-reading');reading.append(node('strong',value?String(value.value):'—'),node('span','/100'));card.append(reading);
  const labels=node('div',undefined,'alt-season-labels');labels.append(node('span','Bitcoin Season'),node('span','Altcoin Season'));
  const scale=node('div',undefined,'alt-season-scale');scale.setAttribute('role','img');scale.setAttribute('aria-label',value?`Altcoin season index: ${value.value} out of 100`:'Altcoin season index unavailable');
  if(value){const marker=node('span',undefined,'alt-season-marker');marker.style.left=value.value+'%';scale.append(marker);}card.append(labels,scale);
 }
 card.append(node('small',value?(!navigator.onLine?'Saved · Updated '+new Date(value.updatedAt).toLocaleString():Date.now()-value.updatedAt>600000?'Saved index':''):'Index unavailable','market-index-source'));return card;
}
const key='lenz-market-context-v1';
const checked=value=>{if(value?.version!==1||value.provider!=='coinmarketcap'||!Number.isSafeInteger(value.observedAt)||value.observedAt<=0||value.observedAt>Date.now()+5000||!['marketCap','volume24h','btcDominance'].every(k=>value[k]===null||typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>=0)||value.btcDominance>100)throw Error('Invalid market context');return value;};
export function mountMarketContext(target,{changed=()=>{}}={}){
 let indices={},value=null,visible=false,controller=null,timer=null,failed=false,saveError='';
 const section=document.createElement('section');section.className='market-context';section.setAttribute('aria-label','Global market data');target.append(section);
 function paint(){
  section.replaceChildren();const head=document.createElement('div');head.className='market-context-heading';const title=document.createElement('h3');title.textContent='Market Status';head.append(title);section.append(head);
  const grid=node('dl',undefined,'market-status-grid');for(const [label,k,unit]of [['Market cap','marketCap','$'],['24h volume','volume24h','$'],['BTC dominance','btcDominance','%']]){const cell=node('div'),n=value?.[k];cell.append(node('dt',label),node('dd',n===null||n===undefined?'—':unit==='$'?'$'+n.toLocaleString(undefined,{notation:'compact',maximumFractionDigits:2}):n.toLocaleString(undefined,{maximumFractionDigits:1})+'%'));grid.append(cell);}
  section.append(grid);
  const indicesGrid=node('div',undefined,'market-index-grid');indicesGrid.append(indexCard('fearGreed',indices.fearGreed),indexCard('altcoinSeason',indices.altcoinSeason));section.append(indicesGrid);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent=[value?(!navigator.onLine?'Saved data · '+new Date(value.observedAt).toLocaleString():failed||Date.now()-value.observedAt>120000?'Saved data':''):controller?'Loading market data…':'Market data unavailable',saveError].filter(Boolean).join(' · ');status.hidden=!status.textContent;section.append(status);changed();
 }
 const allowed=()=>visible&&navigator.onLine&&!document.hidden;
 async function load(){if(!allowed()||controller)return;const c=new AbortController();controller=c;paint();const indexRead=fetch('/api/markets/indices',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(20000)])}).then(async r=>{if(!r.ok)throw Error();const raw=await r.text();if(raw.length>10000)throw Error();const next=checkedIndices(JSON.parse(raw));if(controller===c&&allowed()){indices={...indices,...next};save();}}).catch(()=>{});try{const r=await fetch('/api/markets/context',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(18000)])});if(!r.ok)throw Error();const v=checked(await r.json());if(controller!==c||!allowed())return;value=v;failed=v.stale===true;save();}catch{if(controller===c)failed=true;}finally{await indexRead;if(controller===c){controller=null;paint();if(allowed()&&document.querySelector('#market-live')?.checked)timer=setTimeout(load,60000);}}}
 function save(){try{if(Object.keys(indices).length)localStorage.setItem('lenz-market-indices-v1',JSON.stringify(indices));if(value)localStorage.setItem(key,JSON.stringify(value));saveError='';}catch{saveError='Market data could not be saved on this device.';}}
 function cancel(){clearTimeout(timer);controller?.abort();controller=null;}
 function wake(){cancel();paint();if(allowed())void load();}
 addEventListener('offline',wake);addEventListener('online',wake);addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',wake);addEventListener('market-live-change',()=>{cancel();if(allowed()&&document.querySelector('#market-live')?.checked)void load();});
 try{const raw=localStorage.getItem(key);if(raw&&raw.length<10000)value=checked(JSON.parse(raw));}catch{}
 try{const raw=localStorage.getItem('lenz-market-indices-v1');if(raw&&raw.length<10000)indices=checkedIndices(JSON.parse(raw));}catch{}
 paint();return {show(v){if(v===visible)return;visible=v;if(v){paint();void load();}else cancel();},hasSnapshot(){return Boolean(value)||Object.keys(indices).length>0;},refresh(){clearTimeout(timer);return load();},forget(){cancel();localStorage.removeItem(key);localStorage.removeItem('lenz-market-indices-v1');indices={};value=null;saveError='';paint();}};
}
