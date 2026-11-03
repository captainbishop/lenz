import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PUBLIC_BUDGET_REHEARSAL,offlineSignerAddress,signBudgetOrder,budgetCallHash,checkBudgetPacket,budgetDigest,sealBudgetPacket,openBudgetPacket} from './public/offline-budget.js';
import {createIdentity} from './public/peer-crypto.js';
function fixture(){const secret=new Uint8Array(randomBytes(32)),domain={name:'LenzOfflineBudget',version:'1',chainId:'31337',verifyingContract:'0x'+'12'.repeat(20)},data='0x12345678',order={budgetId:'1',nonce:'0',amount:'123',minOutput:'100',fee:'1',feeRecipient:'0x'+'34'.repeat(20),deadline:'2000000000',dataHash:budgetCallHash(data),privacyPolicy:PUBLIC_BUDGET_REHEARSAL};return {secret,domain,order,data,packet:{type:'lenz/offline-budget/v1',domain,order,data,signature:signBudgetOrder(secret,domain,order)},expected:{domain,signer:offlineSignerAddress(secret),budgetId:'1',privacyPolicy:PUBLIC_BUDGET_REHEARSAL}};}
test('offline EIP712 signatures bind exact terms, deployment, budget, bytes and privacy with no provider',()=>{
 const f=fixture();assert.deepEqual(checkBudgetPacket(f.packet,f.expected,{now:1000}),f.packet);
 for(const alter of [p=>p.order.fee='2',p=>p.order.feeRecipient='0x'+'56'.repeat(20),p=>p.order.nonce='1',p=>p.order.budgetId='2',p=>p.domain.verifyingContract='0x'+'78'.repeat(20),p=>p.data='0x87654321',p=>p.order.privacyPolicy='0x'+'00'.repeat(32),p=>p.order.amount='01',p=>p.order.minOutput='0',p=>p.extra=true]){const p=structuredClone(f.packet);alter(p);assert.throws(()=>checkBudgetPacket(p,f.expected,{now:1000}));}
 assert.throws(()=>checkBudgetPacket(f.packet,f.expected,{now:2000000000}),/expired/);
 assert.throws(()=>budgetDigest({...f.domain,chainId:'1'},f.order),/Unsupported/);
});
test('private intent cannot downgrade to the public local rehearsal and input snapshots remain immutable',()=>{
 const f=fixture();assert.throws(()=>signBudgetOrder(f.secret,f.domain,{...f.order,privacyPolicy:'0x'+'ab'.repeat(32)}),/Private budget/);
 const copy=checkBudgetPacket(f.packet,f.expected,{now:1000});f.packet.order.amount='999';assert.equal(copy.order.amount,'123');
 assert.throws(()=>checkBudgetPacket(copy,{...f.expected,privacyPolicy:'0x'+'ab'.repeat(32)},{now:1000}),/privacy policy/);
});
test('encrypted offline handoff is recipient-specific and rejects a modified envelope or signer',async()=>{
 const f=fixture(),sender=await createIdentity('Sender'),executor=await createIdentity('Executor'),other=await createIdentity('Other');
 const box=await sealBudgetPacket(sender,executor.profile,f.packet,f.expected,{now:1000});
 assert(!JSON.stringify(box).includes(f.order.feeRecipient));assert.deepEqual(await openBudgetPacket(executor,sender.profile,box,f.expected,{now:1000}),f.packet);
 await assert.rejects(openBudgetPacket(other,sender.profile,box,f.expected,{now:1000}));
 const damaged=structuredClone(box);damaged.ciphertext='00'+damaged.ciphertext.slice(2);await assert.rejects(openBudgetPacket(executor,sender.profile,damaged,f.expected,{now:1000}));
 await assert.rejects(openBudgetPacket(executor,sender.profile,box,{...f.expected,signer:other.profile.id},{now:1000}));
});
