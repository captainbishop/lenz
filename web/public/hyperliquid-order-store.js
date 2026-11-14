import {checkedOrderReview,checkedOrderAction,orderAmount,requireOrder as check} from './hyperliquid-order.js';
import {HYPERLIQUID} from './hyperliquid-environment.js';
import {checkedHyperFundingRequest} from './hyperliquid-funding-policy.js';
import {checkedHyperliquidSetupAction,verifyHyperliquidSetupSignature} from './hyperliquid-account-setup.js';
import {checkedHyperliquidHoldings} from './hyperliquid-holdings-model.js';
const DB=HYPERLIQUID.ordersKey,enc=new TextEncoder(),aad=enc.encode(DB);
const phases=['awaiting_wallet','submitting','unknown','open','filled','cancelled','rejected','not_sent'];
export const resolvedOrder=row=>['filled','cancelled','rejected','not_sent'].includes(row.state);
function validate(row){
  checkedOrderReview(row.review);check(row.id===row.review.action.orders[0].c&&phases.includes(row.state)&&Number.isSafeInteger(row.updatedAt),'Invalid saved order activity.');return row;
}
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function record(value,write=false,name='orders'){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state'),r=write?store.put(value,name):store.get(name);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Order storage interrupted.'));});}finally{db.close();}}
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
export async function readLegacyHyperOrders(){
  const legacy='lenz-hyperliquid-orders-v1';
  if(!indexedDB.databases||!(await indexedDB.databases()).some(db=>db.name===legacy))return [];
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(legacy);request.onupgradeneeded=()=>request.transaction.abort();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  let saved;
  try{saved=await new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get('orders');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  if(!saved)return [];
  check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=2000000,'Earlier order records could not be read.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:enc.encode(legacy)},saved.key,saved.box),data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),rows=Array.isArray(data)?data:data?.orders;
  check(Array.isArray(rows)&&rows.length<=200,'Earlier order records could not be read.');
  return rows.map(row=>{
    const review=row.review,action=checkedOrderAction(review?.action);
    check(review?.version===1&&/^0x[0-9a-f]{40}$/.test(review.account)&&row.id===action.orders?.[0]?.c&&phases.includes(row.state)&&['spot','perp'].includes(review.market?.kind),'Earlier order records could not be read.');
    orderAmount(review.size);orderAmount(review.price);
    check(typeof review.market.coin==='string'&&review.market.coin.length<=80&&['buy','sell'].includes(review.side),'Earlier order records could not be read.');
    return {id:row.id,environment:'mainnet',chainId:'hypercore:mainnet',readOnly:true,account:review.account,coin:review.market.coin,side:review.side,size:review.size,price:review.price,state:row.state};
  });
}
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

const fundingAad=enc.encode(DB+'/funding');
function checkedFundingRows(rows){
 check(Array.isArray(rows)&&rows.length<=32,'Saved funding requests are full.');const accounts=new Set();
 for(const row of rows){const r=row.request;check(Object.keys(row).sort().join(',')==='createdAt,request,state'&&checkedHyperFundingRequest(r)&&!accounts.has(r.account)&&['pending','confirmed','rejected','unavailable'].includes(row.state)&&Number.isSafeInteger(row.createdAt)&&row.createdAt>0,'Saved funding request cannot be read.');accounts.add(r.account);}return rows;
}
async function fundingRows(saved){
 if(!saved)return [];check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=64000,'Saved funding request cannot be read.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:fundingAad},saved.key,saved.box);return checkedFundingRows(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
}
export async function readHyperFunding(){return fundingRows(await record(undefined,false,'funding'));}
export async function updateHyperFunding(operation){
 check(navigator.locks,'This browser cannot safely retain funding requests.');return navigator.locks.request(DB+'/funding',async()=>{
  const saved=await record(undefined,false,'funding'),rows=await fundingRows(saved),result=await operation(rows);checkedFundingRows(rows);
  const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:fundingAad},key,enc.encode(JSON.stringify(rows)));check(box.byteLength<=64000,'Saved funding requests are full.');await record({key,iv,box},true,'funding');return result;
 });
}
const holdingsAad=enc.encode(DB+'/holdings');
const setupAad=enc.encode(DB+'/account-setup');
function checkedSetupRows(rows){
 check(Array.isArray(rows)&&rows.length<=32&&new Set(rows.map(row=>row.action?.user)).size===rows.length,'Saved testnet setup conflicts.');
 for(const row of rows){checkedHyperliquidSetupAction(row.action);check(Object.keys(row).sort().join(',')==='action,signature,state'&&['awaiting_wallet','signed','submitting','unknown','confirmed','not_sent'].includes(row.state)&&((['awaiting_wallet','not_sent'].includes(row.state)&&row.signature===null)||(typeof row.signature==='string'&&verifyHyperliquidSetupSignature(row.action,row.signature))),'Saved testnet setup cannot be read.');}return rows;
}
async function setupRows(saved){
 if(!saved)return [];check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=64000,'Saved testnet setup cannot be read.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:setupAad},saved.key,saved.box);return checkedSetupRows(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
}
export async function readHyperSetups(){return setupRows(await record(undefined,false,'account-setup'));}
export async function updateHyperSetups(operation){
 check(navigator.locks,'This browser cannot safely retain account setup.');return navigator.locks.request(DB+'/account-setup',async()=>{
  const saved=await record(undefined,false,'account-setup'),rows=await setupRows(saved),result=await operation(rows);checkedSetupRows(rows);
  const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:setupAad},key,enc.encode(JSON.stringify(rows)));check(box.byteLength<=64000,'Saved testnet setup is full.');await record({key,iv,box},true,'account-setup');return result;
 });
}
async function holdingsRows(saved){
 if(!saved)return [];check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=2000000,'Saved Hyperliquid holdings could not be read.');const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:holdingsAad},saved.key,saved.box),rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));check(Array.isArray(rows)&&rows.length<=32&&new Set(rows.map(row=>row.account)).size===rows.length,'Saved Hyperliquid holdings conflict.');return rows.map(checkedHyperliquidHoldings);
}
export async function readHyperHoldings(){return holdingsRows(await record(undefined,false,'holdings'));}
export async function saveHyperHoldings(snapshot,{assertCurrent=()=>{}}={}){
 const value=checkedHyperliquidHoldings(snapshot);check(navigator.locks,'This browser cannot safely save account holdings.');return navigator.locks.request(DB+'/holdings',async()=>{
  assertCurrent();const saved=await record(undefined,false,'holdings'),rows=await holdingsRows(saved),previous=rows.find(row=>row.account===value.account);if(previous&&previous.observedAt>value.observedAt)return previous;if(previous)rows.splice(rows.indexOf(previous),1);rows.push(value);check(rows.length<=32,'Saved Hyperliquid accounts are full.');
  const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:holdingsAad},key,enc.encode(JSON.stringify(rows)));check(box.byteLength<=2000000,'Saved Hyperliquid holdings are full.');assertCurrent();await record({key,iv,box},true,'holdings');dispatchEvent(new Event('lenz-hyperliquid-holdings'));return structuredClone(value);
 });
}
