import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { actions, baseEncode, encodeTransaction } from 'near-api-js';
import { createHash } from 'node:crypto';
import { provider, relayAccount, configuration } from './client.mjs';
import { checkRheaPacket, checkRheaInstruction, redemptionTerms } from '../web/public/rhea-protocol.js';
import { transferTerms } from '../web/public/near-protocol.js';
import { checkDepositRequest, refundSource } from '../web/public/near-deposit.js';
import { digest } from '../web/public/peer-crypto.js';
const GAS='250000000000000';
const configFields=['network','adapter','reserve','exchange','poolId','tokenOut'];
const stages=new Set(['checking','ready','redeeming','funded','depositing','deposited','swapping','output_on_dex','refund_on_dex','withdrawing_output','withdrawing_refund','output_available','refund_available','paying_output','paying_refund','complete','refunded','rejected','attention']);
const advance=new Set(['ready','funded','deposited','output_on_dex','refund_on_dex','output_available','refund_available']);
const amount=s=>typeof s==='string' && /^(0|[1-9][0-9]{0,38})$/.test(s) && BigInt(s)<2n**128n;
const hash=s=>typeof s==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const call=(receiver,method,args,deposit,payer=null)=>({receiver,method,args,deposit,gas:GAS,payer});

export async function planDefiAction(c,operation,state) {
  const p=operation.packet,i=p.instruction;
  await checkRheaPacket(c,p);assert.deepEqual(state.root,p.root,'Unrecognized funded reserve root');
  assert(state.finality==='FINAL' && hash(state.block?.hash) && Number.isSafeInteger(state.block.height) && state.block.height>0,'Missing final block');
  const order=state.order;
  if(order) {
    assert(order.id===p.id && isDeepStrictEqual(order.instruction,i) && await checkRheaInstruction(c,order.instruction)===p.id,'Different final order');
    assert(stages.has(order.stage) && amount(order.output),'Invalid order state');
    if(order.stage==='complete') assert(BigInt(order.output)>=BigInt(i.min_output),'Output below approved minimum');
  }
  const result={finality:'FINAL',block:state.block,state:'pending',order,call:null};
  if(operation.kind==='rhea-refund-return') {
    const d=await checkDepositRequest(operation.deposit);
    assert(d.contract===c.reserve && d.payer===i.receiver_id && d.owner===i.owner && d.amount===i.amount
      && d.source===await refundSource(c.adapter,p.id),'Different refund authority');
    assert(order?.stage==='refunded','Refund is not final');
    if(state.depositRoot) {
      assert.deepEqual(state.depositRoot,{id:d.id,owner:d.owner,amount:d.amount},'Different deposit root');
      assert(state.depositSpent===null || /^[0-9a-f]{64}$/.test(state.depositSpent),'Missing deposit consumption check');
      return {...result,state:'observed',deposit:{root:state.depositRoot,spent:state.depositSpent}};
    }
    assert(state.capabilities?.includes('deposit_offline_v1') && amount(state.payerBalance)
      && BigInt(state.payerBalance)>=BigInt(d.amount),'Refund deposit is not funded or supported');
    const {owner,amount:units,source,signature}=d;
    return {...result,state:'ready',step:'deposit',call:call(c.reserve,'deposit_offline',{owner,amount:units,source,signature},'30000000000000000000000',d.payer)};
  }
  assert(operation.kind==='rhea-swap','Unsupported DeFi action');
  for(const spend of p.path) {
    const consumed=state.consumed[spend.input];
    assert(consumed===null || typeof consumed==='string','Missing ancestor consumption check');
    if(consumed!==null && consumed!==await digest(transferTerms(c.reserve,spend)))return {...result,state:'conflicted'};
  }
  const consumed=state.consumed[i.input];
  assert(consumed===null || typeof consumed==='string','Missing input consumption check');
  if(consumed!==null && consumed!==await digest(redemptionTerms(c,i)))return {...result,state:'conflicted'};
  if(order && ['complete','refunded'].includes(order.stage))return {...result,state:'observed'};
  if(order && ['attention','rejected'].includes(order.stage))return {...result,state:'needs_review'};
  if(!order) {
    if(consumed!==null)return {...result,state:'needs_review'};
    if(!state.note) {
      assert(p.path.length>0,'Missing funded input');
      return {...result,state:'ready',step:'settle',call:call(c.reserve,'settle',{path:p.path},'200000000000000000000000')};
    }
    assert.deepEqual(state.note,{id:i.input,owner:i.owner,amount:i.amount},'Different settled input');
    return {...result,state:'ready',step:'submit',call:call(c.adapter,'submit',{instruction:i},'100000000000000000000000')};
  }
  if(advance.has(order.stage))return {...result,state:'ready',step:order.stage,call:call(c.adapter,'advance',{id:p.id},'0')};
  if(order.stage==='redeeming' && c.recoverRedemption===true && consumed!==null)
    return {...result,state:'ready',step:'recover_redemption',call:call(c.adapter,'recover_redemption',{id:p.id},'0')};
  return result;
}

// Checks the exact transaction and complete receipt graph. State observations stay separate.
export function inspectDefiTransaction(ref,expected,tx) {
  assert(tx.final_execution_status==='FINAL','Transaction is not final');
  const t=tx.transaction;
  assert(t?.hash===ref.txHash && t.signer_id===ref.sender && t.receiver_id===expected.receiver,'Different transaction identity');
  assert(t.actions?.length===1 && t.actions[0].FunctionCall,'Unexpected transaction actions');
  const a=t.actions[0].FunctionCall;
  assert(a.method_name===expected.method && String(a.gas)===expected.gas && a.deposit===expected.deposit,'Different transaction call');
  assert.deepEqual(JSON.parse(Buffer.from(a.args,'base64').toString('utf8')),expected.args,'Different transaction arguments');
  const rows=tx.receipts_outcome;assert(Array.isArray(rows) && rows.length>0 && rows.length<=128,'Invalid receipt count');
  const byId=new Map(rows.map(r=>[r.id,r]));assert(byId.size===rows.length,'Duplicate receipts');
  const visited=new Set(),active=new Set();
  function walk(outcome) {
    assert(Array.isArray(outcome?.receipt_ids),'Missing receipt links');
    for(const id of outcome.receipt_ids) {assert(byId.has(id) && !active.has(id),'Broken receipt graph');if(!visited.has(id)){visited.add(id);active.add(id);walk(byId.get(id).outcome);active.delete(id);}}
  }
  assert(tx.transaction_outcome?.id===ref.txHash,'Different transaction outcome');walk(tx.transaction_outcome.outcome);
  assert(visited.size===rows.length,'Unrelated receipts');
  for(const row of [tx.transaction_outcome,...rows]) {
    const s=row.outcome.status,k=Object.keys(s??{})[0];
    assert(Object.keys(s??{}).length===1 && ['SuccessValue','SuccessReceiptId','Failure'].includes(k),'Unresolved receipt');
    assert(k==='Failure'?s[k] && typeof s[k]==='object':typeof s[k]==='string','Invalid receipt status');
    if(k==='SuccessReceiptId')assert(row.outcome.receipt_ids.includes(s[k]),'Return receipt is not a child');
  }
  let returned=tx.transaction_outcome;const path=new Set();
  while(Object.hasOwn(returned.outcome.status,'SuccessReceiptId')) {const id=returned.outcome.status.SuccessReceiptId;assert(!path.has(id),'Cyclic return path');path.add(id);returned=byId.get(id);}
  assert.deepEqual(tx.status,returned.outcome.status,'Contradictory transaction summary');
  if(Object.hasOwn(tx.status,'SuccessValue'))assert(returned.outcome.executor_id===expected.receiver,'Different return executor');
  return {state:Object.hasOwn(tx.status,'Failure')?'failed':'succeeded',finality:'FINAL',txHash:ref.txHash,sender:ref.sender,
    receiptIds:rows.map(r=>r.id),failedReceipts:rows.filter(r=>Object.hasOwn(r.outcome.status,'Failure')).map(r=>r.id)};
}

export async function createDefiExecutorClients(config,{rpc=provider,getSigner=relayAccount,reserveConfig=configuration,now=Date.now}={}) {
  const c=structuredClone(config),reserve=await reserveConfig();
  assert(c.ready===true && c.network==='testnet' && reserve.ready===true && reserve.network==='testnet' && reserve.contract===c.reserve,'Unconfigured testnet executor');
  assert(/^[0-9a-f]{64}$/.test(reserve.wasmSha256) && hash(c.codeHash) && hash(c.exchangeCodeHash),'Missing pinned code hashes');
  const reserveHash=baseEncode(Buffer.from(reserve.wasmSha256,'hex'));
  return {
    async observe(operation) {
      const op=structuredClone(operation);
      assert((await rpc.sendJsonRpc('status',[])).chain_id==='testnet','Different chain');
      const block=await rpc.viewBlock({finality:'final'}),h=block.header;
      assert(hash(h.hash) && Number.isSafeInteger(h.height) && h.height>0 && /^\d+$/.test(String(h.timestamp_nanosec)),'Invalid final block');
      const at=Number(BigInt(h.timestamp_nanosec)/1000000n);assert(Number.isSafeInteger(at) && Math.abs(now()-at)<=120000,'Stale final block');
      const blockQuery={blockId:h.hash};
      for(const [accountId,expected] of [[c.adapter,c.codeHash],[c.exchange,c.exchangeCodeHash],[c.reserve,reserveHash]])
        assert.equal((await rpc.viewAccount({accountId,blockQuery})).code_hash,expected,'Contract code changed');
      const view=(contractId,method,args)=>rpc.callFunction({contractId,method,args,blockQuery});
      assert.deepEqual(await view(c.adapter,'configuration',{}),Object.fromEntries(configFields.map(k=>[k,c[k]])),'Adapter configuration changed');
      const p=op.packet,i=p.instruction;
      const state={finality:'FINAL',block:{hash:h.hash,height:h.height},root:await view(c.reserve,'get_root',{id:p.root.id}),order:await view(c.adapter,'get_order',{id:p.id})};
      if(op.kind==='rhea-refund-return') {
        state.depositRoot=await view(c.reserve,'get_root',{id:op.deposit.id});
        state.depositSpent=await view(c.reserve,'spent_by',{id:op.deposit.id});
        state.capabilities=await view(c.reserve,'capabilities',{});state.payerBalance=await view(c.reserve,'ft_balance_of',{account_id:op.deposit.payer});
      } else {
        state.note=await view(c.reserve,'get_note',{id:i.input});state.consumed={};
        for(const id of new Set([...p.path.map(s=>s.input),i.input]))state.consumed[id]=await view(c.reserve,'spent_by',{id});
      }
      return planDefiAction(c,op,state);
    },
    async send(input,record) {
      const expected=structuredClone(input),account=await getSigner();
      assert(/^lenz-dev-[0-9]+\.testnet$/.test(account.accountId),'Only a disposable test sponsor is supported');
      assert(!expected.payer || expected.payer===account.accountId,'The refund payer must sign its own deposit');
      assert([c.adapter,c.reserve].includes(expected.receiver) && ['settle','submit','advance','recover_redemption','deposit_offline'].includes(expected.method),'Unsupported executor call');
      const original=account.signer;assert(original,'Missing sponsor signer');
      const signer={getPublicKey:()=>original.getPublicKey(),signTransaction:async transaction=>{
        assert.equal(transaction.signerId,account.accountId,'Different signing account');
        assert.equal(transaction.receiverId,expected.receiver,'Different signing target');
        const [a]=transaction.actions;assert(transaction.actions.length===1 && a.functionCall,'Different signing actions');
        assert.equal(a.functionCall.methodName,expected.method);assert.equal(String(a.functionCall.gas),expected.gas);assert.equal(String(a.functionCall.deposit),expected.deposit);
        assert.deepEqual(JSON.parse(Buffer.from(a.functionCall.args).toString()),expected.args);
        const unsigned=Buffer.from(encodeTransaction(transaction));
        const signed=await original.signTransaction(transaction);
        assert(Buffer.from(encodeTransaction(signed.signedTransaction.transaction)).equals(unsigned),'Signer changed the approved transaction');
        const txHash=baseEncode(createHash('sha256').update(encodeTransaction(signed.signedTransaction.transaction)).digest());
        assert.equal(baseEncode(signed.txHash),txHash,'Signed transaction hash mismatch');
        await record({sender:account.accountId,txHash});return signed;
      }};
      return account.signAndSendTransaction({receiverId:expected.receiver,actions:[actions.functionCall(expected.method,expected.args,BigInt(expected.gas),BigInt(expected.deposit))],
        signer,waitUntil:'FINAL',throwOnFailure:false,retries:0});
    },
    async reconcile(ref,expected) {
      try {return inspectDefiTransaction(ref,expected,await rpc.viewTransactionStatus({txHash:ref.txHash,accountId:ref.sender,waitUntil:'FINAL'}));}
      catch {return {state:'unverified',txHash:ref.txHash,sender:ref.sender};}
    }
  };
}
