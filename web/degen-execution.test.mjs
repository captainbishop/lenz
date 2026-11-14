import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {quoteFixture,preflightFixture,account} from './degen-preflight-fixtures.mjs';
import {prepareDegenAction,validateDegenReview,degenAction,recheckDegenAction} from './public/degen-execution.js';
import {createDegenExecution} from './public/degen-execution-service.js';
import {inspectDegenAction} from './public/degen-execution-receipt.js';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const router='0x2626664c2603336e57b271c5c0b26f421741e481';
const abi=new Interface(['function approve(address,uint256) returns(bool)','function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) returns(uint256)','function multicall(uint256,bytes[]) returns(bytes[])']);
function fixture(){
 const pf=preflightFixture({quote:quoteFixture(),account,privacy:'public'}),state={address:account,chain:'0x2105',nonce:'0x7',sends:0};
 const lease={identity:{address:account,chainId:'0x2105'},assertCurrent(){},async request(method){return {eth_accounts:[state.address],eth_chainId:state.chain,eth_getTransactionCount:state.nonce,eth_gasPrice:'0x3b9aca00',eth_getBalance:'0xde0b6b3a7640000',eth_estimateGas:'0xc350'}[method];},async sendTransaction(){state.sends++;return '0x'+'aa'.repeat(32);}};
 return {pf,state,lease};
}
test('wallet review independently reconstructs exact approvals and deadline-bound swap calldata',async()=>{
 const f=fixture(),review=await prepareDegenAction(f.lease,f.pf);assert.equal(review.kind,'approve');assert.equal(review.transaction.data,abi.encodeFunctionData('approve',[router,'250000000000000000']));assert.equal(review.transaction.value,'0x0');assert.equal(review.transaction.nonce,'0x7');assert.equal(f.state.sends,0);
 const q=f.pf.request.quote,swap=degenAction({...f.pf,allowanceUnits:q.inputUnits,fees:{actions:[f.pf.fees.actions[1]],totalWei:'144000000001050'}});
 assert.equal(swap.data,abi.encodeFunctionData('multicall',[Math.floor(q.expiresAt/1000),[abi.encodeFunctionData('exactInputSingle',[[q.input.id,q.output.id,3000,account,q.inputUnits,q.minOutputUnits,0]])]]));
 for(const field of ['from','to','value','data','chainId','gas','gasPrice']){const bad=structuredClone(review);bad.transaction[field]='0x1';assert.throws(()=>validateDegenReview(bad));}
});
function journal(){let rows=[],queue=Promise.resolve();return {read:async()=>structuredClone(rows),update:op=>{const next=queue.then(async()=>{const changed=structuredClone(rows),result=await op(changed);rows=changed;return result;});queue=next.catch(()=>{});return next;}};}
test('changed fees, nonce, identity, expiry or stopped review blocks signing',async()=>{
 for(const alter of [f=>f.state.address=router,f=>f.state.chain='0x1',f=>f.state.nonce='0x8']){const f=fixture(),r=await prepareDegenAction(f.lease,f.pf);alter(f);await assert.rejects(recheckDegenAction(f.lease,r,{read:async()=>f.pf}));assert.equal(f.state.sends,0);}
 const f=fixture(),r=await prepareDegenAction(f.lease,f.pf);await assert.rejects(recheckDegenAction(f.lease,r,{read:async()=>f.pf,current:()=>false}));
});
test('durable save precedes signing and duplicate tabs cannot send the same action',async()=>{
 const f=fixture(),memory=journal(),service=createDegenExecution({...memory,preflight:async()=>f.pf}),r=await prepareDegenAction(f.lease,f.pf),send=f.lease.sendTransaction;
 f.lease.sendTransaction=async tx=>{assert.equal((await memory.read())[0].state,'awaiting_wallet');return send(tx);};
 const results=await Promise.allSettled([service.send(f.lease,r),service.send(f.lease,r)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.state.sends,1);
 const broken=createDegenExecution({read:async()=>[],update:async()=>{throw Error('storage unavailable');},preflight:async()=>f.pf});await assert.rejects(broken.send(f.lease,r),/storage/);assert.equal(f.state.sends,1);
});
test('wallet timeout stays unresolved and a late hash updates the original attempt',async()=>{
 const f=fixture(),memory=journal(),service=createDegenExecution({...memory,preflight:async()=>f.pf,timeoutMs:10});let resolve;f.lease.sendTransaction=()=>new Promise(r=>resolve=r);
 const r=await service.send(f.lease,await prepareDegenAction(f.lease,f.pf));assert.equal(r.state,'unknown');await assert.rejects(service.send(f.lease,r.review),/earlier/);resolve('0x'+'aa'.repeat(32));await new Promise(r=>setTimeout(r,15));assert.equal((await memory.read()).length,1);assert.equal((await memory.read())[0].state,'submitted');
});
async function minedFixture(){
 const f=fixture(),review=await prepareDegenAction(f.lease,f.pf),txHash='0x'+'aa'.repeat(32),blockHash='0x'+'bb'.repeat(32),word=a=>'0x'+a.slice(2).padStart(64,'0');
 const transaction={...review.transaction,hash:txHash,input:review.transaction.data,blockHash,blockNumber:'0x10',transactionIndex:'0x0'};
 const receipt={transactionHash:txHash,from:account,to:review.transaction.to,blockHash,blockNumber:'0x10',transactionIndex:'0x0',status:'0x1',gasUsed:'0xc350',effectiveGasPrice:'0x3b9aca00',l1Fee:'0x3e8',logs:[{address:review.transaction.to,topics:['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',word(account),word(router)],data:'0x'+250000000000000000n.toString(16).padStart(64,'0')}]};
 const state={transaction,receipt,finalized:false,reorg:false},read=f.lease.request;
 f.lease.request=async(method,args)=>method==='eth_getTransactionByHash'?state.transaction:method==='eth_getTransactionReceipt'?state.receipt:method==='eth_call'?'0x'+50n.toString(16).padStart(64,'0'):method==='eth_getBlockByNumber'?{hash:state.reorg?'0x'+'cc'.repeat(32):blockHash,number:args[0]==='finalized'&&!state.finalized?'0x1':'0x10',transactions:[txHash]}:read(method,args);
 return {...f,review,chain:state,txHash};
}
test('receipt binding distinguishes inclusion, finality, revert and reorg with complete actual fees',async()=>{
 const f=await minedFixture();let r=await inspectDegenAction(f.lease,f.review,f.txHash);assert.equal(r.state,'included');assert.equal(r.networkFeeWei,'50000000001050');
 f.chain.finalized=true;r=await inspectDegenAction(f.lease,f.review,f.txHash);assert.equal(r.state,'confirmed');f.chain.receipt.status='0x0';assert.equal((await inspectDegenAction(f.lease,f.review,f.txHash)).state,'failed');f.chain.reorg=true;assert.equal((await inspectDegenAction(f.lease,f.review,f.txHash)).state,'pending');
 for(const mutate of [g=>g.chain.transaction.input='0x',g=>g.chain.transaction.nonce='0x8',g=>g.chain.receipt.logs=[],g=>g.chain.receipt.l1Fee=null,g=>g.chain.receipt.gasUsed='0xffffff']){const g=await minedFixture();mutate(g);await assert.rejects(inspectDegenAction(g.lease,g.review,g.txHash));}
});
test('recovery binds a matching included hash without sending and follows approval with a fresh nonce',async()=>{
 const f=await minedFixture(),memory=journal(),service=createDegenExecution({...memory,preflight:async()=>f.pf});f.lease.sendTransaction=async()=>{throw Error('lost reply');};const sent=await service.send(f.lease,f.review);assert.equal(sent.state,'unknown');
 assert.equal((await service.reconcile(f.lease,sent.id,f.txHash)).state,'included');f.state.nonce='0x8';const next=await prepareDegenAction(f.lease,f.pf);f.lease.sendTransaction=async()=> '0x'+'dd'.repeat(32);assert.equal((await service.send(f.lease,next)).state,'submitted');
});
