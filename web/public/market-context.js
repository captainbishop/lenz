const key='lenz-market-context-v1';
const checked=value=>{if(value?.version!==1||value.provider!=='coinmarketcap'||!Number.isSafeInteger(value.observedAt)||value.observedAt<=0||value.observedAt>Date.now()+5000||!['marketCap','volume24h','btcDominance'].every(k=>value[k]===null||typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>=0)||value.btcDominance>100)throw Error('Invalid market context');return value;};
export function mountMarketContext(target,{changed=()=>{}}={}){
 let value=null,visible=false,controller=null,timer=null,failed=false,saveError='';
 const section=document.createElement('section');section.className='market-context';section.setAttribute('aria-label','Global market snapshot');target.append(section);
 function paint(){
  section.replaceChildren();const head=document.createElement('div');head.className='market-context-heading';const title=document.createElement('h3');title.textContent='Market pulse';const source=document.createElement('a');source.textContent='CoinMarketCap ↗';source.href='https://coinmarketcap.com';source.target='_blank';source.rel='noopener noreferrer';head.append(title,source);section.append(head);
  const grid=document.createElement('dl');for(const [label,k,unit]of [['Market cap','marketCap','$'],['24h volume','volume24h','$'],['BTC dominance','btcDominance','%']]){const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;const n=value?.[k];dd.textContent=n===null||n===undefined?'—':unit==='$'?'$'+n.toLocaleString(undefined,{notation:'compact',maximumFractionDigits:2}):n.toLocaleString(undefined,{maximumFractionDigits:1})+'%';cell.append(dt,dd);grid.append(cell);}section.append(grid);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent=(value?`${!navigator.onLine||failed||Date.now()-value.observedAt>120000?'Saved snapshot · ':''}Read ${new Date(value.observedAt).toLocaleString()}`:controller?'Loading market snapshot…':'Market snapshot unavailable')+(saveError?' · '+saveError:'');section.append(status);changed();
 }
 const allowed=()=>visible&&navigator.onLine&&!document.hidden;
 async function load(){if(!allowed()||controller)return;const c=new AbortController();controller=c;paint();try{const r=await fetch('/api/markets/context',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({privacy:'public'}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(18000)])});if(!r.ok)throw Error();const v=checked(await r.json());if(controller!==c||!allowed())return;value=v;failed=v.stale===true;save();}catch{if(controller===c)failed=true;}finally{if(controller===c){controller=null;paint();if(allowed()&&document.querySelector('#market-live')?.checked)timer=setTimeout(load,60000);}}}
 function save(){try{if(value)localStorage.setItem(key,JSON.stringify(value));saveError='';}catch{saveError='Market data could not be saved on this device.';}}
 function cancel(){clearTimeout(timer);controller?.abort();controller=null;}
 function wake(){cancel();paint();if(allowed())void load();}
 addEventListener('offline',wake);addEventListener('online',wake);addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',wake);addEventListener('market-live-change',()=>{cancel();if(allowed()&&document.querySelector('#market-live')?.checked)void load();});
 try{const raw=localStorage.getItem(key);if(raw&&raw.length<10000)value=checked(JSON.parse(raw));}catch{}
 paint();return {show(v){if(v===visible)return;visible=v;if(v){paint();void load();}else cancel();},hasSnapshot(){return Boolean(value);},refresh(){clearTimeout(timer);return load();},forget(){cancel();localStorage.removeItem(key);value=null;saveError='';paint();}};
}
