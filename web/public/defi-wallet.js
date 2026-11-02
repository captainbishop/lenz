import { updateState } from './chat-store.js';
import { assert, digest, keysAre, validateProfile, openMessage } from './peer-crypto.js';
import { readNearVault, saveNearVault, nearLedger, units } from './near-protocol.js';
import { prepareRheaSwap, checkRheaConfig } from './rhea-protocol.js';
import { createDefiRequest, checkDefiRequest, sealDefiRequest, openDefiReceipt, PUBLIC_TESTNET_DISCLOSURE } from './defi-request.js';

// Browser service only. Every outward result follows the shared IndexedDB commit.
// No transport callback, chain call, wallet credit or reservation release lives here.
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

export async function defiHandoff(config,requestId) {
  const c=configured(config);
  return updateState(async state=>{
    const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
    const request=await checkedOrder(state,c,order),ledger=await nearLedger(vault),input=order.packet.instruction.input;
    assert(!ledger.consumed.has(input) && !ledger.blocked.has(input), 'Reserved input has a known conflict');
    assert(!['complete','refunded'].includes(order.status?.stage), 'This swap is already resolved');
    await checkDefiRequest(c,state.identity.profile,order.defi.executor,request,Date.now());
    assert(Date.now()<request.expiresAt, 'Approval expired before handoff');
    return structuredClone(order.defi.packet);
  });
}

export async function recordDefiStorageReceipt(config,requestId,packet) {
  const c=configured(config),incoming=structuredClone(packet);
  return updateState(async state=>{
    const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
    const request=await checkedOrder(state,c,order);
    const receipt=await openDefiReceipt(state.identity,order.defi.executor,incoming,request);
    assert(receipt.storedAt<=Date.now()+60000, 'Storage receipt is in the future');
    if(!order.defi.storageReceipt) {
      order.defi.storageReceipt=receipt;
      await saveNearVault(state,vault);
    }
    return {requestId:request.id,state:'stored'};
  });
}
