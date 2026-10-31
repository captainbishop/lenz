// Read existing testnet history only. No account, key, signing or faucet calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { adapterConfig, verifyAdapter } from './adapter-client.mjs';
import { view } from './client.mjs';
import { reconcileAdapterOrder } from './adapter-recovery.mjs';
import { TESTNET_RPC } from '../integrations/near-network.mjs';
const c=await adapterConfig(),saved=JSON.parse(await readFile(new URL('./adapter/live-results.json',import.meta.url),'utf8'));
assert.equal(saved.adapter,c.adapter);
// The official provider list separates current state from archival history.
// https://docs.near.org/api/rpc/providers (checked 2026-10-30)
const historyRpc='https://archival-rpc.testnet.near.org';
async function history(method,params){
  const response=await fetch(historyRpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'lenz-receipt-check',method,params}),signal:AbortSignal.timeout(15000)});
  assert(response.ok,'Archive RPC HTTP '+response.status);const body=await response.json();
  assert(!body.error,JSON.stringify(body.error));return body.result;
}
const report={checkedAt:new Date().toISOString(),rpc:TESTNET_RPC,historyRpc,adapter:c.adapter,checks:[],scope:'Read-only final RPC queries of previously recorded live testnet transactions. No new transactions, funding or user wallet access. RPC trust is required.'};
try{
  assert.equal((await history('status',[])).chain_id,'testnet');
  console.log('PASS archival testnet identity');
  await verifyAdapter(c);
  const cases=[...['ready','deposited','output_on_dex','complete'].map(stage=>['success',t=>t.order?.stage===stage]),['slippage',t=>t.failedReceipts?.length],['slippage',t=>t.order?.stage==='refunded'],['retry',t=>t.failedReceipts?.length],['retry',t=>t.order?.stage==='complete']];
  for(const [name,pick] of cases){
    const entry=saved.cases[name],previous=entry.transactions.find(pick);assert(previous?.order);
    const ref={version:1,network:'testnet',adapter:c.adapter,id:entry.packet.id,sender:c.refundPayer,txHash:previous.txHash,method:previous.order.stage==='ready'?'submit':'advance'};
    let raw;
    const clients={provider:{viewTransactionStatus:async args=>{raw=await history('tx',{tx_hash:args.txHash,sender_account_id:args.accountId,wait_until:args.waitUntil});return raw;}},view};
    const result=await reconcileAdapterOrder(c,ref.id,clients,ref);
    assert.equal(result.reconciliation.state,'confirmed',JSON.stringify(result.reconciliation));
    assert.equal(result.order.stage,entry.order.stage);assert.equal(result.reconciliation.failedReceipts.length,previous.failedReceipts.length);
    report.checks.push({name:name+': '+previous.order.stage,reference:ref,result,transaction:raw});
    console.log('PASS '+name+': '+previous.order.stage);
  }
  report.ok=true;
}catch(e){report.ok=false;report.failure=e.message;throw e;}
finally{
  await writeFile(new URL('./adapter/recovery-live-attempt.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  if(report.ok)await writeFile(new URL('./adapter/recovery-live-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
