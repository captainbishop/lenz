import assert from 'node:assert/strict';
import {view,call} from './client.mjs';
import {checkDepositRequest,refundSource} from '../web/public/near-deposit.js';
export async function depositReceipt(request,clients={view}) {
  await checkDepositRequest(request);
  const root=await clients.view(request.contract,'get_root',{id:request.id});
  assert(root,'The receiving account has not deposited these tokens on NEAR yet');
  assert.deepEqual(root,{id:request.id,owner:request.owner,amount:request.amount},'Unexpected deposit root');
  const spent=await clients.view(request.contract,'spent_by',{id:request.id});
  return {finality:'FINAL',root,spent};
}
export async function returnRefund(account,c,id,request,clients={view,call}) {
  await checkDepositRequest(request);
  assert(/^lenz-dev-[0-9]+\.testnet$/.test(account.accountId),'Only the disposable local test sponsor is supported');
  assert.equal(request.contract,c.reserve,'Wrong deposit reserve');
  assert.equal(request.payer,account.accountId,'This receiving account must sign its own deposit; the local sponsor cannot debit it');
  assert.equal(request.source,await refundSource(c.adapter,id),'Wrong refund source');
  const order=await clients.view(c.adapter,'get_order',{id});
  assert(order?.id===id&&order.stage==='refunded','A final refunded order is required');
  assert.equal(order.instruction.owner,request.owner,'This refund belongs to another Lenz key');
  assert.equal(order.instruction.amount,request.amount,'Return amount differs from refund');
  assert.equal(order.instruction.receiver_id,account.accountId,'The refund did not pay the local sponsor');
  let root=await clients.view(c.reserve,'get_root',{id:request.id}),receipt;
  if(!root){
    assert((await clients.view(c.reserve,'capabilities',{})).includes('deposit_offline_v1'),'The reserve does not support offline deposits yet');
    const {owner,amount,source,signature}=request;
    receipt=await clients.call(account,c.reserve,'deposit_offline',{owner,amount,source,signature},'0.03');
    root=await clients.view(c.reserve,'get_root',{id:request.id});
  }
  assert.deepEqual(root,{id:request.id,owner:request.owner,amount:request.amount},'Unexpected deposit root');
  const spent=await clients.view(c.reserve,'spent_by',{id:request.id});
  return {...receipt,value:undefined,finality:'FINAL',root,spent,recovered:!receipt};
}
