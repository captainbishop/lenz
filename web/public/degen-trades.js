import {checkedTrades} from './degen-model.js';
import {priceText} from './degen-chart.js';
import {degenPost} from './degen-http.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountDegenTrades(target,row,{allowed=()=>true}={}){
  const section=el('section',undefined,'degen-trades'),head=el('div',undefined,'degen-trades-head'),state=el('span','Loading trades…'),table=el('table'),thead=el('thead'),tr=el('tr'),body=el('tbody');
  section.setAttribute('aria-label','Recent buys and sells');head.append(el('h3','Trades'),state);for(const label of ['Time','Type','USD','Amount','Price','Size']){const th=el('th',label);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead,body);const scroll=el('div',undefined,'degen-trades-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Trade history');scroll.append(table);section.append(head,scroll);target.append(section);
  if(!row.chain.gecko){state.textContent='Unavailable for this chain';return {stop(){},resume(){},refresh(){}};}
  const request={provider:'geckoterminal',kind:'trades',network:row.chain.gecko,pool:row.pool,address:row.address},key=JSON.stringify(request),storage='lenz-degen-tapes-v1';
  let active=true,timer=null,controller=null,generation=0,previous=null;const saved=new Map();
  try{const raw=localStorage.getItem(storage);if(raw){if(raw.length>1200000)throw Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>8)throw Error();for(const value of values){const data=checkedTrades(value,value.request,{saved:true});saved.set(JSON.stringify(data.request),data);}previous=saved.get(key);}}catch{state.textContent='Saved trades unavailable';}
  function render(data,label){state.textContent=label;body.replaceChildren(...data.trades.slice(0,60).map(t=>{const n=el('tr');n.dataset.trade=t.id;n.dataset.side=t.side;n.title='Transaction '+t.hash;const size=el('td'),icon=el('span',t.usd>=10000?'🐋':t.usd>=1000?'🐟':'🦐','trade-size'),description=t.usd>=10000?'Whale · Trade of $10,000 or more':t.usd>=1000?'Fish · Trade of $1,000 to $9,999.99':'Shrimp · Trade below $1,000';icon.tabIndex=0;icon.setAttribute('role','img');icon.setAttribute('aria-label',description);icon.title=description;size.append(icon);n.append(el('td',new Date(t.time).toLocaleTimeString(undefined,{hour12:false})),el('td',t.side==='buy'?'Buy':'Sell'),el('td',new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(t.usd)),el('td',priceText(t.amount)),el('td','$'+priceText(t.price)),size);return n;}));if(!data.trades.length){const n=el('tr'),cell=el('td','No recent trades reported');cell.colSpan=6;n.append(cell);body.append(n);}}
  if(previous)render(previous,'Saved · '+new Date(previous.observedAt).toLocaleString());
  async function load(manual=false){
    clearTimeout(timer);timer=null;
    if(!active||document.hidden||!navigator.onLine||(!allowed()&&!manual)){state.textContent=!navigator.onLine?'Offline · Saved trades':'Updates paused';return;}
    const ticket=++generation;controller?.abort();controller=new AbortController();
    try{
      const raw=await degenPost(request,controller.signal),stale=raw.stale===true;let data=checkedTrades(raw,request,{saved:stale});if(!active||ticket!==generation||document.hidden||!navigator.onLine||(!allowed()&&!manual))return;
      if(previous&&previous.observedAt>data.observedAt)data=previous;
      previous=data;
      if(stale){const delay=Number.isFinite(raw.retryAfterMs)?Math.max(1000,Math.min(300000,raw.retryAfterMs)):60000;render(data,`Saved ${new Date(data.observedAt).toLocaleString()} · Retrying in ${Math.ceil(delay/1000)}s`);timer=setTimeout(()=>load(manual),delay);}
      else render(data,`${Date.now()-data.observedAt>30000?'Delayed · ':''}Updated ${new Date(data.observedAt).toLocaleTimeString()}`);
      saved.delete(key);saved.set(key,data);while(saved.size>8)saved.delete(saved.keys().next().value);try{localStorage.setItem(storage,JSON.stringify([...saved.values()]));}catch{state.textContent+=' · Not saved';}
    }catch(error){if(active&&ticket===generation){state.textContent=error.message+(previous?' · Earlier trades':'');if(error.retryAfterMs)timer=setTimeout(()=>load(manual),error.retryAfterMs);}}
    finally{if(active&&ticket===generation&&!timer&&allowed())timer=setTimeout(load,15000);}
  }
  timer=setTimeout(load,750);return {refresh:()=>load(true),resume(){if(!active){active=true;timer=setTimeout(load,750);}},stop(){active=false;generation++;clearTimeout(timer);controller?.abort();state.textContent=(!navigator.onLine?'Offline':'Updates paused')+(previous?' · '+new Date(previous.observedAt).toLocaleTimeString():'');}};
}
