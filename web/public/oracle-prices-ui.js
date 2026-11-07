import {ORACLE_NETWORKS,ORACLE_FEEDS,oracleSnapshot,oracleDecimal,oracleState} from './oracle-feeds.js';
import {liveRead} from './market-live.js';
import {workspaceHeading} from './workspace-heading.js';
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const elapsed=time=>{const seconds=Math.max(0,Math.floor((Date.now()-time)/1000));return seconds<60?'just now':seconds<3600?Math.floor(seconds/60)+'m ago':Math.floor(seconds/3600)+'h ago';};
export function mountOraclePrices(target){
  const storage='lenz-oracle-prices-v1',snapshots=new Map(),saved=new Set(),failed=new Set(),states=new Map(),cells=new Map(),headers=new Map(),controllers=new Map();let active=false,query='';
  try{const raw=localStorage.getItem(storage);if(raw){if(raw.length>64000)throw Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>4)throw Error();for(const value of values){const snapshot=oracleSnapshot(value,{cached:true});if(snapshots.has(snapshot.network))throw Error();snapshots.set(snapshot.network,snapshot);saved.add(snapshot.network);}}}catch{snapshots.clear();saved.clear();}
  const hero=workspaceHeading({title:'Prices',description:'Chainlink · USD reference prices',kind:'prices'});target.append(hero.element);
  const table=el('div',undefined,'oracle-table');table.setAttribute('role','table');table.setAttribute('aria-label','Chainlink reference prices by network');
  const labels=el('div',undefined,'oracle-labels');labels.setAttribute('role','row');const assetLabel=el('div','Asset');assetLabel.setAttribute('role','columnheader');labels.append(assetLabel);
  for(const [key,n]of Object.entries(ORACLE_NETWORKS)){const label=el('div'),title=el('strong',n.name),status=el('small','');label.setAttribute('role','columnheader');label.append(title,status);headers.set(key,status);labels.append(label);}table.append(labels);
  const assets=['BTC','ETH','LINK','USDC','NEAR','HYPE'];
  for(const asset of assets){const row=el('div',undefined,'oracle-row');row.dataset.asset=asset;row.setAttribute('role','row');const name=el('strong',asset,'oracle-asset');name.setAttribute('role','rowheader');row.append(name);
    for(const [network,n]of Object.entries(ORACLE_NETWORKS)){const cell=el('div',undefined,'oracle-price');cell.setAttribute('role','cell');cell.dataset.network=network;const name=el('span',n.name,'oracle-mobile-network'),value=el('span','—','oracle-value'),time=el('small','');const feed=ORACLE_FEEDS.find(f=>f.network===network&&f.asset===asset);cell.append(name,value,time);if(feed){cell.dataset.feed=feed.id;cells.set(feed.id,{value,time,cell});}else{cell.setAttribute('aria-label',asset+' on '+n.name+': not connected');time.textContent='Not connected';}row.append(cell);}table.append(row);
  }target.append(table);
  const note=el('p','Swap amounts depend on liquidity and fees.','oracle-note');target.append(note);
  const sources=el('details',undefined,'oracle-sources');sources.append(el('summary','Sources'));for(const [key,n]of Object.entries(ORACLE_NETWORKS)){const group=el('div');group.append(el('strong',n.name));for(const f of ORACLE_FEEDS.filter(f=>f.network===key)){const a=el('a',f.asset+' / USD ↗');a.href=n.explorer+f.address;a.target='_blank';a.rel='noopener noreferrer';group.append(a);}sources.append(group);}target.append(sources);
  function render(){
    for(const [network,n]of Object.entries(ORACLE_NETWORKS)){
      const snapshot=snapshots.get(network),isSaved=saved.has(network)||failed.has(network);
      headers.get(network).textContent=!navigator.onLine?'Offline':failed.has(network)?'Retrying':states.get(network)==='updating'&&!snapshot?'Reading…':!active||!document.querySelector('#market-live').checked?'Paused':snapshot?'':'Waiting';
      for(const f of ORACLE_FEEDS.filter(f=>f.network===network)){
        const row=snapshot?.feeds.find(r=>r.id===f.id),c=cells.get(f.id),state=oracleState(snapshot,row,{online:navigator.onLine,saved:isSaved});
        c.value.textContent=row?.status==='current'?'$'+Number(oracleDecimal(row)).toLocaleString('en-US',{maximumFractionDigits:f.asset==='USDC'?6:4}):'—';c.value.title=row?.status==='current'?oracleDecimal(row):'';
        c.time.textContent=row?.status==='current'?state+' '+elapsed(row.updatedAt):snapshot?'Unavailable':!navigator.onLine?'No saved price':!active||!document.querySelector('#market-live').checked?'Paused':failed.has(network)?'Unavailable':'Reading…';c.time.title=row?.status==='current'?new Date(row.updatedAt).toLocaleString():'';
        c.cell.dataset.state=state;c.cell.setAttribute('aria-label',f.asset+' on '+n.name+': '+c.value.textContent+', '+c.time.textContent);
      }
    }
    for(const row of table.querySelectorAll('.oracle-row'))row.hidden=query&&!row.dataset.asset.toLowerCase().includes(query)&&!Object.values(ORACLE_NETWORKS).some(n=>n.name.toLowerCase()===query);
  }
  for(const [network,n]of Object.entries(ORACLE_NETWORKS)){
    const controller=liveRead({period:n.period,allowed:()=>active&&navigator.onLine&&!document.hidden,read:async signal=>{
      const response=await fetch('/api/markets/oracles',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({network}),signal:AbortSignal.any([signal,AbortSignal.timeout(50000)])});if(!response.ok)throw Error('Price read failed');const raw=await response.text();if(raw.length>16000)throw Error('Price data too large');const next=oracleSnapshot(JSON.parse(raw)),previous=snapshots.get(network);
      if(next.network!==network||previous&&(next.observedAt<previous.observedAt||BigInt(next.blockNumber)<BigInt(previous.blockNumber)))throw Error('Wrong or older oracle response');
      if(previous)for(const row of next.feeds){const old=previous.feeds.find(f=>f.id===row.id);if(row.status==='current'&&old?.status==='current'&&(BigInt(row.roundId)<BigInt(old.roundId)||row.updatedAt<old.updatedAt))throw Error('Older oracle round');}return next;
    },accept:snapshot=>{snapshots.set(network,snapshot);saved.delete(network);failed.delete(network);try{localStorage.setItem(storage,JSON.stringify([...snapshots.values()]));}catch{}render();},status:status=>{states.set(network,status);if(status==='retrying')failed.add(network);render();}});controllers.set(network,controller);
  }
  const sync=()=>{for(const c of controllers.values())c.setEnabled(active&&document.querySelector('#market-live').checked);render();},wake=()=>{for(const c of controllers.values())c.wake();render();};
  addEventListener('market-live-change',sync);addEventListener('online',wake);addEventListener('offline',wake);document.addEventListener('visibilitychange',wake);addEventListener('pagehide',()=>{for(const c of controllers.values())c.stop();});
  setInterval(()=>{if(active&&!document.hidden)render();},1000);render();
  return {show(value){if(active===value)return;active=value;target.hidden=!value;sync();},filter(value){query=value.trim().toLowerCase();render();},clear(){localStorage.removeItem(storage);snapshots.clear();saved.clear();failed.clear();render();}};
}
