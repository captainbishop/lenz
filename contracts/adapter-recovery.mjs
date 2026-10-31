import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { provider, view } from './client.mjs';
import { checkRheaInstruction } from '../web/public/rhea-protocol.js';

const directory=fileURLToPath(new URL('./.testnet/adapter-transactions/',import.meta.url));
const inFlight=new Set(['checking','redeeming','depositing','swapping','withdrawing_output','withdrawing_refund','paying_output','paying_refund']);
function validate(ref){
  assert(ref?.version===1 && ref.network==='testnet','Invalid transaction reference');
  for(const name of ['adapter','sender'])assert(typeof ref[name]==='string' && ref[name].length<=64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(ref[name]),'Invalid transaction account');
  assert(/^[0-9a-f]{64}$/.test(ref.id),'Invalid swap id');
  assert(typeof ref.txHash==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref.txHash),'Invalid transaction hash');
  assert(['submit','advance','recover_redemption'].includes(ref.method),'Invalid adapter method');
}
// Write only public references, never private keys or a signed transaction payload.
// A durable reference is a prerequisite for broadcasting this transaction.
export async function recordAdapterTransaction(ref,root=directory){
  validate(ref);const dir=join(root,ref.adapter,ref.id);await mkdir(dir,{recursive:true});
  const record={version:1,network:ref.network,adapter:ref.adapter,id:ref.id,sender:ref.sender,txHash:ref.txHash,method:ref.method,recordedAt:new Date().toISOString()};
  const file=join(dir,ref.txHash+'.json');
  try{await writeFile(file,JSON.stringify(record)+'\n',{flag:'wx',flush:true,mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;const existing=JSON.parse(await readFile(file,'utf8'));assert.deepEqual({...existing,recordedAt:record.recordedAt},record,'Transaction reference collision');}
}
export async function latestAdapterTransaction(c,id,root=directory){
  const probe={version:1,network:c.network,adapter:c.adapter,id,sender:c.adapter,txHash:'1'.repeat(32),method:'advance'};validate(probe);
  const dir=join(root,c.adapter,id);let names;
  try{names=await readdir(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const refs=[];
  for(const name of names){assert(/^[1-9A-HJ-NP-Za-km-z]{32,44}\.json$/.test(name),'Invalid journal file');const r=JSON.parse(await readFile(join(dir,name),'utf8'));validate(r);assert(r.id===id && r.adapter===c.adapter && name===r.txHash+'.json','Mismatched journal record');refs.push(r);}
  return refs.sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0]??null;
}
export function inspectAdapterTransaction(c,id,ref,tx,order){
  validate(ref);assert(ref.adapter===c.adapter && ref.id===id && c.network==='testnet','Different adapter reference');
  assert(tx.final_execution_status==='FINAL','Transaction is not final');
  const t=tx.transaction;
  assert(t?.hash===ref.txHash && t.signer_id===ref.sender && t.receiver_id===c.adapter,'Different transaction identity');
  assert(t.actions?.length===1 && t.actions[0].FunctionCall,'Unexpected transaction actions');
  const a=t.actions[0].FunctionCall,args=JSON.parse(Buffer.from(a.args,'base64').toString('utf8'));
  assert(a.method_name===ref.method && String(a.gas)==='250000000000000' && a.deposit===(ref.method==='submit'?'100000000000000000000000':'0'),'Different adapter action');
  if(ref.method!=='submit')assert.deepEqual(args,{id},'Different swap action');
  else assert(order && isDeepStrictEqual(args,{instruction:order.instruction}),'Different signed instruction');
  assert(Array.isArray(tx.receipts_outcome) && tx.receipts_outcome.length>0,'Missing receipt outcomes');
  const outcomes=tx.receipts_outcome,ids=new Set(outcomes.map(r=>r.id));
  assert(ids.size===outcomes.length && tx.transaction_outcome?.id===ref.txHash,'Invalid receipt identities');
  // All execution outcomes must belong to the transaction's receipt graph.
  const byId=new Map(outcomes.map(r=>[r.id,r])),visited=new Set(),active=new Set();
  const walk=outcome=>{assert(Array.isArray(outcome?.receipt_ids),'Missing receipt links');for(const child of outcome.receipt_ids){assert(byId.has(child),'Incomplete receipt graph');assert(!active.has(child),'Cyclic receipt graph');if(!visited.has(child)){visited.add(child);active.add(child);walk(byId.get(child).outcome);active.delete(child);}}};
  walk(tx.transaction_outcome.outcome);assert(visited.size===ids.size,'Unrelated receipt outcome');
  for(const r of [tx.transaction_outcome,...outcomes]){
    const status=r.outcome?.status,key=status&&Object.keys(status)[0];
    assert(status && Object.keys(status).length===1 && ['SuccessValue','SuccessReceiptId','Failure'].includes(key),'Unresolved receipt');
    assert(key==='Failure'?status.Failure && typeof status.Failure==='object':typeof status[key]==='string','Invalid receipt status');
    if(key==='SuccessReceiptId')assert(byId.has(status[key]),'Missing return receipt');
  }
  // The transaction summary must match the outcome reached by promise returns.
  // Other failed receipts can legitimately coexist with a successful callback.
  let returned=tx.transaction_outcome;const returnPath=new Set();
  while(Object.hasOwn(returned.outcome.status,'SuccessReceiptId')){
    const next=returned.outcome.status.SuccessReceiptId;assert(!returnPath.has(next),'Cyclic return path');returnPath.add(next);returned=byId.get(next);
  }
  assert.deepEqual(tx.status,returned.outcome.status,'Transaction summary differs from return receipt');
  if(Object.hasOwn(tx.status,'SuccessValue'))assert(returned.outcome.executor_id===c.adapter,'Different callback executor');
  const failedReceipts=outcomes.filter(r=>Object.hasOwn(r.outcome.status,'Failure')).map(r=>({id:r.id,executor:r.outcome.executor_id,failure:r.outcome.status.Failure}));
  const success=typeof tx.status?.SuccessValue==='string';
  assert(success || Object.hasOwn(tx.status??{},'Failure'),'Unresolved transaction');
  if(success){const returned=JSON.parse(Buffer.from(tx.status.SuccessValue,'base64').toString('utf8'));assert(order && returned?.id===id && isDeepStrictEqual(returned.instruction,order.instruction),'Different callback order');}
  return {state:inFlight.has(order?.stage)||order?.stage==='attention'?'needs_review':success?'confirmed':'transaction_failed',finality:'FINAL',txHash:ref.txHash,failedReceipts};
}
// RPC evidence describes history. Only the adapter's current final state is the
// wallet status; no receipt, failure, expiry or balance delta unlocks an input.
export async function reconcileAdapterOrder(c,id,clients={provider,view,latestAdapterTransaction},reference){
  const ref=reference??await clients.latestAdapterTransaction(c,id);let tx,reconciliation={state:'no_reference'};
  if(ref){
    validate(ref);assert(ref.adapter===c.adapter && ref.id===id,'Different adapter reference');
    try{tx=await clients.provider.viewTransactionStatus({txHash:ref.txHash,accountId:ref.sender,waitUntil:'FINAL'});}
    catch(e){reconciliation={state:'unavailable',txHash:ref.txHash,detail:String(e.message).slice(0,400)};}
  }
  const order=await clients.view(c.adapter,'get_order',{id});
  if(order)assert(order.id===id && await checkRheaInstruction(c,order.instruction)===id,'Different final order');
  if(tx){try{reconciliation=inspectAdapterTransaction(c,id,ref,tx,order);}catch(e){reconciliation={state:'unverified',txHash:ref.txHash,detail:e.message};}}
  return {finality:'FINAL',order,reconciliation};
}
