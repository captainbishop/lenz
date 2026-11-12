import {verifyQuoteSignature} from './intents-vendor/quote.js';
import {getAddress} from './evm-vendor/address.js';
import {INTENTS_STATUSES} from './intents-status.js';

const assert=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const quantity=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v)&&BigInt(v)<2n**128n;
const time=v=>typeof v==='string'&&Number.isSafeInteger(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
function providerTime(value){
 const parts=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
 if(!parts)return false;
 const local=parts[1].toUpperCase()+'.'+(parts[2]??'').slice(0,3).padEnd(3,'0')+'Z',calendar=Date.parse(local);
 return Number.isSafeInteger(calendar)&&new Date(calendar).toISOString()===local&&Number.isSafeInteger(Date.parse(value));
}
const ownerAddress=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
export const FUNDING_NETWORKS=Object.freeze({
 '0x1':Object.freeze({name:'Ethereum',asset:'nep141:eth.omft.near'}),
 '0xa4b1':Object.freeze({name:'Arbitrum',asset:'nep141:arb.omft.near'}),
 '0x2105':Object.freeze({name:'Base',asset:'nep141:base.omft.near'})
});

export function fundingRequest(terms,{now=Date.now()}={}){
 assert(Number.isSafeInteger(now)&&now>=0,'Invalid funding review time.');
 assert(exact(terms,['owner','chainId','amount','refundDeadline'])&&ownerAddress(terms.owner)&&Object.hasOwn(FUNDING_NETWORKS,terms.chainId)&&quantity(terms.amount)&&BigInt(terms.amount)>0n,'Invalid ETH funding terms.');
 assert(time(terms.refundDeadline)&&Date.parse(terms.refundDeadline)>now+300000&&Date.parse(terms.refundDeadline)<=now+86400000,'Funding review expired or exceeds 24 hours.');
 const asset=FUNDING_NETWORKS[terms.chainId].asset;
 return {dry:false,swapType:'EXACT_INPUT',originAsset:asset,destinationAsset:asset,amount:terms.amount,slippageTolerance:0,depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:terms.owner,refundType:'ORIGIN_CHAIN',refundTo:terms.owner,deadline:terms.refundDeadline,confidentiality:'advanced'};
}

export function checkPrivateFunding(input,{now=Date.now(),verifySignature=verifyQuoteSignature}={}){
 assert(exact(input,['terms','quote'])&&JSON.stringify(input).length<=65536,'Invalid funding offer.');
 const {terms,quote:response}=structuredClone(input),expected=fundingRequest(terms,{now});
 assert(response?.quote&&response?.quoteRequest&&verifySignature(response)===true,'Funding quote signature failed.');
 const request=response.quoteRequest,q=response.quote;
 for(const [key,value]of Object.entries(expected))assert(request[key]===value,'Funding quote changed '+key+'.');
 assert((request.depositMode===undefined||request.depositMode==='SIMPLE')&&(!Object.hasOwn(request,'appFees')||Array.isArray(request.appFees)&&request.appFees.length===0)&&(!Object.hasOwn(request,'insured')||request.insured===false),'Unsupported funding fee or deposit mode.');
 for(const key of ['customRecipientMsg','virtualChainRecipient','virtualChainRefundRecipient','rebates'])assert(!Object.hasOwn(request,key),'Unsupported funding routing instruction.');
 for(const key of ['depositMemo','chainDepositAddresses','customRecipientMsg','virtualChainRecipient','virtualChainRefundRecipient'])assert(!Object.hasOwn(q,key),'Unsupported funding deposit routing.');
 assert(providerTime(response.timestamp)&&Date.parse(response.timestamp)>=now-300000&&Date.parse(response.timestamp)<=now+30000,'Stale funding quote.');
 assert(q.amountIn===terms.amount&&q.minAmountIn===terms.amount&&quantity(q.amountOut)&&BigInt(q.amountOut)>0n&&q.minAmountOut===q.amountOut&&BigInt(q.amountOut)<=BigInt(terms.amount),'Funding quote amount changed.');
 assert(quantity(q.refundFee)&&BigInt(q.refundFee)<=BigInt(terms.amount)&&quantity(q.withdrawFee)&&BigInt(q.withdrawFee)<=BigInt(terms.amount),'Unknown or excessive funding fees.');
 assert(typeof q.depositAddress==='string'&&/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress)&&!/^0x0{40}$/i.test(q.depositAddress),'Funding needs a deposit address on the source chain.');
 const depositAddress=getAddress(q.depositAddress).toLowerCase();assert(depositAddress!==terms.owner,'Funding deposit cannot be the source wallet.');
 assert(providerTime(q.deadline)&&Date.parse(q.deadline)>=Date.parse(terms.refundDeadline)&&Date.parse(q.deadline)<=now+345600000,'Invalid funding deposit lifetime.');
 return {owner:terms.owner,chainId:terms.chainId,asset:expected.originAsset,amount:terms.amount,amountOut:q.amountOut,fees:(BigInt(terms.amount)-BigInt(q.amountOut)).toString(),refundFee:q.refundFee,withdrawFee:q.withdrawFee,refundDeadline:terms.refundDeadline,depositDeadline:q.deadline,depositAddress,settlementVerified:false,privacyVerified:false};
}

// Historical validation keeps the signed route attached to the saved attempt.
// New dispatch also checks its current time after the durable journal commit.
export function checkFundingTransfer(review,{now=review.createdAt}={}){
 const funding=checkPrivateFunding(review.funding,{now}),t=review.terms;
 assert(t.chainId===funding.chainId&&t.from===funding.owner&&t.asset==='native'&&t.recipient===funding.depositAddress&&t.to===funding.depositAddress&&t.data==='0x'&&BigInt(t.units)===BigInt(funding.amount)&&t.value===t.units,'Transfer differs from the reviewed funding route.');
 return funding;
}

// Reading an expired deposit preserves its original terms without reopening a
// wallet approval. Recover only a review time that the signed quote permits.
export function checkHistoricalFunding(offer,{now=Date.now(),verifySignature=verifyQuoteSignature}={}){
 assert(Number.isSafeInteger(now)&&now>=0&&providerTime(offer?.quote?.timestamp),'Invalid saved funding time.');
 const quoted=Date.parse(offer.quote.timestamp),reviewedAt=Math.max(0,quoted-30000,Date.parse(offer.terms?.refundDeadline)-86400000,Date.parse(offer.quote.quote?.deadline)-345600000);
 assert(Number.isSafeInteger(reviewedAt)&&reviewedAt<=now,'Saved funding review has not opened.');
 return checkPrivateFunding(offer,{now:reviewedAt,verifySignature});
}

export function checkFundingObservation(offer,input,{now=Date.now(),verifySignature=verifyQuoteSignature}={}){
 const r=checkHistoricalFunding(offer,{now,verifySignature}),value=structuredClone(input),quoted=Date.parse(offer.quote.timestamp);
 const keys=['type','quoteSignature','owner','chainId','asset','depositAddress','status','updatedAt','observedAt','amountIn','amountOut','refundedAmount','withdrawFee','settlementVerified','providerReportSigned'];
 assert(exact(value,keys)&&value.type==='lenz/private-funding-status/v1'&&value.quoteSignature===offer.quote.signature&&value.owner===r.owner&&value.chainId===r.chainId&&value.asset===r.asset&&value.depositAddress===r.depositAddress&&INTENTS_STATUSES.includes(value.status),'Funding update belongs to another deposit.');
 assert(Number.isSafeInteger(value.observedAt)&&value.observedAt>=quoted-30000&&value.observedAt<=now+60000&&time(value.updatedAt)&&Date.parse(value.updatedAt)>=quoted-60000&&Date.parse(value.updatedAt)<=value.observedAt+60000&&Date.parse(value.updatedAt)<=now+60000,'Invalid funding update time.');
 for(const field of ['amountIn','amountOut','refundedAmount','withdrawFee'])assert(value[field]===null||quantity(value[field]),'Invalid funding result amount.');
 assert(value.settlementVerified===false&&value.providerReportSigned===false,'A funding report is not verified settlement.');
 if(value.amountIn!==null)assert(BigInt(value.amountIn)<=BigInt(r.amount),'Funding input exceeds the saved deposit.');
 if(value.amountOut!==null)assert(BigInt(value.amountOut)<=BigInt(r.amount),'Funding output exceeds the saved deposit.');
 if(value.withdrawFee!==null)assert(BigInt(value.withdrawFee)<=BigInt(r.withdrawFee),'Funding withdrawal fee exceeds the saved quote.');
 if(value.status==='SUCCESS')assert(value.amountIn===r.amount&&quantity(value.amountOut)&&BigInt(value.amountOut)>=BigInt(r.amountOut),'Reported funding amount differs from the saved quote.');
 if(value.refundedAmount!==null)assert(BigInt(value.refundedAmount)<=BigInt(r.amount),'Funding refund exceeds the saved deposit.');
 if(value.amountOut!==null&&value.refundedAmount!==null){const total=BigInt(value.amountOut)+BigInt(value.refundedAmount);assert(total<=BigInt(r.amount)&&(value.amountIn===null||total<=BigInt(value.amountIn)),'Funding output and refund exceed the input deposit.');}
 if(value.status==='REFUNDED')assert(quantity(value.refundedAmount),'Funding refund amount is unknown.');
 return value;
}

const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
export function checkFundingStatusResponse(offer,response,options={}){
 const r=checkHistoricalFunding(offer,options);
 assert(response&&canonical(response.quoteResponse)===canonical(offer.quote),'Funding status changed the original quote.');
 assert(providerTime(response.updatedAt)&&response.swapDetails&&typeof response.swapDetails==='object'&&!Array.isArray(response.swapDetails),'Invalid funding provider response.');
 const d=response.swapDetails;
 return checkFundingObservation(offer,{type:'lenz/private-funding-status/v1',quoteSignature:offer.quote.signature,owner:r.owner,chainId:r.chainId,asset:r.asset,depositAddress:r.depositAddress,status:response.status,updatedAt:new Date(Date.parse(response.updatedAt)).toISOString(),observedAt:options.now??Date.now(),amountIn:d.amountIn??null,amountOut:d.amountOut??null,refundedAmount:d.refundedAmount??null,withdrawFee:d.withdrawFee??null,settlementVerified:false,providerReportSigned:false},options);
}
