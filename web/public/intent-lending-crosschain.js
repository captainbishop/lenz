import {LENDING_TESTNET} from './intent-lending-config.js';
import {TypedDataEncoder} from './evm-vendor/offline-budget.js';

const native='0x0000000000000000000000000000000000000000';
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const address=(value)=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&value!==native;
const amount=(value)=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)&&BigInt(value)<2n**256n;
const word=(value)=>BigInt(value).toString(16).padStart(64,'0');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const equalAddress=(left,right)=>typeof left==='string'&&left.toLowerCase()===right;
const sourceDepository='0x5feab8db4534f9f7e2669bb260c57a01ad1c12e3';
const sourceRouter='0xf5042e6ffac5a625d4e7848e0b01373d8eb9e222';
const destinationRouter='0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab';
const solver='0x3e34b27a9bf37d8424e1a58ac7fc4d06914b76b9';
const currency=(value,chainId,token)=>value?.chainId===chainId&&equalAddress(value.address,token)&&value.decimals===18;
// Each SDK argument is a tuple; the bytes tuple needs its own offset.
function encodeCall(tx){const data=tx.data.slice(2);return '0x'+word(tx.to)+word(96)+word(tx.value)+word(32)+word(data.length/2)+data.padEnd(Math.ceil(data.length/64)*64,'0');}

// Relay settlement SDK b2f3e0e5fba9381293f030ef340ffb4872687fcf: EVM v1 order fields use 20-byte addresses.
const fields=(value)=>value.split(' ').map(pair=>{const [name,type]=pair.split(':');return {name,type};});
const orderTypes={
 Order:fields('version:string solverChainId:string solver:address salt:uint256 inputs:Input[] output:Output fees:Fee[]'),
 Input:fields('payment:InputPayment refunds:InputRefund[]'),
 InputPayment:fields('chainId:string currency:bytes amount:uint256 weight:uint256'),
 InputRefund:fields('chainId:string recipient:bytes currency:bytes minimumAmount:uint256 deadline:uint32 extraData:bytes'),
 Output:fields('chainId:string payments:OutputPayment[] deadline:uint32 calls:bytes[] extraData:bytes'),
 OutputPayment:fields('recipient:bytes currency:bytes minimumAmount:uint256 expectedAmount:uint256'),
 Fee:fields('recipientChainId:string recipient:bytes currencyChainId:string currency:bytes amount:uint256'),
};
export function relayLendingOrderId(order){return TypedDataEncoder.hashStruct('Order',orderTypes,order);}

// This prepares a quote. It does not establish pool deployment, spending authority or settlement.
export function buildLendingCrosschainFundingPlan(input,{now=Date.now()}={}){
 check(address(input?.sender),'Choose the original source wallet.');
 check(address(input.privacyPool),'Verify the destination privacy pool before requesting funding.');
 check(/^0x[0-9a-f]{64}$/.test(input.commitment)&&BigInt(input.commitment)>0n&&BigInt(input.commitment)<field,'Retain the original private note commitment.');
 check(amount(input.maxInputAmount)&&amount(input.maxGasCost),'Review the source amount and gas limits.');
 check(Number.isSafeInteger(input.deadline)&&input.deadline>now&&input.deadline<=now+300000,'The cross-chain funding review expired.');
 const request={user:input.sender,recipient:input.sender,refundTo:input.sender,refundOnOrigin:true,originChainId:84532,destinationChainId:LENDING_TESTNET.chainId,originCurrency:native,destinationCurrency:LENDING_TESTNET.link,amount:LENDING_TESTNET.denomination,tradeType:'EXACT_OUTPUT',txs:[
  {to:LENDING_TESTNET.link,value:'0',data:'0x095ea7b3'+word(input.privacyPool)+word(LENDING_TESTNET.denomination)},
  {to:input.privacyPool,value:'0',data:'0xb214faa5'+input.commitment.slice(2)},
 ]};
 return {type:'LendingCrosschainFundingPlan',executionAvailable:false,sender:input.sender,privacyPool:input.privacyPool,commitment:input.commitment,maxInputAmount:input.maxInputAmount,maxGasCost:input.maxGasCost,deadline:input.deadline,request};
}

export function checkLendingCrosschainQuote(quote,plan,{now=Date.now()}={}){
 check(same(plan,buildLendingCrosschainFundingPlan(plan,{now})),'The original cross-chain funding plan changed.');
 check(JSON.stringify(quote).length<=65536,'The cross-chain quote is too large.');
 check(/^0x[0-9a-f]{64}$/.test(quote.requestId),'The provider request is invalid.');
 const protocol=quote.protocol?.v2,order=protocol?.orderData,details=quote.details;
 check(protocol?.hubType==='onchain'&&order?.version==='v1'&&order.solverChainId==='base-sepolia'&&equalAddress(order.solver,solver),'The testnet provider route changed.');
 check(Array.isArray(quote.steps)&&quote.steps.length===1&&quote.steps[0].id==='deposit'&&quote.steps[0].kind==='transaction'&&quote.steps[0].items?.length===1,'Unexpected funding transactions.');
 const item=quote.steps[0].items[0],tx=item.data;
 check(tx&&Object.keys(tx).sort().join()===['from','to','data','value','chainId','gas','maxFeePerGas','maxPriorityFeePerGas'].sort().join(),'Unexpected source transaction fields.');
 check(tx.chainId===84532&&equalAddress(tx.from,plan.sender)&&equalAddress(tx.to,sourceDepository),'The source wallet or depository changed.');
 check(amount(tx.value)&&BigInt(tx.value)<=BigInt(plan.maxInputAmount),'The source amount exceeds the review.');
 check(amount(tx.gas)&&amount(tx.maxFeePerGas)&&amount(tx.maxPriorityFeePerGas)&&BigInt(tx.maxPriorityFeePerGas)<=BigInt(tx.maxFeePerGas),'The source gas terms are invalid.');
 const gasCost=BigInt(tx.gas)*BigInt(tx.maxFeePerGas);
 check(gasCost<=BigInt(plan.maxGasCost),'The source gas exceeds the review.');
 check(item.check?.method==='GET'&&item.check.endpoint==='/intents/status/v3?requestId='+quote.requestId,'The provider status request changed.');
 check(equalAddress(details?.sender,plan.sender)&&equalAddress(details?.recipient,plan.sender),'The funding recipient changed.');
 check(currency(details.currencyIn?.currency,84532,native)&&details.currencyIn.amount===tx.value,'The source asset or amount changed.');
 check(currency(details.currencyOut?.currency,11155111,LENDING_TESTNET.link)&&details.currencyOut.amount===LENDING_TESTNET.denomination&&details.currencyOut.minimumAmount===LENDING_TESTNET.denomination,'The exact Aave LINK output changed.');
 check(currency(details.refundCurrency?.currency,84532,native)&&details.refundCurrency.amount===tx.value,'The source refund asset changed.');
 check(quote.fees?.app?.amount==='0'&&Array.isArray(order.fees)&&order.fees.length===0,'Unexpected funding fees.');
 check(Array.isArray(order.inputs)&&order.inputs.length===1,'Unexpected funding inputs.');
 const source=order.inputs[0],payment=source.payment,output=order.output;
 check(payment?.chainId==='base-sepolia'&&equalAddress(payment.currency,native)&&payment.amount===tx.value&&payment.weight==='1','The committed source payment changed.');
 check(same(protocol.paymentDetails,{chainId:'base-sepolia',depository:tx.to,currency:native,amount:tx.value}),'The depository payment changed.');
 check(output?.chainId==='sepolia'&&Number.isSafeInteger(output.deadline)&&output.deadline>Math.floor(now/1000)&&output.deadline<=Math.ceil(now/1000)+604800+300,'The provider execution deadline is invalid.');
 check(Array.isArray(output.payments)&&output.payments.length===1,'Unexpected destination payments.');
 const received=output.payments[0];
 check(equalAddress(received.recipient,destinationRouter)&&equalAddress(received.currency,LENDING_TESTNET.link)&&received.minimumAmount===LENDING_TESTNET.denomination&&received.expectedAmount===LENDING_TESTNET.denomination,'The committed LINK output changed.');
 check(same(output.calls,plan.request.txs.map(encodeCall))&&['0x','0x'+word(destinationRouter)].includes(output.extraData),'The private-pool funding calls changed.');
 check(Array.isArray(source.refunds)&&source.refunds.length>=1&&source.refunds.length<=2&&new Set(source.refunds.map(row=>row.chainId)).size===source.refunds.length,'The refund options changed.');
 check(source.refunds.some(row=>row.chainId==='base-sepolia'),'The source refund route is missing.');
 for(const refund of source.refunds){
  check(['base-sepolia','sepolia'].includes(refund.chainId)&&equalAddress(refund.recipient,plan.sender)&&equalAddress(refund.currency,native)&&refund.minimumAmount==='0'&&refund.deadline===output.deadline,'The refund owner, currency or deadline changed.');
  check(refund.chainId==='base-sepolia'?refund.extraData==='0x'+word(sourceRouter):['0x','0x'+word(destinationRouter)].includes(refund.extraData),'The refund router changed.');
 }
 const orderId=relayLendingOrderId(order);
 check(orderId===protocol.orderId&&tx.data==='0x49290c1c'+word(plan.sender)+orderId.slice(2),'The source deposit does not commit to the reviewed order.');
 return {type:'LendingCrosschainQuote',executionAvailable:false,requestId:quote.requestId,orderId,sourceAmount:tx.value,maxGasCost:gasCost.toString(),destinationAmount:LENDING_TESTNET.denomination,privacyPool:plan.privacyPool,commitment:plan.commitment,providerDeadline:output.deadline,minimumRefundAmount:'0',refunds:source.refunds.map(row=>({chainId:row.chainId==='base-sepolia'?84532:11155111,recipient:plan.sender,currency:native,deadline:row.deadline})),requiredChecks:['deployed-pool-and-router-code','source-wallet-and-recovery','finalized-private-deposit','finalized-lending-position']};
}
