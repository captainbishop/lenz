import {HYPERLIQUID} from './hyperliquid-environment.js';
import {assetPriceCard} from './asset-price-card.js';
import {checkedHyperLending} from './lending-markets.js';
import {workspaceHeading} from './workspace-heading.js';
import {creditSurface} from './defi-surfaces.js';
import {CHAINS} from './defi-catalog.js';
import {mountLendingIntentMarkets} from './intent-lending-markets.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const rate=v=>v==null?'—':v.toLocaleString(undefined,{maximumFractionDigits:2})+'%';
const amount=v=>v==null?'—':Number(v).toLocaleString(undefined,{notation:'compact',maximumFractionDigits:2});
const savedKey=HYPERLIQUID.lendingKey;
export function mountLendingMarkets(target,{snapshots,refreshSources,initialAction='supply',intentOptions={}}){
 let visible=false,hyper=null,failed=false,controller=null,timer=null,selected=null,provider='',mode=initialAction==='borrow'?'borrow':'supply',query='',saveStatus='';
 try{const raw=localStorage.getItem(savedKey);if(raw&&raw.length<=64000)hyper=checkedHyperLending(JSON.parse(raw));}catch{}
 const hero=workspaceHeading({title:'Lend & Borrow',description:'Compare rates, liquidity and collateral across Aave and Hyperliquid.',kind:'credit'});
 const refresh=el('button','↻');refresh.type='button';refresh.setAttribute('aria-label','Refresh lending markets');hero.actions.append(refresh);
 const controls=el('div',undefined,'lending-controls'),tabs=el('nav');tabs.setAttribute('aria-label','Compare lending rates');
 for(const [key,label]of [['supply','Supply'],['borrow','Borrow']]){const b=el('button',label);b.type='button';b.dataset.mode=key;b.onclick=()=>{if(mode!==key){mode=key;detail.dataset.marketId='';}paint();};tabs.append(b);}
 const search=el('input');search.type='search';search.placeholder='Search assets';search.setAttribute('aria-label','Search lending markets');search.oninput=()=>{query=search.value.trim().toLowerCase();paint();};
 const sources=el('select');sources.setAttribute('aria-label','Lending source');for(const [key,label]of [['','All sources'],['aave','Aave V3'],['hyperliquid','Hyperliquid']])sources.append(new Option(label,key));sources.onchange=()=>{provider=sources.value;paint();};controls.append(tabs,search,sources);
 const status=el('p',undefined,'lending-status');status.setAttribute('role','status');
 const layout=el('div',undefined,'lending-layout'),list=el('div',undefined,'lending-directory'),detail=el('section',undefined,'lending-detail');detail.setAttribute('aria-label','Selected lending market');layout.append(list,detail);target.append(hero.element);const owned=mountLendingIntentMarkets(target,{...intentOptions,initialAction:mode});target.append(controls,status,layout);target.className='lending-workspace';
 function rows(){
  const aave=[...snapshots()].filter(s=>s.provider==='aave').flatMap(s=>s.rows.map(r=>({...r,source:'aave',symbol:r.assets[0].symbol,network:CHAINS[r.chainId].name,at:s.observedAt,sourceAt:s.evidence.blockTimestamp??s.observedAt})));
  return [...aave,...(hyper?.rows??[]).map(r=>({...r,source:'hyperliquid',network:'HyperCore',at:hyper.observedAt,sourceAt:hyper.observedAt}))].filter(r=>(!provider||r.source===provider)&&(!query||(r.symbol+' '+r.network).toLowerCase().includes(query)));
 }
 function card(row){
  const asset=row.assets?.[0],key=row.source==='aave'?null:({USDC:'USDC',HYPE:'HYPE',UBTC:'BTC',USDT0:'USDT'})[row.symbol];
  return assetPriceCard({historyKey:row.id,observedAt:row.at,name:row.symbol,symbol:row.symbol,subtitle:(row.source==='aave'?'Aave V3':'Hyperliquid')+' · '+row.network,network:row.chainId,contract:asset?.id,referenceKey:key,referencePrice:row.source==='aave',price:row.price,quote:'USD',trusted:row.source==='hyperliquid'}).element;
 }
 function paint(){
  const focus=document.activeElement?.dataset.lendingId,items=rows();for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
  if(!items.some(r=>r.id===selected))selected=items[0]?.id??null;
  list.replaceChildren();const head=el('div',undefined,'lending-columns');head.append(el('span','Asset / market'),el('span',mode==='supply'?'Supply rate':'Borrow rate'),el('span','Pool funds available'));list.append(head);
  for(const row of items){const b=el('button',undefined,'lending-market');b.type='button';b.dataset.lendingId=row.id;b.setAttribute('aria-pressed',String(row.id===selected));
   const yieldValue=el('span',undefined,'lending-rate'),apy=row.source==='aave',value=mode==='supply'?(apy?row.supplyAPY:row.supplyAPR):(apy?row.borrowAPY:row.borrowAPR);yieldValue.append(el('strong',rate(value)),el('small',apy?'APY':'APR'));
   const liquidity=el('span',undefined,'lending-liquidity');liquidity.append(el('strong',amount(row.availableLiquidity)),el('small',row.symbol));
   b.append(card(row),yieldValue,liquidity);b.onclick=()=>{selected=row.id;paint();if(matchMedia('(max-width:800px)').matches)detail.scrollIntoView({block:'start'});};list.append(b);
  }
  if(!items.length)list.append(el('p',query?'No matching lending markets.':!navigator.onLine?'No saved lending markets.':'Loading lending markets…','lending-empty'));
  const row=items.find(r=>r.id===selected),priorAction=detail.dataset.marketId===row?.id?detail.querySelector('.position-actions button[aria-pressed=true]')?.textContent:null,detailFocus=detail.contains(document.activeElement)?document.activeElement.textContent:null;detail.replaceChildren();detail.dataset.marketId=row?.id??'';if(row){
   detail.append(card(row));const metrics=el('dl',undefined,'lending-detail-metrics');for(const [label,value]of [['Supply '+(row.source==='aave'?'APY':'APR'),rate(row.supplyAPY??row.supplyAPR)],['Borrow '+(row.source==='aave'?'APY':'APR'),rate(row.borrowAPY??row.borrowAPR)],['Total supplied',amount(row.totalSupplied)+' '+row.symbol],['Total borrowed',amount(row.totalBorrowed)+' '+row.symbol]]){const cell=el('div');cell.append(el('dt',label),el('dd',value));metrics.append(cell);}detail.append(metrics);
   if(row.source==='aave'){detail.append(creditSurface(row));const action=priorAction??(mode==='borrow'?'Borrow':'Supply');[...detail.querySelectorAll('.position-actions button')].find(b=>b.textContent===action)?.click();if(detailFocus)[...detail.querySelectorAll('.position-actions button')].find(b=>b.textContent===detailFocus)?.focus({preventScroll:true});}
   else {detail.append(el('h3','Hyperliquid lending'),el('p',`Maximum loan / collateral · ${rate(row.ltvBps/100)}`),el('p',`Utilization · ${rate(row.utilization*100)}`),el('p','Rates and balances are reported by Hyperliquid. Manual borrowing and portfolio margin have different eligibility rules.','lending-note'),el('p','Lending and borrowing are not available in Lenz yet.','lending-note'));}
   const account=el('a','Open wallet account','lending-account-link');account.href='/money.html';detail.append(account);
   detail.append(el('small',!navigator.onLine?'Saved · Updated '+new Date(row.sourceAt).toLocaleString():Date.now()-row.at>120000||row.source==='hyperliquid'&&failed?'Saved data':'','lending-note'));
  }
  const message=!navigator.onLine?'Offline · '+(items.length?'Saved market data':'No saved market data'):failed?'Hyperliquid could not refresh. Earlier data is marked saved.':controller?'Updating lending markets…':'';
  status.textContent=[message,saveStatus].filter(Boolean).join(' · ');
  refresh.disabled=!!controller||!navigator.onLine;
  if(focus)list.querySelector(`[data-lending-id="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
 }
 async function load(){
  if(!visible||!navigator.onLine||document.hidden||controller)return;const c=new AbortController();controller=c;saveStatus='';paint();
  try{const r=await fetch('/api/markets/lending',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(25000)])});if(!r.ok)throw Error();const raw=await r.text();if(raw.length>64000)throw Error();const value=checkedHyperLending(JSON.parse(raw));if(controller===c&&!c.signal.aborted){hyper=value;failed=value.stale===true;try{localStorage.setItem(savedKey,JSON.stringify(value));saveStatus='Saved on this device.';}catch{saveStatus='Could not save lending markets on this device.';}}}
  catch{if(controller===c)failed=true;}finally{if(controller===c){controller=null;paint();if(visible&&document.querySelector('#market-live')?.checked)timer=setTimeout(load,60000);}}
 }
 const cancel=()=>{clearTimeout(timer);controller?.abort();controller=null;};
 refresh.onclick=()=>{refreshSources();void load();};
 for(const event of ['online','offline','market-live-change'])addEventListener(event,()=>{cancel();if(visible){paint();if(document.querySelector('#market-live')?.checked)void load();}});
 document.addEventListener('visibilitychange',()=>{cancel();if(visible&&!document.hidden){paint();void load();}});addEventListener('pagehide',cancel);
 return {show(value,id){target.hidden=!value;owned.show(value);hero.showTools(value);if(id)selected=id;if(value){paint();if(!visible){visible=true;void load();}}else{visible=false;cancel();}},update(){if(visible)paint();}};
}
