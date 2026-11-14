import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AbiCoder} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {buildLendingCrosschainFundingPlan,relayLendingOrderId,checkLendingCrosschainQuote} from './public/intent-lending-crosschain.js';

const now=1794660000000;
const input={sender:'0x000000000000000000000000000000000000beef',privacyPool:'0x1111111111111111111111111111111111111111',commitment:'0x'+'12'.repeat(32),maxInputAmount:'1000000000000000',maxGasCost:'10000000000000',deadline:now+240000};

test('the deployed-pool Relay quote retains the SDK tuple calls and original note',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./intent-lending-crosschain.fixture.json',import.meta.url),'utf8'));
 const observed=Date.parse(fixture.observedAt),plan=buildLendingCrosschainFundingPlan(fixture.input,{now:observed});
 assert.deepEqual(fixture.quote.protocol.v2.orderData.output.calls,plan.request.txs.map(tx=>AbiCoder.defaultAbiCoder().encode(['tuple(address to)','tuple(bytes data)','tuple(uint256 value)'],[[tx.to],[tx.data],[tx.value]])));
 const checked=checkLendingCrosschainQuote(fixture.quote,plan,{now:observed});
 assert.equal(checked.orderId,'0xa7c2d36014d6a45c5350873b3ba4dc56c5d3886a730db633f14eceecc590259b');
 assert.equal(checked.sourceAmount,'2330390425720457');
 assert.equal(checked.destinationAmount,'1000000000000000000');
 assert.equal(checked.commitment,fixture.input.commitment);
 assert.equal(checked.executionAvailable,false);
});

test('cross-chain funding retains exact LINK, pool commitment and refund owner without enabling submission',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 assert.equal(plan.request.originChainId,84532);
 assert.equal(plan.request.destinationChainId,11155111);
 assert.equal(plan.request.destinationCurrency,'0xf8fb3713d459d7c1018bd0a49d19b4c44290ebe5');
 assert.equal(plan.request.amount,'1000000000000000000');
 assert.equal(plan.request.tradeType,'EXACT_OUTPUT');
 assert.equal(plan.request.refundTo,input.sender);
 assert.equal(plan.request.txs[0].to,plan.request.destinationCurrency);
 assert.equal(plan.request.txs[0].data,'0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000de0b6b3a7640000');
 assert.equal(plan.request.txs[1].to,input.privacyPool);
 assert.equal(plan.request.txs[1].data,'0xb214faa5'+'12'.repeat(32));
 assert.equal(plan.executionAvailable,false);
 assert.throws(()=>buildLendingCrosschainFundingPlan({...input,privacyPool:null},{now}),/privacy pool/);
 assert.throws(()=>buildLendingCrosschainFundingPlan({...input,deadline:now},{now}),/expired/);
});

// Public testnet quote returned by Relay on 2026-11-14; the address is a disposable quote-only example.
function observedOrder(){return {version:'v1',solverChainId:'base-sepolia',solver:'0x3e34b27a9bf37d8424e1a58ac7fc4d06914b76b9',salt:'0x53859eefc30f4900e8381a547dea85bae360f1b19f4e97cb5e7404c089296c84',inputs:[{payment:{chainId:'base-sepolia',currency:'0x'+'0'.repeat(40),amount:'503907176513850',weight:'1'},refunds:[{chainId:'base-sepolia',recipient:input.sender,currency:'0x'+'0'.repeat(40),minimumAmount:'0',deadline:1795264927,extraData:'0x000000000000000000000000f5042e6ffac5a625d4e7848e0b01373d8eb9e222'},{chainId:'sepolia',recipient:input.sender,currency:'0x'+'0'.repeat(40),minimumAmount:'0',deadline:1795264927,extraData:'0x'}]}],output:{chainId:'sepolia',payments:[{recipient:input.sender,currency:'0xf8fb3713d459d7c1018bd0a49d19b4c44290ebe5',minimumAmount:'1000000000000000000',expectedAmount:'1000000000000000000'}],calls:[],deadline:1795264927,extraData:'0x'},fees:[]};}

test('the funding order is cryptographically bound to the actual Relay quote, including refunds',()=>{
 const order=observedOrder();
 assert.equal(relayLendingOrderId(order),'0xc48bfba413f4f2fb423ed4c181821cd6610b3c8ee2603707011d74037af19a7e');
 order.inputs[0].refunds[0].recipient='0x2222222222222222222222222222222222222222';
 assert.notEqual(relayLendingOrderId(order),'0xc48bfba413f4f2fb423ed4c181821cd6610b3c8ee2603707011d74037af19a7e');
});

const destinationRouter='0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab';
function fundingQuote(plan){
 const order=observedOrder();
 order.output.payments[0].recipient=destinationRouter;
 order.output.calls=plan.request.txs.map(tx=>AbiCoder.defaultAbiCoder().encode(['tuple(address to)','tuple(bytes data)','tuple(uint256 value)'],[[tx.to],[tx.data],[tx.value]]));
 order.output.extraData=AbiCoder.defaultAbiCoder().encode(['address'],[destinationRouter]);
 const orderId=relayLendingOrderId(order),requestId='0x'+'34'.repeat(32);
 const tx={from:input.sender,to:'0x5feab8db4534f9f7e2669bb260c57a01ad1c12e3',data:'0x49290c1c'+input.sender.slice(2).padStart(64,'0')+orderId.slice(2),value:'503907176513850',chainId:84532,gas:'32432',maxFeePerGas:'6500000',maxPriorityFeePerGas:'1000000'};
 const currencyIn={currency:{chainId:84532,address:'0x'+'0'.repeat(40),decimals:18},amount:tx.value};
 const currencyOut={currency:{chainId:11155111,address:plan.request.destinationCurrency,decimals:18},amount:plan.request.amount,minimumAmount:plan.request.amount};
 return {requestId,steps:[{id:'deposit',kind:'transaction',items:[{data:tx,check:{method:'GET',endpoint:'/intents/status/v3?requestId='+requestId}}]}],fees:{app:{amount:'0'}},details:{sender:input.sender,recipient:input.sender,currencyIn,currencyOut,refundCurrency:structuredClone(currencyIn)},protocol:{v2:{orderId,hubType:'onchain',orderData:order,paymentDetails:{chainId:'base-sepolia',depository:tx.to,currency:currencyIn.currency.address,amount:tx.value}}}};
}

test('only the exact quoted deposit and original note funding calls form an eligible plan',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now}),quote=fundingQuote(plan);
 const checked=checkLendingCrosschainQuote(quote,plan,{now});
 assert.equal(checked.sourceAmount,'503907176513850');
 assert.equal(checked.maxGasCost,'210808000000');
 assert.equal(checked.commitment,input.commitment);
 assert.equal(checked.orderId,quote.protocol.v2.orderId);
 assert.equal(checked.executionAvailable,false);
 assert.deepEqual(checked.refunds.map(row=>row.chainId),[84532,11155111]);
 assert.equal(checked.minimumRefundAmount,'0');
 assert.deepEqual(checked.requiredChecks,['deployed-pool-and-router-code','source-wallet-and-recovery','finalized-private-deposit','finalized-lending-position']);
});

function rebind(quote){const orderId=relayLendingOrderId(quote.protocol.v2.orderData);quote.protocol.v2.orderId=orderId;quote.steps[0].items[0].data.data='0x49290c1c'+input.sender.slice(2).padStart(64,'0')+orderId.slice(2);}
test('a provider cannot replace the private note, spender or deposit call even with a consistent order hash',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 for(const change of [
  quote=>{quote.protocol.v2.orderData.output.calls=[];},
  quote=>{quote.protocol.v2.orderData.output.calls[1]=AbiCoder.defaultAbiCoder().encode(['tuple(address to)','tuple(bytes data)','tuple(uint256 value)'],[[input.privacyPool],['0xb214faa5'+'13'.repeat(32)],[0]]);},
  quote=>{quote.protocol.v2.orderData.output.calls[0]=AbiCoder.defaultAbiCoder().encode(['tuple(address to)','tuple(bytes data)','tuple(uint256 value)'],[[plan.request.destinationCurrency],['0x095ea7b3'+'22'.repeat(32)+'ff'.repeat(32)],[0]]);},
 ]){const quote=fundingQuote(plan);change(quote);rebind(quote);assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}),/funding calls/);}
});

test('destination calls reject noncanonical tuple encoding, nonzero value and router overrides',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 for(const change of [
  quote=>{quote.protocol.v2.orderData.output.calls=plan.request.txs.map(tx=>AbiCoder.defaultAbiCoder().encode(['address','bytes','uint256'],[tx.to,tx.data,tx.value]));},
  quote=>{const tx=plan.request.txs[1];quote.protocol.v2.orderData.output.calls[1]=AbiCoder.defaultAbiCoder().encode(['tuple(address to)','tuple(bytes data)','tuple(uint256 value)'],[[tx.to],[tx.data],[1]]);},
  quote=>{quote.protocol.v2.orderData.output.calls[1]+='00'.repeat(32);},
  quote=>{const call=quote.protocol.v2.orderData.output.calls[1];quote.protocol.v2.orderData.output.calls[1]=call.slice(0,194)+'40'.padStart(64,'0')+'00'.repeat(32)+call.slice(258);},
  quote=>{quote.protocol.v2.orderData.output.extraData=AbiCoder.defaultAbiCoder().encode(['address'],['0x2222222222222222222222222222222222222222']);},
  quote=>{quote.protocol.v2.orderData.output.extraData='0x'+'00'.repeat(32);},
 ]){const quote=fundingQuote(plan);change(quote);rebind(quote);assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}),/funding calls/);}
 const quote=fundingQuote(plan);quote.protocol.v2.orderData.output.extraData='0x';rebind(quote);
 assert.equal(checkLendingCrosschainQuote(quote,plan,{now}).executionAvailable,false);
});

test('wrong-chain assets and native USDC cannot be represented as funded Aave LINK',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 for(const change of [
  quote=>{quote.details.currencyOut.currency.address='0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';},
  quote=>{quote.details.currencyOut.currency.chainId=1;},
  quote=>{quote.details.currencyOut.minimumAmount='999999999999999999';},
 ]){const quote=fundingQuote(plan);change(quote);assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}),/Aave LINK/);}
});

test('refund destinations cannot change or disappear after source-wallet review',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 for(const change of [
  quote=>{quote.protocol.v2.orderData.inputs[0].refunds[0].recipient='0x2222222222222222222222222222222222222222';},
  quote=>{quote.protocol.v2.orderData.inputs[0].refunds[0].currency='0x2222222222222222222222222222222222222222';},
  quote=>{quote.protocol.v2.orderData.inputs[0].refunds.splice(0,1);},
 ]){const quote=fundingQuote(plan);change(quote);rebind(quote);assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}),/refund/);}
});

test('changing the committed order without changing calldata cannot authorize a deposit',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now}),quote=fundingQuote(plan);
 quote.protocol.v2.orderData.salt='0x'+'56'.repeat(32);
 assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}),/does not commit/);
});

test('extra transactions, authorization fields and excessive source costs are rejected before submission',()=>{
 const plan=buildLendingCrosschainFundingPlan(input,{now});
 for(const change of [
  quote=>{quote.steps.push(structuredClone(quote.steps[0]));},
  quote=>{quote.steps[0].items[0].data.authorizationList=[];},
  quote=>{quote.steps[0].items[0].data.from='0x2222222222222222222222222222222222222222';},
  quote=>{quote.steps[0].items[0].data.chainId=8453;},
  quote=>{quote.steps[0].items[0].data.value='1000000000000001';},
  quote=>{quote.steps[0].items[0].data.maxFeePerGas='1000000000000';},
  quote=>{quote.steps[0].items[0].check.endpoint='https://untrusted.example/check';},
 ]){const quote=fundingQuote(plan);change(quote);assert.throws(()=>checkLendingCrosschainQuote(quote,plan,{now}));}
 assert.throws(()=>checkLendingCrosschainQuote(fundingQuote(plan),plan,{now:input.deadline}),/expired/);
 const changed=structuredClone(plan);changed.request.refundTo='0x2222222222222222222222222222222222222222';
 assert.throws(()=>checkLendingCrosschainQuote(fundingQuote(plan),changed,{now}),/plan changed/);
});
