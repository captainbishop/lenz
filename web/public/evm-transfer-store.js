import {check,validateReview,hash,uint} from './evm-transfer.js';
const DB='lenz-evm-transfers-v1',AAD=new TextEncoder().encode(DB),enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export const transferOpen=row=>!['confirmed','failed','declined','not_sent'].includes(row.state);
export function validateTransferRow(row){
 check(row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).sort().join(',')===['id','review','state','hash','createdAt','updatedAt','observation','error'].sort().join(','),'Invalid saved transfer.');
 check(typeof row.id==='string'&&/^[0-9a-f-]{36}$/.test(row.id)&&['awaiting_wallet','unknown','submitted','pending','included','confirmed','failed','declined','not_sent'].includes(row.state),'Invalid transfer state.');
 validateReview(row.review);check(row.hash===null||hash(row.hash),'Invalid saved transaction hash.');
 check(!['submitted','pending','included','confirmed','failed'].includes(row.state)||row.hash,'Missing transaction hash.');
 check(Number.isSafeInteger(row.createdAt)&&Number.isSafeInteger(row.updatedAt)&&row.updatedAt>=row.createdAt&&row.createdAt>=row.review.createdAt,'Invalid transfer time.');
 check(typeof row.error==='string'&&row.error.length<=240,'Invalid transfer message.');
 if(row.observation!==null){const o=row.observation;check(o&&['pending','included','confirmed','failed'].includes(o.state)&&Number.isSafeInteger(o.checkedAt),'Invalid transfer observation.');check(Object.keys(o).every(key=>['state','checkedAt','blockNumber','blockHash','executionFee'].includes(key)),'Unexpected observation data.');if(o.state!=='pending')check(uint(o.blockNumber)&&hash(o.blockHash)&&uint(o.executionFee),'Invalid receipt observation.');}
 return structuredClone(row);
}
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function record(value,write=false){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state',write?'readwrite':'readonly'),store=tx.objectStore('state'),r=write?store.put(value,'transfers'):store.get('transfers');tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Transfer storage aborted.'));});}finally{db.close();}}
async function decode(saved){if(!saved)return [];check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=2000000,'Invalid encrypted transfer storage.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:AAD},saved.key,saved.box);const rows=JSON.parse(dec.decode(plain));check(Array.isArray(rows)&&rows.length<=200,'Transfer history is full.');const checked=rows.map(validateTransferRow);check(new Set(checked.map(r=>r.id)).size===checked.length,'Duplicate transfer ID.');return checked;}
const channel=typeof window!=='undefined'&&typeof BroadcastChannel==='function'?new BroadcastChannel(DB):null;
export async function readTransfers(){return decode(await record());}
export async function updateTransfers(operation){
 check(navigator.locks,'This browser needs Web Locks to save transfers safely.');
 return navigator.locks.request(DB,async()=>{
  const saved=await record(),rows=await decode(saved),result=await operation(rows);check(rows.length<=200,'Transfer history is full.');rows.forEach(validateTransferRow);
  const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
  const box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},key,enc.encode(JSON.stringify(rows)));
  await record({key,iv,box},true);channel?.postMessage('changed');dispatchEvent(new Event('lenz-transfers-changed'));return result;
 });
}
channel?.addEventListener('message',()=>dispatchEvent(new Event('lenz-transfers-changed')));
