import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nearToYocto, teraToGas, getTransactionLastResult, actions, baseEncode } from 'near-api-js';
import { createHash } from 'node:crypto';
import { provider, view } from './client.mjs';
import { checkRheaPacket, swapTerms } from '../web/public/rhea-protocol.js';
import { recordAdapterTransaction } from './adapter-recovery.mjs';
export async function adapterConfig(){return JSON.parse(await readFile(new URL('../web/public/rhea-config.json',import.meta.url),'utf8'));}
export async function verifyAdapter(c){
  assert(c.ready && c.network==='testnet');
  assert.equal((await provider.sendJsonRpc('status',[])).chain_id,'testnet','RPC returned another network');
  const state=await provider.viewAccount({accountId:c.adapter,blockQuery:{finality:'final'}});assert.equal(state.code_hash,c.codeHash,'Adapter code changed');
  const dex=await provider.viewAccount({accountId:c.exchange,blockQuery:{finality:'final'}});assert.equal(dex.code_hash,c.exchangeCodeHash,'Exchange code changed');
  assert.deepEqual(await view(c.adapter,'configuration',{}),{network:c.network,adapter:c.adapter,reserve:c.reserve,exchange:c.exchange,poolId:c.poolId,tokenOut:c.tokenOut});
}
export async function adapterCall(account,c,method,args,record=recordAdapterTransaction){
  assert(['submit','advance','recover_redemption'].includes(method));
  if(method==='recover_redemption'){assert(c.recoverRedemption===true,'Recovery is not enabled');assert.deepEqual(Object.keys(args),['id'],'Recovery accepts only a swap id');}
  const id=method==='submit'?createHash('sha256').update(JSON.stringify(swapTerms(c,args.instruction))).digest('hex'):args.id;
  assert(c.network==='testnet' && /^[0-9a-f]{64}$/.test(id));
  const original=account.signer;assert(original,'Missing relay signer');let sentHash;
  const signer={getPublicKey:()=>original.getPublicKey(),signTransaction:async transaction=>{
    const signed=await original.signTransaction(transaction);sentHash=baseEncode(signed.txHash);
    await record({version:1,network:c.network,adapter:c.adapter,id,sender:account.accountId,txHash:sentHash,method});
    return signed;
  }};
  const tx=await account.signAndSendTransaction({receiverId:c.adapter,actions:[actions.functionCall(method,args,teraToGas('250'),nearToYocto(method==='submit'?'0.1':'0'))],waitUntil:'FINAL',throwOnFailure:false,signer});
  assert(tx.transaction?.hash===sentHash,'Different submitted transaction');
  assert(tx.final_execution_status==='FINAL' && typeof tx.status==='object' && Object.hasOwn(tx.status,'SuccessValue'),'Adapter call did not reach a successful final callback');
  // A caught DEX/payout failure can be a valid refund/retry state. Retain each failed receipt.
  return {finality:'FINAL',txHash:tx.transaction.hash,receiptIds:tx.receipts_outcome.map(r=>r.id),
    failedReceipts:tx.receipts_outcome.filter(r=>r.outcome.status?.Failure).map(r=>({id:r.id,failure:r.outcome.status.Failure})),
    gasBurnt:tx.receipts_outcome.reduce((n,r)=>n+BigInt(r.outcome.gas_burnt),0n).toString(),order:getTransactionLastResult(tx)};
}
export async function verifyPacketRoot(c,packet){
  await checkRheaPacket(c,packet);
  assert.deepEqual(await view(c.reserve,'get_root',{id:packet.root.id}),packet.root,'Unrecognized funded reserve root');
}
