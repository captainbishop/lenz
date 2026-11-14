import { readState, updateState } from './chat-store.js';
import { assert, digest, keysAre, validateProfile, openMessage, randomId } from './peer-crypto.js';
import { readNearVault, saveNearVault, nearLedger, units } from './near-protocol.js';
import { prepareRheaSwap, checkRheaConfig, checkRheaInstruction } from './rhea-protocol.js';
import { createDefiRequest, checkDefiRequest, sealDefiRequest, openDefiReceipt, openDefiObservation, DEFI_RECEIPT, DEFI_OBSERVATION, carrierSenderProfile, PUBLIC_TESTNET_DISCLOSURE } from './defi-request.js';
import { wrapForCarrier, validateEnvelope } from './carrier-protocol.js';
import { prepareRefundReturn, checkDepositRequest, refundSource, acceptDepositResult } from './near-deposit.js';

// Browser service only. Every outward result follows the shared IndexedDB commit.
// Swap status reads cannot credit a wallet. A refund return needs its own final root.
const reference = order => ({orderId:order.packet.id, requestId:order.defi.request.id});
const route = c => [c.network,c.adapter,c.reserve,c.exchange,c.poolId,c.tokenOut];
async function checkedOrder(state,c,order) {
  assert(order?.defi, 'No saved executor approval');
  const a=order.defi;
  const request=await checkDefiRequest(c,state.identity.profile,a.executor,a.request,a.request.createdAt);
  assert(request.operation.kind==='rhea-swap' && await digest(request.operation.packet)===await digest(order.packet), 'Saved approval differs from its reservation');
  assert(a.packet.from===request.sender && a.packet.to===request.executor, 'Saved handoff has the wrong direction');
  assert(await digest(await openMessage(state.identity,a.executor,a.packet))===await digest(request), 'Saved handoff differs from its approval');
  return request;
}
function configured(config) {
  const c=structuredClone(config);checkRheaConfig(c);
  assert(c.ready===true, 'Swaps are not configured');return c;
}

async function checkedRefund(state,c,order) {
  const request=await checkedOrder(state,c,order),checked=order.defi.checkedOutcome;
  assert(checked?.state==='observed' && checked.order?.stage==='refunded', 'Check the final refund before returning it to Lenz.');
  assert(checked.order.id===order.packet.id && await digest(checked.order.instruction)===await digest(order.packet.instruction)
    && await digest(order.status)===await digest(checked.order), 'The saved refund differs from its confirmed order.');
  if(order.returnRequest) {
    const d=await checkDepositRequest(order.returnRequest),i=order.packet.instruction;
    assert(d.contract===c.reserve && d.owner===i.owner && d.payer===i.receiver_id && d.amount===i.amount
      && d.source===await refundSource(c.adapter,order.packet.id), 'The saved return differs from this refund.');
  }
  return request;
}

export async function prepareDefiRefund(config,requestId) {
  const c=configured(config);
  return updateState(async state=>{
    const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
    await checkedRefund(state,c,order);
    order.returnRequest??=await prepareRefundReturn(vault,state.identity,order);
    await saveNearVault(state,vault);
    return structuredClone(order.returnRequest);
  });
}

export async function checkDefiRefund(config,requestId,{signal}={}) {
  const c=configured(config);assert(navigator.onLine,'Connect to check the saved refund return.');
  const initial=await readState(),vault=await readNearVault(initial,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
  const request=await checkedRefund(initial,c,order),deposit=order.returnRequest,owner=initial.identity.profile.id;
  assert(deposit,'Prepare the refund return first.');
  const allowed=state=>{signal?.throwIfAborted();assert(state.identity?.profile.id===owner,'The selected account changed. Check the return again.');};
  allowed(await readState());
  const publicProfile=p=>carrierSenderProfile({id:p.id,signingPublic:p.signingPublic,boxPublic:p.boxPublic});
  const response=await fetch('/api/defi/rhea/refund-status',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    body:JSON.stringify({sender:publicProfile(initial.identity.profile),executor:publicProfile(order.defi.executor),request,deposit}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  assert(response.ok,'The refund return could not be checked. Its request stays saved.');
  const text=await response.text();assert(text.length<=100000,'Refund update is too large');const result=JSON.parse(text),o=result.observation;
  assert(keysAre(result,['requestId','depositId','state','observation']) && result.requestId===request.id && result.depositId===deposit.id
    && ['ready','observed'].includes(result.state),'Different refund update');
  assert(keysAre(o,['finality','block','order','deposit']) && o.finality==='FINAL' && Number.isSafeInteger(o.block?.height) && o.block.height>0
    && typeof o.block.hash==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.block.hash),'Refund confirmation is not final');
  assert(await digest(o.order)===await digest(order.defi.checkedOutcome.order),'The final refund order changed.');
  if(result.state==='observed')assert(keysAre(o.deposit,['root','spent']),'Missing returned reserve evidence');
  else assert(o.deposit===null,'Unconfirmed deposit evidence');
  return updateState(async state=>{
    allowed(state);
    let current=await readNearVault(state,c.reserve);
    let entry=(current.rheaOrders??[]).find(row=>row.defi?.request.id===requestId);
    await checkedRefund(state,c,entry);
    assert(await digest(entry.returnRequest)===await digest(deposit),'The saved return request changed.');
    const previous=entry.defi.refundCheck,priorBlock=previous?.block??entry.defi.checkedOutcome.block;
    assert(o.block.height>=priorBlock.height,'An older refund update was ignored.');
    if(o.block.height===priorBlock.height)assert(o.block.hash===priorBlock.hash,'Conflicting refund confirmation.');
    if(previous?.state==='observed')assert(result.state==='observed','A confirmed return cannot become pending.');
    if(result.state==='observed') {
      const known=current.chainConsumed?.[deposit.id];
      assert(!known || !o.deposit.spent || known===o.deposit.spent,'Conflicting return consumption.');
      current=await acceptDepositResult(current,state.identity,deposit,{finality:'FINAL',...o.deposit,block:o.block});
      entry=current.rheaOrders.find(row=>row.defi?.request.id===requestId);
      entry.returnReceipt={rootId:deposit.id,block:o.block};
    }
    entry.defi.refundCheck={state:result.state,block:o.block,checkedAt:Date.now()};
    await saveNearVault(state,current);allowed(state);
    return structuredClone(entry.defi.refundCheck);
  },{signal});
}

export async function reviewDefiRefund(config,requestId) {
  const c=configured(config);
  return updateState(async state=>{
    const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
    await checkedRefund(state,c,order);assert(!order.returnReceipt,'This refund has already returned.');
    order.returnRequest??=await prepareRefundReturn(vault,state.identity,order);
    const review={id:randomId(),owner:state.identity.profile.id,depositId:order.returnRequest.id,expiresAt:Date.now()+300000};
    order.defi.refundReview=review;await saveNearVault(state,vault);
    return {review:structuredClone(review),deposit:structuredClone(order.returnRequest)};
  });
}

export async function submitDefiRefund(config,requestId,approval,{signer,signal}={}) {
  const c=configured(config),review=structuredClone(approval);
  assert(keysAre(review,['id','owner','depositId','expiresAt']),'Review this refund before signing.');
  const allowed=state=>{
    signal?.throwIfAborted();assert(navigator.onLine,'Reconnect before returning this refund.');
    assert(state.identity?.profile.id===review.owner,'The selected account changed. Review the return again.');
    assert(Date.now()<review.expiresAt,'This review expired. Review the return again.');
  };
  return navigator.locks.request('lenz-defi-refund-sign',{ifAvailable:true},async lock=>{
    assert(lock,'Another refund approval is already open.');
    const context=await updateState(async state=>{
      allowed(state);
      const vault=await readNearVault(state,c.reserve),entry=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
      await checkedRefund(state,c,entry);assert(!entry.returnReceipt,'This refund has already returned.');
      assert(await digest(entry.defi.refundReview)===await digest(review) && entry.returnRequest?.id===review.depositId,'Open a fresh review before another submission.');
      entry.defi.refundAttempt={reviewId:review.id,depositId:review.depositId,attemptedAt:Date.now()};
      delete entry.defi.refundReview;
      await saveNearVault(state,vault);allowed(state);
      return {config:c,entry:structuredClone(entry),identity:state.identity};
    },{signal});
    context.beforeSign=async()=>{
      const state=await readState();allowed(state);
      const vault=await readNearVault(state,c.reserve),entry=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
      assert(entry?.defi.refundAttempt?.reviewId===review.id && !entry.returnReceipt,'This submission was superseded or already confirmed.');
      assert(await digest(entry.returnRequest)===await digest(context.entry.returnRequest),'The saved return request changed.');
      allowed(await readState());
    };
    await context.beforeSign();
    const {signRefundDeposit}=await import('./near-signer.js');
    await signRefundDeposit(context.entry.returnRequest,context,signer);
    // A wallet result is not backing. Keep the durable attempt for a separate check.
    await context.beforeSign();
    return {state:'unconfirmed',depositId:review.depositId};
  });
}

export async function approveDefiSwap(config,executor,swap,consent) {
  const c=configured(config),chosen=structuredClone(executor),s=structuredClone(swap),approval=structuredClone(consent);
  assert(keysAre(s,['text','minOutput','receiver','deadlineMs']) && keysAre(approval,['approvalId','disclosure','expiresAt']), 'Invalid swap approval');
  assert(typeof approval.approvalId==='string' && /^[0-9a-f]{32}$/.test(approval.approvalId), 'Invalid local approval id');
  assert(approval.disclosure===PUBLIC_TESTNET_DISCLOSURE, 'Explicit executor and public-testnet consent is required');
  const peer=await validateProfile(chosen);
  const binding=await digest(['lenz/wallet-defi-approval/v1',route(c),peer.id,units(s.text),s.minOutput,s.receiver,s.deadlineMs,approval.expiresAt,approval.disclosure]);
  return updateState(async state=>{
    assert(state.identity, 'Create a Lenz profile first');
    const vault=await readNearVault(state,c.reserve);
    const existing=(vault.rheaOrders??[]).find(o=>o.defi?.approvalId===approval.approvalId);
    if(existing) {
      assert(existing.defi.binding===binding, 'This approval id already has different terms');
      await checkedOrder(state,c,existing);return reference(existing);
    }
    const now=Date.now(),prepared=await prepareRheaSwap(vault,state.identity,c,s,now);
    const request=await createDefiRequest(state.identity,peer,c,{kind:'rhea-swap',packet:prepared.packet},approval,now);
    const packet=await sealDefiRequest(state.identity,peer,c,request,Date.now());
    const order=prepared.vault.rheaOrders.at(-1);
    order.defi={approvalId:approval.approvalId,binding,executor:peer,request,packet,storageReceipt:null};
    assert(Date.now()<request.expiresAt, 'Approval expired before saving');
    await saveNearVault(state,prepared.vault);
    return reference(order);
  });
}

export async function defiHandoff(config,requestId,{envelope=false,carrier=false}={}) {
  const c=configured(config);
  return updateState(async state=>{
    const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
    const request=await checkedOrder(state,c,order),ledger=await nearLedger(vault),input=order.packet.instruction.input;
    if(carrier)assert(state.carrier?.enabled===true, 'Turn on internet delivery before sending through carriers');
    assert(!ledger.consumed.has(input) && !ledger.blocked.has(input), 'Reserved input has a known conflict');
    assert(!['complete','refunded'].includes(order.status?.stage), 'This swap is already resolved');
    assert(order.defi.checkedOutcome?.state!=='conflicted','This payment has a confirmed conflict. Review it before sharing again.');
    await checkDefiRequest(c,state.identity.profile,order.defi.executor,request,Date.now());
    assert(Date.now()<request.expiresAt, 'Approval expired before handoff');
    if(envelope) {
      if(!order.defi.envelope) {
        order.defi.envelope=await wrapForCarrier(state.identity,order.defi.packet,request.createdAt);
        await saveNearVault(state,vault);
      }
      await validateEnvelope(order.defi.envelope);
      assert(await digest(order.defi.envelope.packet)===await digest(order.defi.packet), 'Carrier handoff differs from the saved request');
      assert(Date.now()<request.expiresAt, 'Approval expired while preparing its carrier envelope');
      return structuredClone(order.defi.envelope);
    }
    return structuredClone(order.defi.packet);
  });
}

export async function defiCourierSources(state,config){
  if(!config?.ready||!state.identity)return [];
  const c=configured(config),vault=await readNearVault(state,c.reserve),ledger=await nearLedger(vault),items=[];
  for(const order of vault.rheaOrders??[]){
    if(!order.defi)continue;
    let request;try{request=await checkedOrder(state,c,order);}catch{continue;}
    const input=order.packet.instruction.input;
    items.push({packet:order.defi.packet,kind:'defi-approval',acknowledged:!!order.defi.storageReceipt,
      sendable:Date.now()<request.expiresAt&&!order.defi.storageReceipt&&order.defi.checkedOutcome?.state!=='conflicted'&&!ledger.consumed.has(input)&&!ledger.blocked.has(input)&&!['complete','refunded'].includes(order.status?.stage),
      expiresAt:request.expiresAt});
  }
  return items;
}

export async function acceptDefiStorageReceipt(state,config,requestId,incoming){
  const c=configured(config),vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
  const request=await checkedOrder(state,c,order);
  const receipt=await openDefiReceipt(state.identity,order.defi.executor,incoming,request);
  assert(receipt.storedAt<=Date.now()+60000, 'Storage receipt is in the future');
  if(!order.defi.storageReceipt){order.defi.storageReceipt=receipt;await saveNearVault(state,vault);}
  return {requestId:request.id,state:'stored'};
}

export async function recordDefiStorageReceipt(config,requestId,packet) {
  const c=configured(config),incoming=structuredClone(packet);
  return updateState(state=>acceptDefiStorageReceipt(state,c,requestId,incoming));
}

export async function recordDefiReply(config,requestId,packet) {
  const c=configured(config),incoming=structuredClone(packet);
  assert(typeof requestId==='string' && /^[0-9a-f]{64}$/.test(requestId),'Choose a saved swap');
  return updateState(async state=>{
    assert(await acceptDefiReply(state,c,incoming,{requestId}),'Invalid executor update for this wallet');
    return {requestId};
  });
}

export async function acceptDefiReply(state,config,incoming,{requestId=null}={}) {
  if(!config?.ready || !state.identity)return false;
  // Identify ordinary contact messages before touching a possibly unavailable payment vault.
  const contact=state.contacts.find(p=>p.id===incoming.from);
  let payload=contact?await openMessage(state.identity,contact,incoming):null;
  if(payload && ![DEFI_RECEIPT,DEFI_OBSERVATION].includes(payload.type))return false;
  const c=configured(config),packet=structuredClone(incoming),vault=await readNearVault(state,c.reserve);
  const orders=(vault.rheaOrders??[]).filter(o=>o.defi?.executor.id===packet.from);
  if(!orders.length)return false;
  payload??=await openMessage(state.identity,orders[0].defi.executor,packet);
  if(![DEFI_RECEIPT,DEFI_OBSERVATION].includes(payload?.type))return false;
  const order=orders.find(o=>o.defi.request.id===payload.requestId),request=await checkedOrder(state,c,order);
  if(requestId!==null)assert(request.id===requestId,'This update belongs to another saved swap');
  if(payload.type===DEFI_RECEIPT)await acceptDefiStorageReceipt(state,c,request.id,packet);
  else {
    const report=await openDefiObservation(state.identity,order.defi.executor,packet,request),id=await digest(report),previous=order.defi.executorUpdate;
    // Keep one bounded update; duplicate ciphertext or delayed older reports cannot grow the vault.
    if(previous?.id===id || previous?.report.checkedAt>report.checkedAt)return true;
    assert(!previous || previous.report.checkedAt!==report.checkedAt,'Conflicting executor updates. The saved update is unchanged.');
    order.defi.executorUpdate={id,report,receivedAt:Date.now()};
    await saveNearVault(state,vault);
  }
  return true;
}

export async function pendingDefiChecks(state,config) {
  if(!config?.ready || !state.identity || !state.carrier?.enabled)return [];
  const vault=await readNearVault(state,configured(config).reserve);
  return (vault.rheaOrders??[]).filter(o=>o.defi?.executorUpdate && !['observed','conflicted'].includes(o.defi.checkedOutcome?.state))
    .map(o=>({requestId:o.defi.request.id,updateId:o.defi.executorUpdate.id,checkedAt:o.defi.checkedOutcome?.checkedAt??0}));
}

export async function checkDefiSwap(config,requestId,{signal,automatic=false}={}) {
  const c=configured(config);assert(navigator.onLine,'Connect to check this swap. Its saved details are unchanged.');
  const initial=await readState(),vault=await readNearVault(initial,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
  const request=await checkedOrder(initial,c,order),owner=initial.identity.profile.id;
  const updateId=order.defi.executorUpdate?.id;
  function allowed(state) {
    signal?.throwIfAborted();
    assert(state.identity?.profile.id===owner,'The selected account changed. Check the swap again.');
    if(automatic)assert(state.carrier?.enabled && navigator.onLine,'Automatic delivery is paused. The update stays saved.');
  }
  allowed(await readState());
  const publicProfile=p=>carrierSenderProfile({id:p.id,signingPublic:p.signingPublic,boxPublic:p.boxPublic});
  const response=await fetch('/api/defi/rhea/status',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    body:JSON.stringify({sender:publicProfile(initial.identity.profile),executor:publicProfile(order.defi.executor),request}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  assert(response.ok,'The swap could not be checked. Its saved details are unchanged.');
  const text=await response.text();assert(text.length<=100000,'Swap update is too large');const result=JSON.parse(text),o=result.observation;
  assert(keysAre(result,['requestId','state','observation']) && result.requestId===request.id
    && ['ready','pending','observed','conflicted','needs_review'].includes(result.state),'Different swap update');
  assert(keysAre(o,['finality','block','order']) && o.finality==='FINAL' && Number.isSafeInteger(o.block?.height) && o.block.height>0
    && typeof o.block.hash==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.block.hash),'Swap confirmation is not final');
  if(o.order) {
    assert(o.order.id===order.packet.id && await digest(o.order.instruction)===await digest(order.packet.instruction)
      && await checkRheaInstruction(c,o.order.instruction)===order.packet.id,'Swap update has different terms');
    assert(['checking','ready','redeeming','funded','depositing','deposited','swapping','output_on_dex','refund_on_dex','withdrawing_output','withdrawing_refund','output_available','refund_available','paying_output','paying_refund','complete','refunded','rejected','attention'].includes(o.order.stage),'Unknown swap stage');
    assert(typeof o.order.output==='string' && /^(0|[1-9][0-9]{0,38})$/.test(o.order.output) && BigInt(o.order.output)<2n**128n,'Invalid swap output');
    if(o.order.stage==='complete')assert(BigInt(o.order.output)>=BigInt(order.packet.instruction.min_output),'Swap output is below the approved minimum');
  } else assert(o.order===null,'Invalid swap order');
  if(result.state==='observed')assert(['complete','refunded'].includes(o.order?.stage),'Swap outcome is incomplete');
  return updateState(async state=>{
    allowed(state);
    const current=await readNearVault(state,c.reserve),entry=(current.rheaOrders??[]).find(row=>row.defi?.request.id===requestId);
    await checkedOrder(state,c,entry);
    const previous=entry.defi.checkedOutcome;
    if(previous) {
      assert(previous.state!=='conflicted' || result.state==='conflicted','This payment has a confirmed conflict. The saved result is unchanged.');
      assert(o.block.height>=previous.block.height,'An older swap update was ignored.');
      if(o.block.height===previous.block.height)assert(o.block.hash===previous.block.hash,'Conflicting swap confirmation.');
      if(previous.state==='observed')assert(result.state==='observed' && await digest(o.order)===await digest(previous.order),'The confirmed result changed. Your saved result is unchanged.');
      if(previous.order)assert(o.order,'The saved swap could not be found.');
    }
    entry.defi.checkedOutcome={state:result.state,block:o.block,order:o.order,checkedAt:Date.now()};
    if(updateId && entry.defi.executorUpdate?.id===updateId)entry.defi.checkedUpdateId=updateId;
    if(o.order)entry.status=o.order;
    await saveNearVault(state,current);
    allowed(state);
    return structuredClone(entry.defi.checkedOutcome);
  },{signal});
}
