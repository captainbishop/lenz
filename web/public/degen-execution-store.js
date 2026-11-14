import {validateDegenReview} from './degen-execution.js';
import {check,hash,uint} from './evm-transfer.js';
const DB='lenz-degen-execution-v1',enc=new TextEncoder(),aad=enc.encode(DB);
export const degenUnresolved=row=>!['confirmed','failed','declined','not_sent'].includes(row.state);
export function validateDegenAttempt(row){
 check(row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).sort().join(',')===['id','review','state','hash','createdAt','updatedAt','observation','error'].sort().join(','),'Invalid saved swap attempt.');
 validateDegenReview(row.review);check(typeof row.id==='string'&&/^[0-9a-f-]{36}$/.test(row.id)&&['awaiting_wallet','unknown','submitted','pending','included','confirmed','failed','declined','not_sent'].includes(row.state),'Invalid swap state.');
 check(row.hash===null||hash(row.hash),'Invalid saved transaction hash.');check(!['submitted','pending','included','confirmed','failed'].includes(row.state)||row.hash,'Missing swap transaction hash.');
 check(Number.isSafeInteger(row.createdAt)&&row.createdAt>=row.review.createdAt&&Number.isSafeInteger(row.updatedAt)&&row.updatedAt>=row.createdAt,'Invalid swap time.');check(typeof row.error==='string'&&row.error.length<=240,'Invalid swap message.');
 const o=row.observation;if(o!==null){check(o&&Object.keys(o).every(k=>['state','checkedAt','blockNumber','blockHash','success','networkFeeWei'].includes(k))&&['pending','included','confirmed','failed'].includes(o.state)&&Number.isSafeInteger(o.checkedAt),'Invalid swap observation.');if(o.state!=='pending')check(uint(o.blockNumber)&&hash(o.blockHash)&&typeof o.success==='boolean'&&/^(0|[1-9][0-9]{0,77})$/.test(o.networkFeeWei),'Invalid swap receipt.');}
 return structuredClone(row);
}
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function record(value,write=false){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state',write?'readwrite':'readonly'),s=tx.objectStore('state'),r=write?s.put(value,'attempts'):s.get('attempts');tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Swap storage interrupted.'));});}finally{db.close();}}
async function decode(saved){if(!saved)return [];check(saved.key&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=2000000,'Invalid encrypted swap storage.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:aad},saved.key,saved.box),rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));check(Array.isArray(rows)&&rows.length<=100,'Swap history is full.');rows.forEach(validateDegenAttempt);check(new Set(rows.map(r=>r.id)).size===rows.length,'Duplicate swap attempt.');return rows;}
const channel=typeof window!=='undefined'&&typeof BroadcastChannel==='function'?new BroadcastChannel(DB):null;
export async function readDegenAttempts(){return decode(await record());}
export async function updateDegenAttempts(operation){
 check(navigator.locks,'This browser needs Web Locks to save swaps safely.');
 return navigator.locks.request(DB,async()=>{const saved=await record(),rows=await decode(saved),result=await operation(rows);check(rows.length<=100,'Swap history is full.');rows.forEach(validateDegenAttempt);const key=saved?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,enc.encode(JSON.stringify(rows)));await record({key,iv,box},true);channel?.postMessage('changed');dispatchEvent(new Event('lenz-degen-attempts'));return result;});
}
channel?.addEventListener('message',()=>dispatchEvent(new Event('lenz-degen-attempts')));
