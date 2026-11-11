import {verifyQuoteSignature} from './intents-vendor/quote.js';
import {getAddress} from './evm-vendor/address.js';

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
