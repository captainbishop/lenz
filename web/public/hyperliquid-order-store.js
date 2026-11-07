import {checkedOrderReview,orderAmount,requireOrder as check} from './hyperliquid-order.js';
const DB='lenz-hyperliquid-orders-v1',enc=new TextEncoder(),aad=enc.encode(DB);
const phases=['awaiting_wallet','submitting','unknown','open','filled','cancelled','rejected','not_sent'];
export const resolvedOrder=row=>['filled','cancelled','rejected','not_sent'].includes(row.state);
function validate(row){
  checkedOrderReview(row.review);check(row.id===row.review.action.orders[0].c&&phases.includes(row.state)&&Number.isSafeInteger(row.updatedAt),'Invalid saved order activity.');return row;
}
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function record(value,write=false){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state'),r=write?store.put(value,'orders'):store.get('orders');tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Order storage interrupted.'));});}finally{db.close();}}
async function decode(saved){
  if(!saved)return {orders:[],nonces:{}};check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=2000000,'Invalid order storage.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:aad},saved.key,saved.box),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const data=Array.isArray(value)?{orders:value,nonces:{}}:value,rows=data?.orders;
  check(Array.isArray(rows)&&rows.length<=200,'Order history is full.');rows.forEach(validate);check(new Set(rows.map(r=>r.id)).size===rows.length,'Duplicate order activity.');
  check(data.nonces&&Object.getPrototypeOf(data.nonces)===Object.prototype&&Object.entries(data.nonces).every(([account,nonce])=>/^0x[0-9a-f]{40}$/.test(account)&&Number.isSafeInteger(nonce)&&nonce>0),'Invalid saved order nonces.');
  for(const row of rows)data.nonces[row.review.account]=Math.max(data.nonces[row.review.account]??0,row.review.nonce,row.cancelRequestedAt??0);
  return data;
}
export async function readHyperOrders(){return (await decode(await record())).orders;}
export async function updateHyperOrders(operation){
  check(navigator.locks,'This browser cannot safely save trading activity.');
  return navigator.locks.request(DB,async()=>{
    const saved=await record(),data=await decode(saved),rows=data.orders,result=await operation(rows,data.nonces);check(rows.length<=200,'Order history is full.');rows.forEach(validate);
    const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
    const box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,enc.encode(JSON.stringify(data)));await record({key,iv,box},true);
    dispatchEvent(new Event('lenz-hyper-orders'));return result;
  });
}
export async function reserveOrderAttempt(review){
  const r=checkedOrderReview(review);
  return updateHyperOrders((rows,nonces)=>{
    check(!rows.some(o=>o.review.account===r.account&&['awaiting_wallet','submitting','unknown'].includes(o.state)),'Check your unresolved order before placing another.');
    check(!rows.some(o=>o.id===r.action.orders[0].c),'This order is already saved. Check its status.');
    check(Date.now()<r.expiresAt&&r.nonce>(nonces[r.account]??0),'Review this order again.');nonces[r.account]=r.nonce;
    const row={id:r.action.orders[0].c,review:r,state:'awaiting_wallet',updatedAt:Date.now(),observation:null};rows.push(row);return structuredClone(row);
  });
}
export async function recordOrderState(id,state,observation=null){return updateHyperOrders(rows=>{
  const row=rows.find(o=>o.id===id);check(row,'Saved order is missing.');
  if(resolvedOrder(row)||row.observation&&!observation||observation&&row.observation&&(observation.statusTime<row.observation.statusTime||orderAmount(observation.remaining)>orderAmount(row.observation.remaining)))return structuredClone(row);
  row.state=state;row.updatedAt=Date.now();if(observation)row.observation=observation;return structuredClone(row);
});}
export async function recoverExpiredApproval(id){return updateHyperOrders(rows=>{
  const row=rows.find(o=>o.id===id);check(row,'Saved order is missing.');
  // Submission is journalled first, so this expired phase cannot have reached the exchange.
  if(row.state==='awaiting_wallet'&&Date.now()>=row.review.expiresAt){row.state='not_sent';row.updatedAt=Date.now();}
  return structuredClone(row);
});}
export async function clearResolvedOrders(account){return updateHyperOrders(rows=>{for(let i=rows.length-1;i>=0;i--)if(rows[i].review.account===account&&resolvedOrder(rows[i]))rows.splice(i,1);});}
