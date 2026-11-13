import {readState,readStateLocked} from './chat-store.js';
import {assert} from './peer-crypto.js';
import {checkedFinancialReview,mergeFinancialReviews,sealFinancialReview,openFinancialReview} from './financial-reconciliation.js';
import {assertFinancialAccount} from './financial-reconciliation-read.js';
const DB='lenz-financial-reviews-v1';
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('reviews');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function record(id,value,signal){
 const db=await database();try{
  signal?.throwIfAborted();return await new Promise((resolve,reject)=>{
   const tx=db.transaction('reviews',value?'readwrite':'readonly'),store=tx.objectStore('reviews');let r;
   const abort=()=>{try{tx.abort();}catch{}},cleanup=()=>signal?.removeEventListener('abort',abort);
   tx.oncomplete=()=>{cleanup();resolve(r.result);};tx.onerror=()=>{cleanup();reject(signal?.reason??tx.error);};tx.onabort=()=>{cleanup();reject(signal?.reason??tx.error??Error('Financial review save interrupted.'));};
   signal?.addEventListener('abort',abort,{once:true});try{signal?.throwIfAborted();r=value?store.put(value,id):store.get(id);}catch(error){cleanup();abort();reject(error);}
  });
 }finally{db.close();}
}
export async function savedFinancialReview({signal}={}){
 const identity=(await readState()).identity;assert(identity,'Open a Lenz account first.');const archive=await record(identity.profile.id,undefined,signal);
 const value=archive?await openFinancialReview(identity,archive):null;await assertFinancialAccount(identity,signal);return value;
}
export async function saveFinancialReview(input,{signal}={}){
 const review=checkedFinancialReview(input);assert(navigator.locks,'Web Locks are required to save recovery evidence safely.');
 const result=await navigator.locks.request(DB,async()=>readStateLocked(async state=>{
  signal?.throwIfAborted();assert(state.identity?.profile.id===review.identity,'Lenz account changed. Read the retained records again.');
  const previous=await record(review.identity,undefined,signal),merged=previous?mergeFinancialReviews(await openFinancialReview(state.identity,previous),review):review;
  const archive=await sealFinancialReview(state.identity,merged);signal?.throwIfAborted();await record(review.identity,archive,signal);signal?.throwIfAborted();return merged;
 }));
 const identity=(await readState()).identity;assert(identity?.profile.id===review.identity,'Lenz account changed. Open its saved review again.');signal?.throwIfAborted();return result;
}
export async function financialReviewFile(input,{signal}={}){
 const identity=(await readState()).identity;assert(identity,'Open a Lenz account first.');const archive=await sealFinancialReview(identity,input);await assertFinancialAccount(identity,signal);return archive;
}
export async function mergeFinancialReviewFile(file,retained,{signal}={}){
 assert(file&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=4001024,'Choose an encrypted financial review under 4 MB.');
 const identity=(await readState()).identity;assert(identity,'Open a Lenz account first.');signal?.throwIfAborted();
 const text=await file.text();assert(new TextEncoder().encode(text).length<=4001024,'Financial review file is too large.');
 const incoming=await openFinancialReview(identity,JSON.parse(text)),saved=await savedFinancialReview({signal});
 let value=saved?mergeFinancialReviews(saved,incoming):incoming;if(retained)value=mergeFinancialReviews(value,retained);await assertFinancialAccount(identity,signal);return value;
}

/** A retained legacy archive is read only by its original workspace and is never overwritten. */
export function createFinancialReviewStore(workspace){
 assert(workspace&&typeof workspace.workspaceId==='string'&&typeof workspace.readState==='function'&&typeof workspace.readStateLocked==='function','Open a workspace before saving recovery evidence.');
 const key=['workspace',workspace.workspaceId];
 const identityOf=state=>{assert(state.identity,'Open a Lenz account first.');return state.identity;};
 const sameIdentity=(state,identity)=>{
  const current=identityOf(state);
  assert(current.profile.id===identity.profile.id&&current.profile.boxPublic===identity.profile.boxPublic&&current.profile.signingPublic===identity.profile.signingPublic,'Lenz account changed. Open its saved review again.');
 };
 async function retained(identity,signal){
  const scoped=await record(key,undefined,signal);
  const archive=scoped===undefined&&workspace.workspaceId==='legacy'?await record(identity.profile.id,undefined,signal):scoped;
  return archive===undefined?null:openFinancialReview(identity,archive);
 }
 async function read({signal}={}){
  const identity=identityOf(await workspace.readState({signal})),value=await retained(identity,signal);
  return workspace.readStateLocked(state=>{sameIdentity(state,identity);return value;},{signal});
 }
 async function save(input,{signal}={}){
  const review=checkedFinancialReview(input);assert(navigator.locks,'Web Locks are required to save recovery evidence safely.');
  // Legacy saves hold DB while waiting for the session fence; scoped records use a separate lock.
  return workspace.readStateLocked((state,{signal:activeSignal})=>navigator.locks.request(DB+':workspace',{signal:activeSignal},async()=>{
   const identity=identityOf(state);assert(identity.profile.id===review.identity,'Financial review belongs to another Lenz account.');
   const previous=await retained(identity,activeSignal),merged=previous?mergeFinancialReviews(previous,review):review;
   const archive=await sealFinancialReview(identity,merged);activeSignal.throwIfAborted();await record(key,archive,activeSignal);return merged;
  }),{signal});
 }
 async function file(input,{signal}={}){
  const review=checkedFinancialReview(input),identity=identityOf(await workspace.readState({signal}));
  const archive=await sealFinancialReview(identity,review);
  return workspace.readStateLocked(state=>{sameIdentity(state,identity);return archive;},{signal});
 }
 async function mergeFile(file,retainedReview,{signal}={}){
  assert(file&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=4001024,'Choose an encrypted financial review under 4 MB.');
  const retainedCopy=retainedReview?checkedFinancialReview(retainedReview):null,identity=identityOf(await workspace.readState({signal}));
  const text=await file.text();signal?.throwIfAborted();assert(new TextEncoder().encode(text).length<=4001024,'Financial review file is too large.');
  const incoming=await openFinancialReview(identity,JSON.parse(text)),saved=await read({signal});
  let value=saved?mergeFinancialReviews(saved,incoming):incoming;if(retainedCopy)value=mergeFinancialReviews(value,retainedCopy);
  return workspace.readStateLocked(state=>{sameIdentity(state,identity);return value;},{signal});
 }
 return Object.freeze({read,save,file,mergeFile});
}
