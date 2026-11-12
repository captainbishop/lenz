import {readState,readStateLocked} from './chat-store.js';
import {checkedLendingPosition} from './lending-position.js';

const DB='lenz-lending-positions-v1',encoder=new TextEncoder();
const check=(ok,message)=>{if(!ok)throw Error(message);};
export const lendingOwner=state=>state.identity?.profile.id??'guest';
const aad=owner=>encoder.encode(DB+':'+owner);
async function record(owner,value,{current=()=>true,signal}={}){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{
  signal?.throwIfAborted();check(current(),'Account changed. Position was not saved.');
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('snapshots',value?'readwrite':'readonly'),store=tx.objectStore('snapshots');let r;
   const abort=()=>{try{tx.abort();}catch{}},cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});
   tx.oncomplete=()=>{cleanup();resolve(r.result);};tx.onerror=()=>{cleanup();reject(tx.error);};tx.onabort=()=>{cleanup();reject(signal?.reason??tx.error??Error('Position storage interrupted.'));};
   try{signal?.throwIfAborted();check(current(),'Account changed. Position was not saved.');r=value?store.put(value,owner):store.get(owner);r.onsuccess=()=>{if(signal?.aborted||!current())abort();};}catch(error){abort();cleanup();reject(error);}
  });
 }finally{db.close();}
}
export async function savedLendingPositions(state=undefined){
 state??=await readState();const owner=lendingOwner(state),saved=await record(owner);if(!saved)return[];
 check(saved.key&&saved.key.type==='secret'&&saved.key.extractable===false&&saved.iv instanceof Uint8Array&&saved.iv.length===12&&saved.box instanceof ArrayBuffer&&saved.box.byteLength<=128000,'Saved lending positions could not be read.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:aad(owner)},saved.key,saved.box);
 try{const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));check(Array.isArray(rows)&&rows.length<=16,'Invalid saved lending positions.');const checked=rows.map(checkedLendingPosition);check(new Set(checked.map(r=>r.account+':'+r.chainId+':'+r.asset.id)).size===checked.length,'Duplicate saved position.');return checked;}finally{new Uint8Array(plain).fill(0);}
}
export async function saveLendingPosition(snapshot,expectedOwner,current=()=>true,{signal}={}){
 const value=checkedLendingPosition(snapshot);check(navigator.locks,'This browser cannot safely save positions.');
 return navigator.locks.request(DB,()=>readStateLocked(async state=>{
  signal?.throwIfAborted();check(lendingOwner(state)===expectedOwner&&current(),'Account changed. Read the position again.');
  const stored=await savedLendingPositions(state),same=r=>r.account===value.account&&r.chainId===value.chainId&&r.asset.id===value.asset.id,earlier=stored.find(same);
  check(!earlier||BigInt(value.block)>=BigInt(earlier.block)&&value.observedAt>=earlier.observedAt&&(BigInt(value.block)!==BigInt(earlier.block)||value.blockHash===earlier.blockHash),'An earlier or conflicting position cannot replace the saved observation.');
  const fields=['provider','asset','aToken','variableDebtToken','stableDebtToken','stableDebtStatus','reserveId','suppliedUnits','variableDebtUnits','stableDebtUnits','collateral','blockTime'];
  check(!earlier||BigInt(value.block)!==BigInt(earlier.block)||JSON.stringify(fields.map(key=>value[key]))===JSON.stringify(fields.map(key=>earlier[key])),'Conflicting data at the same canonical block cannot replace the saved observation.');
  const rows=stored.filter(r=>!same(r));rows.push(value);while(rows.length>16)rows.shift();
  const previous=await record(expectedOwner),key=previous?.key??await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),plain=encoder.encode(JSON.stringify(rows));check(plain.byteLength<=127984,'Saved positions are too large.');
  let box;try{box=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(expectedOwner)},key,plain);}finally{plain.fill(0);}
  // The chat identity lock remains held until commit; the signal cancels wallet changes during the write.
  signal?.throwIfAborted();check(current(),'Account changed. Read the position again.');await record(expectedOwner,{key,iv,box},{current,signal});
 }));
}
