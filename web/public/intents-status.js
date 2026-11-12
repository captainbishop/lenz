const assert=(ok,message)=>{if(!ok)throw Error(message);};
export const INTENTS_STATUSES=['KNOWN_DEPOSIT_TX','PENDING_DEPOSIT','INCOMPLETE_DEPOSIT','PROCESSING','SUCCESS','REFUNDED','FAILED'];
const amount=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value)&&BigInt(value)<2n**128n;

// The quote signature does not authenticate a later provider status. A courier
// can relay the report, but it remains separate from settlement evidence.
export function checkConfidentialObservation(review,input,{now=Date.now()}={}){
 const quoted=typeof review?.quotedAt==='string'?Date.parse(review.quotedAt):NaN;
 assert(Number.isSafeInteger(quoted)&&new Date(quoted).toISOString()===review.quotedAt&&typeof review.depositAddress==='string'&&/^[0-9a-f]{64}$/.test(review.depositAddress)&&!/^0{64}$/.test(review.depositAddress)&&amount(review.amount)&&review.amount!=='0'&&amount(review.minAmountOut)&&review.minAmountOut!=='0','Invalid private status review.');
 const value=structuredClone(input),keys=['type','depositAddress','status','updatedAt','observedAt','amountIn','amountOut','refundedAmount','withdrawFee','settlementVerified','providerReportSigned'];
 assert(value&&Object.keys(value).sort().join(',')===keys.sort().join(',')&&value.type==='lenz/private-status/v1'&&value.depositAddress===review.depositAddress&&INTENTS_STATUSES.includes(value.status),'Private status belongs to another request or is invalid.');
 assert(Number.isSafeInteger(now)&&Number.isSafeInteger(value.observedAt)&&value.observedAt>=quoted&&value.observedAt<=now+60000,'Invalid private observation time.');
 const updated=typeof value.updatedAt==='string'?Date.parse(value.updatedAt):NaN;
 assert(Number.isSafeInteger(updated)&&new Date(updated).toISOString()===value.updatedAt&&updated>=quoted-60000&&updated<=value.observedAt+60000&&updated<=now+60000,'Invalid private provider update time.');
 for(const field of ['amountIn','amountOut','refundedAmount','withdrawFee'])assert(value[field]===null||amount(value[field]),'Invalid private result amount.');
 assert(value.settlementVerified===false&&value.providerReportSigned===false,'A private status report is not signed settlement evidence.');
 if(value.status==='SUCCESS')assert(value.amountIn===review.amount&&amount(value.amountOut)&&BigInt(value.amountOut)>=BigInt(review.minAmountOut)&&(value.withdrawFee===null||value.withdrawFee==='0'),'Completed private amounts differ from the signed quote.');
 if(value.status==='REFUNDED')assert(amount(value.refundedAmount)&&BigInt(value.refundedAmount)<=BigInt(review.amount),'Invalid private refund amount.');
 return value;
}
