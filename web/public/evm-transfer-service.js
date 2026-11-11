import {check,hash,validateReview,recheckTransfer,inspectTransfer} from './evm-transfer.js';
import {readTransfers,updateTransfers,transferOpen} from './evm-transfer-store.js';
import {checkFundingTransfer} from './private-funding.js';
const errorText=e=>(e instanceof Error?e.message:'Wallet reply unavailable.').slice(0,240);
export function createTransferService({read=readTransfers,update=updateTransfers,timeoutMs=60000}={}){
 async function change(id,operation){return update(rows=>{const row=rows.find(r=>r.id===id);check(row,'Saved transfer not found.');operation(row);row.updatedAt=Date.now();return structuredClone(row);});}
 async function send(lease,review){
  review=validateReview(review);await recheckTransfer(lease,review);
  const id=crypto.randomUUID(),now=Date.now();
  // Atomic cross-tab barrier: uncertainty about an earlier send blocks a new one.
  await update(rows=>{check(!rows.some(r=>transferOpen(r)&&r.review.terms.chainId===review.terms.chainId&&r.review.terms.from===review.terms.from),'Check the earlier transfer before sending again.');check(rows.length<200,'Transfer history is full.');rows.push({id,review,state:'awaiting_wallet',hash:null,createdAt:now,updatedAt:now,observation:null,error:''});});
  let dispatched=false;
  const outcome=(async()=>{
   try{
    lease.assertCurrent();check(Date.now()<review.expiresAt,'Review expired. Check again.');
    if(review.version===3)checkFundingTransfer(review,{now:Date.now()});
    // Capture synchronous throws before treating the request as dispatched.
    dispatched=true;const transactionHash=await lease.sendTransaction(review.transaction);
    check(hash(transactionHash),'Wallet returned no usable transaction hash. Check wallet activity.');
    return await change(id,row=>{check(row.hash===null||row.hash===transactionHash,'Wallet returned a different transaction hash.');row.hash=transactionHash;if(!row.observation||row.observation.state==='pending')row.state='submitted';row.error='';});
   }catch(error){
    return change(id,row=>{if(row.hash)return;row.state=!dispatched?'not_sent':error?.code===4001?'declined':'unknown';row.error=errorText(error);});
   }
  })();
  let timer;
  try{return await Promise.race([outcome,new Promise((resolve,reject)=>{timer=setTimeout(()=>{change(id,row=>{if(row.state==='awaiting_wallet'){row.state='unknown';row.error='Wallet reply delayed. Check wallet activity before sending again.';}}).then(resolve,reject);},timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }
 async function reconcile(lease,id,providedHash){
  const row=(await read()).find(r=>r.id===id);check(row,'Saved transfer not found.');
  check(row.review.terms.from===lease.identity.address&&row.review.terms.chainId===lease.identity.chainId,'Connect the original account and network.');
  const candidate=providedHash||row.hash;check(hash(candidate),'Enter the transaction hash from your wallet.');check(!row.hash||candidate===row.hash,'This attempt already has a different transaction hash.');
  const observation=await inspectTransfer(lease,row.review,candidate);
  // An unobserved pasted hash cannot bind or release an ambiguous attempt.
  check(row.hash||observation.state!=='pending','Transaction is not yet included. Check the hash in your wallet and try again.');
  return change(id,current=>{check(!current.hash||current.hash===candidate,'Transaction hash changed.');if(current.observation&&current.observation.checkedAt>observation.checkedAt)return;current.hash=candidate;current.observation=observation;current.state=observation.state;current.error='';});
 }
 return Object.freeze({send,reconcile});
}
