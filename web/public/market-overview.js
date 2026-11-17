import {HYPERLIQUID} from './hyperliquid-environment.js';
import {hyperHistory} from './market-sparkline.js';
import {assetPriceCard,priceChange,loadAssetPrices,forgetAssetPrices} from './asset-price-card.js';
import {workspaceHeading,sectionArtwork,sectionTone} from './workspace-heading.js';
import {checkedHyperliquidCatalog} from './hyperliquid-catalog.js';
import {marketLogo} from './market-logo.js';
import {marketSource} from './evm-markets.js';
import {marketFreshness} from './market-snapshot.js';
import {mountMarketContext} from './market-context.js';

const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const action=(label,fn,key=label)=>{const e=node('button',label);e.type='button';e.onclick=fn;e.dataset.overviewFocus=key;return e;};
const number=value=>value===null||value===undefined?'—':Number(value).toLocaleString(undefined,{maximumSignificantDigits:6});
const volume=value=>Number(value).toLocaleString(undefined,{notation:'compact',maximumFractionDigits:1});
const savedKey=HYPERLIQUID.catalogKey;
const coreKey=savedKey+'-core-perps';
const artwork=kind=>{const img=sectionArtwork(kind);img.classList.add('overview-artwork');return img;};

export function mountMarketOverview(target,{open,snapshots,refreshSources,forgetSources}){
  let visible=false,catalog=null,partial=false,controller=null,timer=null,error='',notice='';
  const automatic=()=>document.querySelector('#market-live')?.checked===true;
  let wasAutomatic=automatic();
  const allowed=()=>visible&&navigator.onLine&&!document.hidden;
  target.className='market-overview';
  const hero=workspaceHeading({title:'Market overview',description:'Activity across spot, perpetuals and DeFi.'}),heading=hero.element;heading.classList.add('overview-heading');
  const actions=hero.actions,refresh=action('Refresh overview',()=>{void load();void refreshSources();}),forget=action('Remove saved overview',()=>{try{cancel();catalog=null;partial=false;localStorage.removeItem(savedKey);localStorage.removeItem(coreKey);forgetSources();forgetAssetPrices();notice='Saved overview removed.';}catch{notice='Could not remove saved overview.';}paintStatus();});
  for(const [b,path]of [[refresh,'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2'],[forget,'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6']]){b.setAttribute('aria-label',b.textContent);b.title=b.textContent;b.textContent='';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');p.setAttribute('d',path);svg.append(p);b.append(svg);actions.append(b);}
  actions.classList.add('overview-actions');const tools=hero.tools;tools.id='overview-tools';tools.querySelector('summary').setAttribute('aria-label','Overview tools');tools.querySelector('summary').title='Overview tools';
  const status=node('p',undefined,'overview-status');status.setAttribute('role','status');
  const counts=node('nav',undefined,'overview-counts');counts.setAttribute('aria-label','Market coverage');
  const panels=node('div',undefined,'overview-panels'),venues=node('div',undefined,'overview-venues');
  const strip=node('div',undefined,'market-ticker-strip');strip.setAttribute('aria-label','Asset reference prices');for(const [symbol,name]of [['BTC','Bitcoin'],['ETH','Ethereum'],['NEAR','NEAR'],['SOL','Solana'],['HYPE','HYPE']])strip.append(assetPriceCard({name:symbol,symbol,trusted:true,referenceKey:symbol,referencePrice:true,quote:'USD'}).element);target.append(heading,status,strip,counts,panels,venues);
  const pulse=document.createElement('div');counts.before(pulse);let context;context=mountMarketContext(pulse,{changed:paintStatus});
  refresh.addEventListener('click',()=>{context.refresh();void loadAssetPrices();});
  forget.addEventListener('click',()=>context.forget());

  function paintStatus(){
    refresh.disabled=Boolean(controller)||!navigator.onLine;
    status.textContent=[catalog?(!navigator.onLine?'Offline · Saved data':''):navigator.onLine?'Loading market overview…':'No saved overview on this device.',partial?(controller?'Loading more markets…':'Core perpetual markets'):controller?'Refreshing…':'',catalog?.unavailable.length?'Some markets unavailable':'',error,notice].filter(Boolean).join(' · ');status.hidden=!status.textContent;
  }
  function section(title,subtitle,view,kind=view){
    const part=node('section',undefined,`overview-section overview-tone-${kind}`),head=node('div',undefined,'overview-section-heading'),copy=node('div',undefined,'overview-section-copy'),link=action('↗',()=>open(view),'section:'+title);
    link.setAttribute('aria-label',`View all: ${title}`);link.title=`View all: ${title}`;copy.append(node('h3',title),node('p',subtitle,'overview-caption'));head.append(artwork(kind),copy,link);part.append(head);sectionTone(part,kind);return part;
  }
  function marketRow(row,metric,group='active'){
    const view=row.kind==='spot'?'spot':row.kind==='outcome'?'predictions':'perpetuals',b=action('',()=>open(view,row.id));b.className='overview-market';b.dataset.overviewMarket=row.id;b.dataset.overviewFocus=group+row.id;
    const name=node('span',undefined,'overview-market-name');name.append(node('strong',row.name),node('small',row.venue==='HyperCore'?'Hyperliquid':row.venue));
    const values=node('span',undefined,'overview-market-value');values.append(node('strong',`${number(row.price)} ${row.quote.symbol}`),node('small',metric));if(group==='funding')b.append(marketLogo(row),name,values);else b.append(assetPriceCard({name:row.name,subtitle:metric,icon:marketLogo(row),price:row.price,quote:row.quote.symbol,change:priceChange(row.price,row.previousPrice),historySource:hyperHistory(row),referenceKey:row.kind==='perp'?row.coin:null}).element);return b;
  }
  function paint(){
    const focused=document.activeElement?.dataset.overviewFocus;
    const rows=catalog?.rows??[],spot=rows.filter(r=>r.kind==='spot'),perps=rows.filter(r=>['perp','builder'].includes(r.kind)),predictions=rows.filter(r=>r.kind==='outcome');
    const usd=rows.filter(r=>r.quote.symbol==='USDC'&&r.volume!==null),volumeTotal=usd.reduce((sum,r)=>sum+Number(r.volume),0),interest=perps.filter(r=>r.quote.symbol==='USDC'&&r.openInterest!==null&&r.price!==null);
    hero.setMetrics([{label:'Markets',value:catalog?rows.length.toLocaleString():'—'},{label:'24h volume',raw:usd.length?volumeTotal:null,value:usd.length?'$'+volume(volumeTotal):'—',detail:'USDC markets'},{label:'Open interest',raw:interest.length?interest.reduce((sum,r)=>sum+Number(r.openInterest)*Number(r.price),0):null,value:interest.length?'$'+volume(interest.reduce((sum,r)=>sum+Number(r.openInterest)*Number(r.price),0)):'—',detail:'USDC perpetuals'},{label:'Venues',value:catalog?String(new Set(rows.map(r=>r.venue)).size):'—'}],'Loaded markets');
    const observed=[...snapshots()].flatMap(snapshot=>snapshot.rows.map(row=>({row,snapshot}))),credit=observed.filter(x=>x.row.category==='credit'),pools=observed.filter(x=>x.row.category==='liquidity');
    counts.replaceChildren();
    for(const [label,view,count]of [['Spot','spot',catalog&&!partial?spot.length:null],['Perpetuals','perpetuals',catalog?perps.length:null],['Predictions','predictions',catalog&&!partial?predictions.length:null],['Lending reserves','credit',credit.length||null]]){const b=action('',()=>open(view),'count:'+view),copy=node('span',undefined,'overview-count-copy');b.className=`overview-count overview-tone-${view}`;const hint=node('small','Explore '),arrow=node('span','↗','lenz-action-arrow');arrow.setAttribute('aria-hidden','true');hint.append(arrow);copy.append(node('span',label,'overview-count-label'),node('strong',count===null?'—':String(count)),hint);b.append(copy,artwork(view));sectionTone(b,view);counts.append(b);}
    panels.replaceChildren();
    const derivatives=section('Derivatives','Loaded USDC perpetuals','perpetuals'),derivativeMetrics=node('dl',undefined,'overview-derivatives');
    for(const [label,value]of [['Open interest',interest.length?'$'+volume(interest.reduce((sum,r)=>sum+Number(r.openInterest)*Number(r.price),0)):'—'],['24h volume',perps.some(r=>r.quote.symbol==='USDC'&&r.volume!==null)?'$'+volume(perps.filter(r=>r.quote.symbol==='USDC').reduce((sum,r)=>sum+Number(r.volume??0),0)):'—'],['24h liquidations','Unavailable'],['Long / short liquidations','Unavailable']]){const cell=node('div');cell.append(node('dt',label),node('dd',value));derivativeMetrics.append(cell);}derivatives.append(derivativeMetrics,node('p','Liquidation totals and history are not supplied by the connected feed.','overview-caption'));panels.append(derivatives);
    for(const [title,view,collection]of [['Active spot markets','spot',spot],['Active perpetuals','perpetuals',perps]]){
      const part=section(title,'Reported 24h volume · USDC markets.',view),active=collection.filter(r=>r.quote.symbol==='USDC'&&Number(r.volume)>0).sort((a,b)=>Number(b.volume)-Number(a.volume)).slice(0,5);
      for(const row of active)part.append(marketRow(row,`${volume(row.volume)} ${row.quote.symbol} volume`));
      if(!active.length)part.append(node('p',catalog&&!(partial&&view==='spot')?'Volume data unavailable.':'Market activity is loading.','overview-empty'));panels.append(part);
    }
    const funding=section('Funding rates','Current rates on the most active perpetuals.','perpetuals','funding'),rates=perps.filter(r=>r.funding!==null&&r.quote.symbol==='USDC').sort((a,b)=>Number(b.volume??0)-Number(a.volume??0)).slice(0,5);
    for(const row of rates){const b=marketRow(row,'Current funding','funding'),value=b.querySelector('.overview-market-value strong'),rate=Number(row.funding)*100;value.textContent=`${rate>0?'+':''}${number(rate)}%`;value.className=rate<0?'overview-negative':'overview-positive';funding.append(b);}
    if(!rates.length)funding.append(node('p',catalog?'Funding rates unavailable.':'Funding rates are loading.','overview-empty'));panels.append(funding);
    const defi=section('On-chain markets','Reserve settings and pool fees from the supported networks.','credit');
    for(const {row,snapshot}of [...credit.slice(0,3),...pools.slice(0,3)]){
      const b=action('',()=>open(row.category,row.id),'chain:'+row.id);b.className='overview-market';const name=node('span',undefined,'overview-market-name');name.append(node('strong',row.label),node('small',marketSource(snapshot).name+(!navigator.onLine?' · '+new Date(snapshot.observedAt).toLocaleString():'')));
      const value=node('span',undefined,'overview-market-value');value.append(node('strong',row.category==='credit'?`${row.ltvBps/100}% LTV`:`${row.feePips/10000}% fee`),node('small',`${marketFreshness(snapshot,{online:navigator.onLine})} · ${row.status}`));b.append(marketLogo({kind:'spot',name:row.assets[0].symbol}),name,value);defi.append(b);
    }
    if(!credit.length&&!pools.length)defi.append(node('p','Reserve and pool data unavailable.','overview-empty'));panels.append(defi);
    venues.replaceChildren(node('span','Explore more'),action('Degen pairs →',()=>open('degen')),action('Reference prices →',()=>open('prices')),action('Liquidity pools →',()=>open('liquidity')));
    if(focused)[...target.querySelectorAll('[data-overview-focus]')].find(b=>b.dataset.overviewFocus===focused)?.focus({preventScroll:true});paintStatus();
  }
  function cancel(){clearTimeout(timer);timer=null;controller?.abort();controller=null;}
  function schedule(){clearTimeout(timer);if(allowed()&&automatic())timer=setTimeout(()=>void load(),60000);}
  async function load(full=false){
    if(!allowed()||controller)return;clearTimeout(timer);const fast=!full&&!catalog,abort=new AbortController();controller=abort;error='';notice='';paintStatus();
    try{const response=await fetch('/api/markets/hyper-catalog',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public',...(fast&&{scope:'core-perps'})}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error();const value=checkedHyperliquidCatalog(await response.json());if(controller!==abort||!allowed())return;if(fast&&!value.rows.every(row=>row.kind==='perp'))throw Error('Core market scope changed');catalog=value;partial=fast;try{localStorage.setItem(fast?coreKey:savedKey,JSON.stringify(catalog));notice='Saved on this device.';}catch{notice='Could not save on this device.';}paint();}
    catch{if(controller===abort&&!abort.signal.aborted){error=catalog?'Refresh unavailable; showing saved data.':'Overview unavailable. Try refreshing.';paint();}}
    finally{if(controller===abort){controller=null;paintStatus();if(fast&&!abort.signal.aborted&&allowed())void load(true);else schedule();}}
  }
  function wake(){cancel();if(allowed())void load();paintStatus();}
  document.addEventListener('visibilitychange',()=>{if(!allowed())cancel();else if(automatic())void load();paintStatus();});
  addEventListener('online',wake);addEventListener('offline',wake);addEventListener('pagehide',cancel);
  addEventListener('market-live-change',()=>{const next=automatic();if(next===wasAutomatic)return;wasAutomatic=next;cancel();if(allowed()&&next)void load();paintStatus();});
  for(const key of [savedKey,coreKey])try{const raw=localStorage.getItem(key);if(raw&&raw.length<=8*1024*1024){const value=checkedHyperliquidCatalog(JSON.parse(raw));if(key===coreKey&&!value.rows.every(row=>row.kind==='perp'))throw Error('Core market scope changed');catalog=value;partial=key===coreKey;break;}}catch{}
  paint();
  return {show(value){context.show(value);target.hidden=!value;hero.showTools(value);if(visible===value)return;visible=value;if(!value)cancel();else{paint();void loadAssetPrices();if(partial||!catalog||Date.now()-catalog.observedAt>=60000)void load();else schedule();}paintStatus();},update(){if(visible)paint();}};
}
