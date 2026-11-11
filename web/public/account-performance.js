import {readState} from './chat-store.js';
import {hyperInfo} from './hyperliquid-trading.js';
import {orderPosition} from './hyperliquid-order.js';

const scale=10n**8n,encoder=new TextEncoder(),MAX_FILLS=2000;
const check=(ok,text='Trading history could not be checked. Try again.')=>{if(!ok)throw Error(text);};
const owner=state=>state.identity?.profile.id??'guest';
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
function decimal(value,signed=false){check(typeof value==='string'&&/^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,8})?$/.test(value));const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');check(signed||!negative);return(BigInt(whole)*scale+BigInt(fraction.padEnd(8,'0')))*(negative?-1n:1n);}
function text(value){const negative=value<0n,n=negative?-value:value,fraction=(n%scale).toString().padStart(8,'0').replace(/0+$/,'');return(negative?'-':'')+(n/scale)+(fraction?'.'+fraction:'');}
const closing=new Set(['Close Long','Close Short','Long > Short','Short > Long']);
const directions=new Set(['Open Long','Open Short',...closing]);
const nativeMarket=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
export function accountPositions(rows){
 if(rows===null||rows===undefined)return null;
 check(Array.isArray(rows)&&rows.length<=1000&&rows.every(row=>typeof row?.position?.coin==='string'));
 check(new Set(rows.map(row=>row.position.coin)).size===rows.length);
 return rows.filter(row=>nativeMarket(row.position.coin)).map(row=>({coin:row.position.coin,...orderPosition({kind:'perp',coin:row.position.coin},{perp:{assetPositions:rows}})})).filter(row=>row.size);
}
export function accountOpenOrders(rows){
 if(rows===null||rows===undefined)return null;
 check(Array.isArray(rows)&&rows.length<=2000);const seen=new Set(),result=[];
 for(const row of rows){check(row&&typeof row.coin==='string');if(!nativeMarket(row.coin))continue;
  check(Number.isSafeInteger(row.oid)&&row.oid>=0&&!seen.has(row.oid)&&['A','B'].includes(row.side)&&Number.isSafeInteger(row.timestamp)&&row.timestamp>0);seen.add(row.oid);
  const size=decimal(row.sz),price=decimal(row.limitPx);check(size>0n&&price>0n);result.push({coin:row.coin,id:row.oid,side:row.side==='B'?'Buy':'Sell',size:text(size),price:text(price),time:row.timestamp});
 }
 return result;
}

// Default USDC perpetuals only. Spot cost basis and other collateral need their own accounting.
export function summarizePerformance(fills,{start,end}){
 check(Array.isArray(fills)&&fills.length<=MAX_FILLS&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<end);
 const seen=new Map(),rows=[];let excluded=0;
 for(const fill of fills){
  check(fill&&Number.isSafeInteger(fill.tid)&&fill.tid>=0&&Number.isSafeInteger(fill.time)&&fill.time>=start&&fill.time<=end);
  check(typeof fill.coin==='string'&&fill.coin.length>0&&fill.coin.length<=80);
  if(!directions.has(fill.dir)||fill.coin.includes(':')||fill.coin.startsWith('@')){excluded++;continue;}
  check(fill.feeToken==='USDC');
  const price=decimal(fill.px),size=decimal(fill.sz),pnl=decimal(fill.closedPnl,true),fee=decimal(fill.fee,true);check(price>0n&&size>0n);
  check(closing.has(fill.dir)||pnl===0n);
  const row={id:fill.tid,coin:fill.coin,time:fill.time,direction:fill.dir,price:text(price),size:text(size),pnl:text(pnl-fee),gross:text(pnl),fee:text(fee),volume:text(price*size/scale),closed:closing.has(fill.dir)};
  const key=fill.coin+':'+fill.tid,previous=seen.get(key);check(!previous||JSON.stringify(previous)===JSON.stringify(row));if(previous)continue;seen.set(key,row);rows.push(row);
 }
 rows.sort((a,b)=>a.time-b.time||a.id-b.id);
 let pnl=0n,volume=0n,fees=0n,wins=0,losses=0,flat=0;
 for(const row of rows){pnl+=decimal(row.pnl,true);volume+=decimal(row.volume);fees+=decimal(row.fee,true);row.cumulative=text(pnl);if(row.closed){const gross=decimal(row.gross,true);if(gross>0n)wins++;else if(gross<0n)losses++;else flat++;}}
 const closed=wins+losses+flat;
 return{pnl:text(pnl),volume:text(volume),fees:text(fees),wins,losses,flat,winRate:closed?wins/closed*100:null,lossRate:closed?losses/closed*100:null,history:rows,limited:fills.length===MAX_FILLS,excluded,start,end};
}
export async function loadPerformance(account,{signal,now=Date.now(),read=hyperInfo}={}){
 check(address(account),'Choose a wallet first.');check(navigator.onLine,'You are offline. Saved history is still available.');
 const start=now-30*86400000;
 const [fills,funds,openOrders]=await Promise.all([read({type:'userFillsByTime',user:account,startTime:start,endTime:now,aggregateByTime:false},{signal}),read({type:'clearinghouseState',user:account},{signal}),read({type:'openOrders',user:account},{signal})]);
 const performance=summarizePerformance(fills,{start,end:now});
 const equity=text(decimal(funds?.marginSummary?.accountValue,true)),withdrawable=text(decimal(funds?.withdrawable));
 const positions=funds.assetPositions??null;accountPositions(positions);accountOpenOrders(openOrders);
 return{account,observedAt:now,fills,start,end:now,equity,withdrawable,positions,openOrders,performance};
}
function checkedSnapshot(value){
 check(value&&address(value.account)&&Number.isSafeInteger(value.observedAt)&&value.observedAt===value.end&&value.end-value.start===30*86400000);
 decimal(value.equity,true);decimal(value.withdrawable);accountPositions(value.positions);accountOpenOrders(value.openOrders);return{...value,performance:summarizePerformance(value.fills,value)};
}
const additionalData=id=>encoder.encode('lenz-account-performance-v1:'+id);
const DB='lenz-account-performance-v1';
async function record(value){
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore('history');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('history',value?'readwrite':'readonly'),store=tx.objectStore('history'),request=value?store.put(value,'saved'):store.get('saved');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('History could not be saved.'));});}finally{db.close();}
}
export async function savedPerformance(state=undefined){
 state??=await readState();const saved=await record();if(!saved||saved.owner!==owner(state))return[];
 check(saved.box instanceof ArrayBuffer&&saved.box.byteLength<=4000000&&saved.iv instanceof Uint8Array&&saved.iv.length===12);
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:additionalData(saved.owner)},saved.key,saved.box),rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 check(Array.isArray(rows)&&rows.length<=8&&new Set(rows.map(r=>r.account)).size===rows.length);return rows.map(checkedSnapshot);
}
export async function savePerformance(snapshot,expectedOwner,current=()=>true){
 checkedSnapshot(snapshot);
 check(navigator.locks,'This browser cannot safely save history.');
 return navigator.locks.request(DB,async()=>{
  const state=await readState();
  check(owner(state)===expectedOwner&&current(),'Account changed. Load history again.');
  const rows=(await savedPerformance(state)).filter(row=>row.account!==snapshot.account);rows.push(snapshot);while(rows.length>8)rows.shift();
  const plain=encoder.encode(JSON.stringify(rows.map(({performance,...row})=>row)));check(plain.byteLength<=3999984,'History is too large to save on this device.');
  const previous=await record(),key=previous?.owner===expectedOwner?previous.key:await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  const box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:additionalData(expectedOwner)},key,plain);
  check(owner(await readState())===expectedOwner&&current(),'Account changed. Load history again.');await record({owner:expectedOwner,key,iv,box});
 });
}
