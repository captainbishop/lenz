import {checkedPoolPrice,poolReceive} from './pool-price.js';
import {liveRead} from './market-live.js';
export function mountPoolPrice(form,row,amount,side,output,snapshot){
  const key='lenz-pool-price-v1',note=document.createElement('small');note.className='pool-price-status';note.setAttribute('role','status');output.parentElement.append(note);let price=null,failed=false;
  try{const raw=localStorage.getItem(key);if(raw&&raw.length<3000)price=checkedPoolPrice(JSON.parse(raw),{cached:true});}catch{}
  if(!price&&snapshot)try{price=checkedPoolPrice({kind:'pool-price',marketId:row.id,source:snapshot.evidence.source,sqrtPriceX96:row.sqrtPriceX96,sourceTime:snapshot.evidence.blockTimestamp,observedAt:snapshot.evidence.blockTimestamp,blockNumber:snapshot.evidence.blockNumber,blockHash:snapshot.evidence.blockHash,executable:false},{cached:true});}catch{}
  function render(){
    let received;try{if(price&&amount.value)received=poolReceive(price,amount.value,side.value);}catch{}
    output.textContent=received===undefined?'—':'≈ '+Number(received).toLocaleString('en-US',{maximumSignificantDigits:6,useGrouping:false});output.title=received??'';
    if(!price){note.textContent=navigator.onLine?'Reading price…':'No saved price';return;}
    const stale=Date.now()-price.sourceTime>=60000,age=new Date(price.sourceTime).toLocaleTimeString();
    note.textContent=(!navigator.onLine?'Offline · Saved':failed||stale?'Stale':document.hidden||document.querySelector('#market-live')?.checked!==true?'Paused':'Pool price')+' '+age+' · Large swaps may receive less';
  }
  const feed=liveRead({period:2000,read:async signal=>{
    const response=await fetch('/api/markets/price',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({marketId:row.id}),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Price unavailable');const text=await response.text();if(text.length>3000)throw Error('Price too large');const next=checkedPoolPrice(JSON.parse(text));if(price&&BigInt(next.blockNumber)<BigInt(price.blockNumber))throw Error('Older block');return next;
  },accept:next=>{price=next;failed=false;try{localStorage.setItem(key,JSON.stringify(price));}catch{}render();},status:state=>{if(state==='retrying')failed=true;render();}});
  const changed=()=>render(),sync=()=>feed.setEnabled(document.querySelector('#market-live')?.checked===true),wake=()=>{feed.wake();render();};
  amount.addEventListener('input',changed);side.addEventListener('change',changed);addEventListener('market-live-change',sync);addEventListener('online',wake);addEventListener('offline',wake);document.addEventListener('visibilitychange',wake);const timer=setInterval(render,1000);sync();render();
  return {render,dispose(){feed.stop();clearInterval(timer);amount.removeEventListener('input',changed);side.removeEventListener('change',changed);removeEventListener('market-live-change',sync);removeEventListener('online',wake);removeEventListener('offline',wake);document.removeEventListener('visibilitychange',wake);}};
}
