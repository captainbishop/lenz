import {validateDegenReview,recheckDegenAction,fetchDegenPreflight,checkDegenWallet} from './degen-execution.js';
import {readDegenAttempts,updateDegenAttempts,degenUnresolved} from './degen-execution-store.js';
import {check,hash} from './evm-transfer.js';
import {inspectDegenAction} from './degen-execution-receipt.js';
export function createDegenExecution({read=readDegenAttempts,update=updateDegenAttempts,preflight=fetchDegenPreflight,timeoutMs=60000}={}){
 const change=(id,op)=>update(rows=>{const row=rows.find(r=>r.id===id);check(row,'Saved swap not found.');op(row);row.updatedAt=Date.now();return structuredClone(row);});
 async function reconcile(lease,id,providedHash){
  const row=(await read()).find(r=>r.id===id);check(row,'Saved swap not found.');await checkDegenWallet(lease,row.review.transaction.from);
  const candidate=providedHash||row.hash;check(hash(candidate),'Enter the transaction hash from your wallet.');check(!row.hash||row.hash===candidate,'This attempt has another transaction hash.');
  const observation=await inspectDegenAction(lease,row.review,candidate);check(row.hash||observation.state!=='pending','Transaction is not included yet. Check again.');
  return change(id,current=>{check(!current.hash||current.hash===candidate,'Transaction hash changed.');if(current.observation?.checkedAt>observation.checkedAt)return;current.hash=candidate;current.observation=observation;current.state=observation.state;current.error='';});
 }
 async function send(lease,review,{current=()=>true}={}){
  const r=validateDegenReview(review);await recheckDegenAction(lease,r,{read:preflight,current});
  // Refresh prior inclusion before allowing a subsequent nonce, including approval -> swap.
  for(const row of await read())if(row.review.transaction.from===r.transaction.from&&row.state==='included')await reconcile(lease,row.id);
  const id=crypto.randomUUID(),now=Date.now();
  await update(rows=>{check(rows.length<100,'Swap history is full.');check(!rows.some(row=>row.review.transaction.from===r.transaction.from&&degenUnresolved(row)&&(row.state!=='included'||BigInt(row.review.transaction.nonce)>=BigInt(r.transaction.nonce))),'Check the earlier swap or approval before sending again.');rows.push({id,review:r,state:'awaiting_wallet',hash:null,createdAt:now,updatedAt:now,observation:null,error:''});});
  let dispatched=false;
  const outcome=(async()=>{try{await checkDegenWallet(lease,r.transaction.from);check(current()&&Date.now()<r.expiresAt,'Review expired or changed. Nothing sent.');dispatched=true;const txHash=await lease.sendTransaction(r.transaction);check(hash(txHash),'Wallet returned no usable hash. Check wallet activity.');return await change(id,row=>{check(!row.hash||row.hash===txHash,'Wallet returned a different transaction hash.');row.hash=txHash;if(!row.observation||row.observation.state==='pending')row.state='submitted';row.error='';});}catch(error){return change(id,row=>{if(row.hash)return;row.state=!dispatched?'not_sent':error?.code===4001?'declined':'unknown';row.error=(error instanceof Error?error.message:'Wallet reply unavailable.').slice(0,240);});}})();
  let timer;try{return await Promise.race([outcome,new Promise((resolve,reject)=>{timer=setTimeout(()=>{change(id,row=>{if(row.state==='awaiting_wallet'){row.state='unknown';row.error='Wallet reply delayed. Check activity before trying again.';}}).then(resolve,reject);},timeoutMs);})]);}finally{clearTimeout(timer);}
 }
 return {send,reconcile,read};
}
