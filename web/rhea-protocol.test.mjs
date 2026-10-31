import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity } from './public/peer-crypto.js';
import { emptyNearVault, fundingRequest, nearLedger, makeNearPayment, saveNearVault, readNearVault } from './public/near-protocol.js';
import { prepareRheaSwap, checkRheaPacket, checkRheaInstruction } from './public/rhea-protocol.js';
const c={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function fixture(){const identity=await createIdentity('Test');const vault=emptyNearVault(c.reserve);const f=await fundingRequest(identity,c.reserve,'10');vault.roots.push({id:f.id,owner:f.owner,amount:f.amount});return {identity,vault};}
const terms={text:'1',minOutput:'100',receiver:'alice.testnet',deadlineMs:10000};
test('split, signed ancestry and encrypted reservation preserve change and identity',async()=>{
  const {identity,vault}=await fixture();const r=await prepareRheaSwap(vault,identity,c,terms,1);
  assert.equal(await checkRheaPacket(c,r.packet),r.packet.id);assert.equal(r.packet.path.length,1);
  assert.equal((await nearLedger(r.vault)).available[0].amount,'9000000');assert.equal(vault.spends.length,0);
  const state={identity};await saveNearVault(state,r.vault);assert(!state.nearBox.ciphertext.includes(r.packet.instruction.signature));
  const loaded=await readNearVault(structuredClone(state),c.reserve);assert.deepEqual(loaded.rheaOrders,r.vault.rheaOrders);
  await assert.rejects(makeNearPayment(loaded,identity,identity.profile,'10'),/No single available/);
  assert.equal((await nearLedger(loaded)).reserved.size,1);
});
test('exact note is fully reserved, including after deadline or a rejected status',async()=>{
  const {identity,vault}=await fixture();const r=await prepareRheaSwap(vault,identity,c,{...terms,text:'10'},1);
  r.vault.rheaOrders[0].status={stage:'rejected'};assert.equal((await nearLedger(r.vault)).available.length,0);
  await assert.rejects(prepareRheaSwap(r.vault,identity,c,terms,1),/No single available/);
});
test('altered terms, wrong adapter and bad ancestry are rejected',async()=>{
  const {identity,vault}=await fixture();const {packet}=await prepareRheaSwap(vault,identity,c,terms,1);
  for(const change of [p=>p.instruction.receiver_id='bob.testnet',p=>p.instruction.min_output='1',p=>p.instruction.deadline_ms='20000',p=>p.instruction.amount='2',p=>p.instruction.nonce='0'.repeat(32),p=>p.instruction.redemption_signature='0'.repeat(128),p=>p.path=[],p=>p.id='0'.repeat(64),p=>p.config.adapter='other.testnet']){
    const p=structuredClone(packet);change(p);await assert.rejects(checkRheaPacket(c,p));
  }
  await assert.rejects(checkRheaInstruction({...c,poolId:1},packet.instruction),/signature rejected/);
});
test('legacy vault remains usable and invalid signing options leave it unchanged',async()=>{
  const {identity,vault}=await fixture();const before=structuredClone(vault);
  for(const change of [{receiver:c.adapter},{receiver:'alice.near'},{minOutput:'0'},{deadlineMs:1},{deadlineMs:86400002}]) await assert.rejects(prepareRheaSwap(vault,identity,c,{...terms,...change},1));
  assert.deepEqual(vault,before);assert.equal((await nearLedger(vault)).available[0].amount,'10000000');
});
