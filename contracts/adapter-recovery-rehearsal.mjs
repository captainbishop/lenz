// One bounded testnet advance on an already complete order, with a lost reply.
// Resume the saved hash after interruption; never create a second test call.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { adapterConfig, verifyAdapter, adapterCall } from './adapter-client.mjs';
import { relayAccount, provider, view } from './client.mjs';
import { latestAdapterTransaction, recordAdapterTransaction, reconcileAdapterOrder } from './adapter-recovery.mjs';
const file=new URL('./adapter/recovery-rehearsal.json',import.meta.url),c=await adapterConfig();
const history=JSON.parse(await readFile(new URL('./adapter/live-results.json',import.meta.url),'utf8')),id=history.cases.success.packet.id;
let report;try{report=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
report??={adapter:c.adapter,id,checks:[],scope:'One testnet advance on an already complete order. It spends test gas only. The RPC reply is deliberately lost after execution; recovery uses the hash saved before broadcast. No funding, redeployment, user wallet or real funds.'};
assert(report.adapter===c.adapter && report.id===id);
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n',{flush:true});
try{
  await verifyAdapter(c);const order=await view(c.adapter,'get_order',{id});assert.equal(order.stage,'complete');
  const balances=async()=>({receiver:await view(c.tokenOut,'ft_balance_of',{account_id:order.instruction.receiver_id}),adapter:await view(c.tokenOut,'ft_balance_of',{account_id:c.adapter}),tusd:await view(c.reserve,'ft_balance_of',{account_id:order.instruction.receiver_id})});
  if(!report.reference){
    report.before=await balances();report.order=order;await save();const account=await relayAccount();
    const transport=Object.create(provider);transport.sendTransactionUntil=async(signed,wait)=>{
      assert.deepEqual(await latestAdapterTransaction(c,id).then(({recordedAt,...r})=>r),report.reference);
      await provider.sendTransactionUntil(signed,wait);report.replyLost=true;await save();throw Error('Deliberately lost test RPC reply');
    };account.provider=transport;
    await assert.rejects(adapterCall(account,c,'advance',{id},async ref=>{await recordAdapterTransaction(ref);report.reference=ref;await save();}),/Deliberately lost test RPC reply/);
  }
  const result=await reconcileAdapterOrder(c,id);assert.equal(result.reconciliation.state,'confirmed');assert.equal(result.reconciliation.txHash,report.reference.txHash);assert.deepEqual(result.order,report.order);
  report.after=await balances();assert.deepEqual(report.after,report.before);
  report.result=result;report.checks=['exact transaction reference persisted before broadcast','lost response recovered by final transaction hash','terminal order and all checked token balances unchanged'];report.checkedAt=new Date().toISOString();report.ok=true;delete report.failure;await save();console.log('PASS '+report.checks.join('\nPASS '));
}catch(e){report.ok=false;report.failure=e.message;await save();throw e;}
