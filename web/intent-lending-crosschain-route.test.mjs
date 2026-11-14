import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Wallet,Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {buildLendingCrosschainFundingPlan,relayLendingOrderId} from './public/intent-lending-crosschain.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {LENDING_CROSSCHAIN_PINS,createLendingCrosschainFundingService,checkLendingCrosschainReview} from './public/intent-lending-crosschain-route.js';
const pins=LENDING_CROSSCHAIN_PINS,fixture=JSON.parse(readFileSync(new URL('./intent-lending-crosschain.fixture.json',import.meta.url),'utf8'));
const fixed=Date.parse(fixture.observedAt),wallet=new Wallet('0x'+'21'.repeat(32)),sender=wallet.address.toLowerCase(),word=value=>BigInt(value).toString(16).padStart(64,'0');
const config={...LENDING_TESTNET,lendingFactory:'0x1111111111111111111111111111111111111111',privacyPool:fixture.input.privacyPool};
const abi=new Interface(['event RelayNativeDeposit(address from,uint256 amount,bytes32 id)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const block=(number,finality='finalized')=>({number:String(number),hash:'0x'+word(number),timestamp:String(Math.floor(fixed/1000)),finality,requireCanonical:true});
function setup(){
 let clock=fixed,state={draft:null,review:null,attempts:[]},sendCount=0,recoveryCount=0,sendBehavior=null,nonce='0x5',stored=true;
 const plan=buildLendingCrosschainFundingPlan({...fixture.input,sender},{now:clock}),quote=structuredClone(fixture.quote);
 quote.details.sender=quote.details.recipient=sender;quote.steps[0].items[0].data.from=sender;for(const refund of quote.protocol.v2.orderData.inputs[0].refunds)refund.recipient=sender;
 const orderId=relayLendingOrderId(quote.protocol.v2.orderData);quote.protocol.v2.orderId=orderId;quote.steps[0].items[0].data.data='0x49290c1c'+word(sender)+orderId.slice(2);
 const input={owner:'ab'.repeat(32),ownerAddress:'0x2222222222222222222222222222222222222222',account:'0x3333333333333333333333333333333333333333',plan,quote};
 const destination={chainId:config.chain,routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},observedAt:clock,block:block(14),account:{status:'verified',address:input.account,owner:input.ownerAddress,route:{factory:config.lendingFactory}},privatePool:{address:config.privacyPool,commitments:[],deposits:[]},crosschain:{router:pins.destinationRouter,routerCodeHash:pins.destinationRouterCodeHash,allowance:'0',commitmentExists:false}};
 const preflight={observedAt:clock,source:{chainId:84532,sender,nonce:'5',balance:'1000000000000000000',gasEstimate:'30000',depositoryCodeHash:pins.depositoryCodeHash,routerCodeHash:pins.sourceRouterCodeHash,senderCode:'0x',simulated:true,block:block(12,'latest')},destination};
 const observation={observedAt:clock,source:{chainId:84532,depositoryCodeHash:pins.depositoryCodeHash,block:block(12),transaction:null,receipt:null,receiptBlock:null},destination:structuredClone(destination),destinationReceipt:null,destinationReceiptBlock:null};
 const store={async read(){return structuredClone(state);},async update(_owner,fn){const draft=structuredClone(state);await fn(draft);if(stored)state=draft;return structuredClone(draft);}};
 const lease={identity:{chainId:pins.sourceChainHex,address:sender},assertCurrent(){},async request(method){return method==='eth_accounts'?[sender]:method==='eth_chainId'?pins.sourceChainHex:nonce;},async sendTransaction(transaction){sendCount++;assert.equal(state.attempts[0].status,'approval-unresolved');assert.equal(recoveryCount,1);if(sendBehavior)return sendBehavior(transaction);return sign(transaction);}};
 async function sign(transaction){const raw=await wallet.signTransaction({...transaction,gasLimit:transaction.gas,nonce:Number(BigInt(transaction.nonce)),type:2});const hash=(await import('../aurora/node_modules/ethers/lib.esm/index.js')).keccak256(raw);observation.source.transaction={raw,hash};return hash;}
 const service=createLendingCrosschainFundingService({source:{capture:()=>lease},store,reader:{async preflight(){return structuredClone(preflight);},async observe(){return structuredClone(observation);}},requireRecovery:async()=>{recoveryCount++;},config,now:()=>clock,timeoutMs:20});
 function event(name,args,address,transactionHash,number,index){const encoded=abi.encodeEventLog(name,args);return{address,...encoded,transactionHash,blockHash:block(number).hash,blockNumber:'0x'+number.toString(16),logIndex:'0x'+index.toString(16),removed:false};}
 function settle(review){const transactionHash=observation.source.transaction.hash;observation.source.receipt={transactionHash,from:sender,to:pins.depository,status:'0x1',blockNumber:'0xa',blockHash:block(10).hash,logs:[event('RelayNativeDeposit',[sender,review.source.amount,orderId],pins.depository,transactionHash,10,0)]};observation.source.receiptBlock={number:'0xa',hash:block(10).hash};
  const destinationHash='0x'+'44'.repeat(32),deposit={commitment:plan.commitment,index:0,transactionHash:destinationHash,blockNumber:'11',blockHash:block(11).hash,logIndex:'1'};
  observation.destination.privatePool.commitments=[plan.commitment];observation.destination.privatePool.deposits=[deposit];observation.destination.crosschain.commitmentExists=true;
  observation.destinationReceipt={transactionHash:destinationHash,status:'0x1',blockNumber:'0xb',blockHash:block(11).hash,logs:[event('Transfer',[pins.destinationRouter,config.privacyPool,config.denomination],config.link,destinationHash,11,0),event('Deposit',[plan.commitment,0,Math.floor(clock/1000)],config.privacyPool,destinationHash,11,1)]};observation.destinationReceiptBlock={number:'0xb',hash:block(11).hash};
 }
 return{service,input,preflight,observation,lease,store,sign,settle,setSend:fn=>sendBehavior=fn,setNonce:value=>nonce=value,setStored:value=>stored=value,setNow:value=>clock=value,get sends(){return sendCount;},get state(){return state;}};
}

test('an original wallet payment funds only its finalized exact private note after durable recovery',async()=>{
 const f=setup(),review=await f.service.prepare(f.input);assert.equal(review.transaction.nonce,'0x5');assert.equal(review.destination.minAmount,'1000000000000000000');
 const pending=await f.service.submit(review);assert.equal(pending.status,'pending');assert.equal(pending.verified,false);assert.equal(f.sends,1);
 f.settle(review);const funded=await f.service.reconcile(review);assert.equal(funded.status,'funded');assert.equal(funded.evidence.destination.commitment,f.input.plan.commitment);assert.equal(funded.evidence.source.orderId,review.quote.protocol.v2.orderId);
 await f.service.submit(review);assert.equal(f.sends,1);
});
test('lost or delayed wallet replies never create another payment and a late original hash is retained',async()=>{
 const f=setup(),review=await f.service.prepare(f.input);let release;f.setSend(()=>new Promise(resolve=>release=resolve));
 assert.equal((await f.service.submit(review)).status,'unknown');assert.equal(f.sends,1);assert.equal((await f.service.submit(review)).status,'unknown');assert.equal(f.sends,1);
 const originalHash=await f.sign(review.transaction);release(originalHash);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.state.attempts[0].authorization.transactionHash,originalHash);
});
test('an unobserved or mismatched pasted source hash cannot bind an unknown wallet attempt',async()=>{
 const f=setup(),review=await f.service.prepare(f.input);f.setSend(()=>{throw Error('lost reply');});await f.service.submit(review);
 const fake='0x'+'55'.repeat(32);assert.equal((await f.service.reconcile(review,{transactionHash:fake})).status,'unknown');assert.equal(f.state.attempts[0].authorization,null);
 await f.sign({...review.transaction,value:'0x1'});await assert.rejects(f.service.reconcile(review),/another transaction/);assert.equal(f.state.attempts[0].authorization,null);
 await f.sign(review.transaction);const original=f.observation.source.transaction.hash;await f.service.reconcile(review,{transactionHash:original});assert.equal(f.state.attempts[0].authorization.transactionHash,original);assert.equal(f.sends,1);
});
test('changed source nonce, failed persistence, existing note and foreign account stop before wallet dispatch',async()=>{
 for(const change of [f=>f.setNonce('0x6'),f=>f.setStored(false),f=>{f.preflight.destination.crosschain.commitmentExists=true;f.preflight.destination.privatePool.commitments=[f.input.plan.commitment];f.preflight.destination.privatePool.deposits=[{commitment:f.input.plan.commitment}];},f=>{f.preflight.destination.account.owner='0x'+'77'.repeat(20);}]){
  const f=setup(),review=await f.service.prepare(f.input);change(f);try{await f.service.submit(review);}catch{}assert.equal(f.sends,0);
 }
});
test('altered review terms, raw source authority and deposit evidence never become funded',async()=>{
 const changed=setup(),review=await changed.service.prepare(changed.input);const bad=structuredClone(review);bad.transaction.value='0x1';assert.throws(()=>checkLendingCrosschainReview(bad,{config,now:fixed}),/transaction changed/);
 for(const change of [f=>{f.observation.source.receipt.logs[0].data='0x'+'00'.repeat(96);},f=>{f.observation.source.receiptBlock.hash='0x'+'88'.repeat(32);},f=>{f.observation.destinationReceipt.logs.shift();},f=>{f.observation.destinationReceiptBlock.hash='0x'+'88'.repeat(32);},f=>{f.observation.destination.crosschain.allowance='1';}]){
  const f=setup(),original=await f.service.prepare(f.input);await f.service.submit(original);f.settle(original);change(f);await assert.rejects(f.service.reconcile(original));assert.notEqual(f.state.attempts[0].outcome?.status,'funded');
 }
});
test('source or destination inclusion before finality remains pending and source failure does not claim funding',async()=>{
 const f=setup(),review=await f.service.prepare(f.input);await f.service.submit(review);f.settle(review);f.observation.source.block=block(9);assert.equal((await f.service.reconcile(review)).status,'pending');
 f.observation.source.block=block(12);f.observation.source.receipt.status='0x0';f.observation.source.receipt.logs=[];const failed=await f.service.reconcile(review);assert.equal(failed.status,'failed');assert.equal(failed.verified,true);assert.equal(f.sends,1);
});
