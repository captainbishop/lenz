import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {hexlify,keccak256} from 'ethers';
import {createAddressFromString} from '@ethereumjs/util';
import {budgetFixture} from './offline-budget-fixture.mjs';
import {signBudgetOrder,budgetDigest,budgetCallHash,offlineSignerAddress} from '../web/public/offline-budget.js';
const eth=10n**18n;
test('funded source budget executes a real signed call, measures output, caps fees and preserves the unallocated wallet',async()=>{
 const f=await budgetFixture();const wallet=await f.balance(f.actors.owner.address.toString());assert.equal((await f.fund()).result.receipt.status,1);assert.equal((await f.state()).remaining,2n*eth);
 assert((await f.balance(f.actors.owner.address.toString()))>wallet-3n*eth);const packet=await f.order();
 assert.equal((await f.read(f.budget.address,f.budget.iface,'orderDigest',[packet.order]))[0],budgetDigest(f.domain,packet.order));
 const result=await f.execute(packet);assert.equal(result.receipt.status,1,hexlify(result.execResult.returnValue));assert.equal(await f.output(),800000000000000000n);assert.equal((await f.state()).remaining,1599000000000000000n);assert.equal((await f.state()).nonce,1n);
 assert.equal((await f.read(f.budget.address,f.budget.iface,'totalRemaining'))[0],await f.balance(f.budget.address));
 const event=result.execResult.logs.map(([a,t,d])=>{try{return f.budget.iface.parseLog({topics:t.map(hexlify),data:hexlify(d)});}catch{return null;}}).find(e=>e?.name==='Executed');assert.equal(event.args.digest,budgetDigest(f.domain,packet.order));
});
test('local rehearsal cannot deploy on Ethereum or accept a private-policy label',async()=>{
 const other=await budgetFixture({chainId:1});assert.equal(other.deployed.receipt.status,0);
 const f=await budgetFixture();f.expectFail((await f.fund({...f.policy,privacyPolicy:'0x'+'11'.repeat(32)})).result,'InvalidPolicy');assert.equal(await f.balance(f.budget.address),0n);
});
test('tampered signature, calldata, fee recipient, budget and nonce cannot spend',async()=>{
 const f=await budgetFixture();await f.fund();await f.fund();const original=await f.order();
 for(const alter of [p=>p.order.feeRecipient=f.actors.attacker.address.toString(),p=>p.order.budgetId='2',p=>p.order.minOutput='700000000000000000',p=>p.signature='0x'+'00'.repeat(65),p=>p.order.nonce='1',p=>p.data=f.venue.iface.encodeFunctionData('exchange',[f.actors.attacker.address.toString()])]){const p=structuredClone(original);alter(p);f.expectFail(await f.execute(p));assert.equal((await f.state()).remaining,2n*eth);assert.equal(await f.output(),0n);}
 assert.equal((await f.execute(original)).receipt.status,1);f.expectFail(await f.execute(original),'InvalidOrder');assert.equal(await f.output(),800000000000000000n);
});
test('signed orders still cannot exceed debit, fee, price floor, expiry or selector policy',async()=>{
 const f=await budgetFixture();await f.fund();
 for(const fields of [{amount:String(eth),minOutput:String(2n*eth)},{fee:String(10n**16n+1n)},{minOutput:'1'},{deadline:String(f.now+3601)},{deadline:String(f.now)}])f.expectFail(await f.execute(await f.order(1n,fields)),'InvalidOrder');
 const p=await f.order();p.data=f.venue.iface.encodeFunctionData('claim',[f.policy.beneficiary]);p.order.dataHash=budgetCallHash(p.data);p.signature=signBudgetOrder(f.secret,f.domain,p.order);f.expectFail(await f.execute(p),'InvalidOrder');
 f.setTime(f.now+3600);f.expectFail(await f.execute(await f.order()),'Unavailable');
});
test('venue failure, insufficient result and failed fee delivery roll back all effects and permit only the same unspent nonce',async()=>{
 const f=await budgetFixture();await f.fund();const p=await f.order();
 for(const [rate,fail,error]of [[2,true,'ExecutionFailed'],[1,false,'InsufficientOutput']]){await f.send('owner',f.venue.address,f.venue.iface.encodeFunctionData('configure',[rate,fail]));f.expectFail(await f.execute(p),error);assert.equal((await f.state()).nonce,0n);assert.equal((await f.state()).remaining,2n*eth);assert.equal(await f.output(),0n);assert.equal(await f.balance(f.venue.address),0n);}
 await f.send('owner',f.venue.address,f.venue.iface.encodeFunctionData('configure',[2,false]));f.expectFail(await f.execute(await f.order(1n,{feeRecipient:f.rejector.address})),'TransferFailed');
 assert.equal((await f.execute(p)).receipt.status,1);assert.equal((await f.state()).nonce,1n);
});
test('changed code and callback reentry cannot spend; owner can revoke and recover the exact remainder',async()=>{
 const f=await budgetFixture();await f.fund();const p=await f.order();
 await f.send('owner',f.venue.address,f.venue.iface.encodeFunctionData('attack',[f.budget.address,f.budget.iface.encodeFunctionData('execute',[p.order,p.data,p.signature])]));
 assert.equal((await f.execute(p)).receipt.status,1);assert.equal((await f.read(f.venue.address,f.venue.iface,'reentered'))[0],false);
 f.expectFail(await f.send('attacker',f.budget.address,f.budget.iface.encodeFunctionData('withdraw',[1])),'Unauthorized');
 const next=await f.order(1n,{nonce:'1'});await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('revoke',[1]));f.expectFail(await f.execute(next),'Unavailable');
 const remainder=(await f.state()).remaining;assert.equal(remainder,1599000000000000000n);const before=await f.balance(f.actors.owner.address.toString()),refund=await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('withdraw',[1]));assert.equal(refund.receipt.status,1);assert.equal(await f.balance(f.actors.owner.address.toString()),before+remainder-refund.totalGasSpent*1000000000n);assert.equal(await f.balance(f.budget.address),0n);assert.equal((await f.state()).remaining,0n);
 await f.fund();const code=await f.vm.stateManager.getCode(createAddressFromString(f.venue.address));await f.vm.stateManager.putCode(createAddressFromString(f.venue.address),new Uint8Array([0x00]));f.expectFail(await f.execute(await f.order(2n)),'RouteChanged');await f.vm.stateManager.putCode(createAddressFromString(f.venue.address),code);
});
test('different budgets must not share downstream venue authority',async()=>{
 const f=await budgetFixture();await f.fund();assert.equal((await f.execute(await f.order())).receipt.status,1);
 const stolen=400000000000000000n,attacker=f.actors.attacker.address.toString();
 const attackerSecret=new Uint8Array(randomBytes(32));
 const policy={...f.policy,signer:offlineSignerAddress(attackerSecret),beneficiary:attacker,selector:f.venue.iface.getFunction('claim').selector};await f.fund(policy,eth,'attacker');
 const p=await f.order(2n,{amount:'1',minOutput:String(stolen),fee:'0'});p.data=f.venue.iface.encodeFunctionData('claim',[attacker]);p.order.dataHash=budgetCallHash(p.data);p.signature=signBudgetOrder(attackerSecret,f.domain,p.order);
 f.expectFail(await f.execute(p),'InsufficientOutput');assert.equal(await f.output(attacker),0n);
 assert.notEqual((await f.state(1n)).executor,(await f.state(2n)).executor);
 const claim=f.venue.iface.encodeFunctionData('claim',[f.policy.beneficiary]),recover=f.budget.iface.encodeFunctionData('recoverPosition',[1,f.venue.address,claim]);
 f.expectFail(await f.send('attacker',f.budget.address,recover),'Unauthorized');
 assert.equal((await f.send('owner',f.budget.address,recover)).receipt.status,1);assert.equal(await f.output(),1200000000000000000n);assert.equal((await f.state()).revoked,true);
 assert.equal((await f.state()).remaining,1599000000000000000n);
});
test('native output excludes the fee and execution helper rejects direct callers',async()=>{
 const f=await budgetFixture(),policy={...f.policy,target:f.native.address,targetCodeHash:await f.codeHash(f.native.address),selector:f.native.iface.getFunction('exchange').selector,outputToken:'0x'+'00'.repeat(20),outputCodeHash:'0x'+'00'.repeat(32),minOutputPerEth:eth};await f.fund(policy);
 const p=await f.order(1n,{amount:'100',minOutput:'100',fee:'1',feeRecipient:policy.beneficiary});
 p.data=f.native.iface.encodeFunctionData('exchange',[policy.beneficiary,99]);p.order.dataHash=budgetCallHash(p.data);p.signature=signBudgetOrder(f.secret,f.domain,p.order);f.expectFail(await f.execute(p),'InsufficientOutput');
 p.data=f.native.iface.encodeFunctionData('exchange',[policy.beneficiary,100]);p.order.dataHash=budgetCallHash(p.data);p.signature=signBudgetOrder(f.secret,f.domain,p.order);assert.equal((await f.execute(p)).receipt.status,1);
 const executor=(await f.state()).executor;const {Interface}=await import('ethers'),iface=new Interface(['function run(address target,bytes data)']);
 assert.equal((await f.send('attacker',executor,iface.encodeFunctionData('run',[f.native.address,p.data]),100n)).receipt.status,0);
 const before=await f.balance(f.actors.owner.address.toString());await f.send('attacker',executor,'0x',123n);
 const sweep=await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('recoverPosition',[1,f.native.address,'0x']));assert.equal(sweep.receipt.status,1);assert.equal(await f.balance(executor),0n);assert.equal(await f.balance(f.actors.owner.address.toString()),before+123n-sweep.totalGasSpent*1000000000n);
});
test('invalid funding preserves IDs and liabilities; smallest price floor rounds upward',async()=>{
 const f=await budgetFixture();
 for(const [changes,value]of [[{},0n],[{signer:'0x'+'00'.repeat(20)},eth],[{target:f.budget.address},eth],[{targetCodeHash:'0x'+'00'.repeat(32)},eth],[{beneficiary:f.budget.address},eth],[{maxDebit:0},eth],[{maxFee:2n*eth},eth],[{expiresAt:f.now},eth]])f.expectFail((await f.fund({...f.policy,...changes},value)).result,'InvalidPolicy');
 assert.equal((await f.read(f.budget.address,f.budget.iface,'nextBudgetId'))[0],1n);assert.equal((await f.read(f.budget.address,f.budget.iface,'totalRemaining'))[0],0n);
 await f.fund({...f.policy,minOutputPerEth:eth+1n});f.expectFail(await f.execute(await f.order(1n,{amount:'1',minOutput:'1',fee:'0'})),'InvalidOrder');assert.equal((await f.execute(await f.order(1n,{amount:'1',minOutput:'2',fee:'0'}))).receipt.status,1);
});
test('a rejecting owner retains its full refund liability and can independently revoke',async()=>{
 const f=await budgetFixture(),owner=f.rejectingOwner,forward=(data,value=0n)=>f.send('owner',owner.address,owner.iface.encodeFunctionData('forward',[f.budget.address,data]),value);
 assert.equal((await forward(f.budget.iface.encodeFunctionData('fund',[f.policy]),eth)).receipt.status,1);assert.equal((await f.state()).owner.toLowerCase(),owner.address);
 assert.equal((await forward(f.budget.iface.encodeFunctionData('withdraw',[1]))).receipt.status,0);assert.equal((await f.state()).remaining,eth);assert.equal(await f.balance(f.budget.address),eth);
 assert.equal((await forward(f.budget.iface.encodeFunctionData('revoke',[1]))).receipt.status,1);assert.equal((await f.state()).revoked,true);f.expectFail(await f.execute(await f.order()),'Unavailable');
});
test('cross-deployment replay and noncanonical signatures cannot debit either budget',async()=>{
 const f=await budgetFixture();await f.fund();const p=await f.order();
 const deployment=await f.send('owner',null,'0x'+f.compiled.evm.bytecode.object),other=deployment.createdAddress.toString();assert.equal((await f.send('owner',other,f.budget.iface.encodeFunctionData('fund',[f.policy]),2n*eth)).receipt.status,1);
 f.expectFail(await f.send('relayer',other,f.budget.iface.encodeFunctionData('execute',[p.order,p.data,p.signature])),'InvalidSignature');
 const n=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,s=BigInt('0x'+p.signature.slice(66,130)),high='0x'+p.signature.slice(2,66)+(n-s).toString(16).padStart(64,'0')+(p.signature.endsWith('1b')?'1c':'1b');
 for(const signature of [p.signature.slice(0,-2),p.signature.slice(0,-2)+'00',high])f.expectFail(await f.execute({...p,signature}),'InvalidSignature');assert.equal((await f.state()).nonce,0n);assert.equal((await f.state()).remaining,2n*eth);
});
test('mixed multi-budget operations conserve each remainder and the manager aggregate',async()=>{
 const f=await budgetFixture();await f.fund();await f.fund();await f.fund();
 const invariant=async()=>{const sum=(await f.state(1n)).remaining+(await f.state(2n)).remaining+(await f.state(3n)).remaining;assert.equal((await f.read(f.budget.address,f.budget.iface,'totalRemaining'))[0],sum);assert.equal(await f.balance(f.budget.address),sum);};await invariant();
 assert.equal((await f.execute(await f.order(2n))).receipt.status,1);await invariant();f.expectFail(await f.execute(await f.order(2n)),'InvalidOrder');await invariant();
 await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('withdraw',[1]));await invariant();
 await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('recoverPosition',[2,f.venue.address,f.venue.iface.encodeFunctionData('claim',[f.policy.beneficiary])]));await invariant();
 assert.equal((await f.execute(await f.order(3n))).receipt.status,1);await invariant();
});
