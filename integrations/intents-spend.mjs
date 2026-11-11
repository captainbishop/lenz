import {checkConfidentialSpend,checkConfidentialSpendTerms,checkConfidentialSignedData} from '../web/public/intents-spend.js';
import {base58} from '../web/public/intents-vendor/codecs.js';
import {verifyQuoteSignature} from './quote-verifier/index.mjs';
import {checkConfidentialObservation} from '../web/public/intents-status.js';
import {fundingRequest,checkPrivateFunding} from '../web/public/private-funding.js';
const API='https://1click.chaindefuser.com/v0/';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function providerTime(value){
 const parts=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
 assert(parts,'Invalid private status update time.');
 const local=parts[1].toUpperCase()+'.'+(parts[2]??'').slice(0,3).padEnd(3,'0')+'Z',calendar=Date.parse(local),updated=Date.parse(value);
 assert(Number.isSafeInteger(calendar)&&new Date(calendar).toISOString()===local&&Number.isSafeInteger(updated),'Invalid private status update time.');
 return new Date(updated).toISOString();
}
function checkAccess({apiKey,signal}={}){
 assert(typeof apiKey==='string'&&apiKey.trim().length>0,'Private execution preparation requires partner access.');
 signal?.throwIfAborted();
}
async function request(path,body,{apiKey,fetcher=fetch,signal}={}){
 checkAccess({apiKey,signal});
 const active=AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]);
 const response=await fetcher(API+path,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','X-API-Key':apiKey},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:active});
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('Private Intents HTTP '+response.status+'.');}
 assert(response.body,'Empty private Intents response.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=65536,'Private Intents response is too large.');chunks.push(value);}
  active.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// This allocates an unfunded quote. The returned signing deadline is new owner
// review information, not permission to sign or spend the requested amount.
export async function prepareConfidentialSpend(input,{now=Date.now,verifySignature=verifyQuoteSignature,...options}={}){
 assert(input&&JSON.stringify(input).length<=4096&&!Object.hasOwn(input,'signingDeadline'),'Choose new private swap terms before quoting.');
 const terms=checkConfidentialSpendTerms({...structuredClone(input),signingDeadline:input.refundDeadline},now());
 const body={dry:false,swapType:'EXACT_INPUT',originAsset:terms.originAsset,destinationAsset:terms.destinationAsset,amount:terms.amount,slippageTolerance:terms.slippageBps,depositType:'CONFIDENTIAL_INTENTS',recipientType:'CONFIDENTIAL_INTENTS',recipient:terms.recipient,refundType:'CONFIDENTIAL_INTENTS',refundTo:terms.owner,deadline:terms.refundDeadline,confidentiality:'advanced'};
 const quote=await request('quote',body,options);
 assert(quote?.quote&&quote?.quoteRequest&&verifySignature(quote)===true,'Private quote signature failed.');
 for(const [key,value]of Object.entries(body))assert(quote.quoteRequest[key]===value,'Private quote changed '+key+'.');
 assert(typeof quote.quote.depositAddress==='string'&&/^[0-9a-f]{64}$/.test(quote.quote.depositAddress),'Unsupported private deposit address.');
 terms.signingDeadline=quote.quote.deadline;checkConfidentialSpendTerms(terms,now());
 const generated=await request('generate-intent',{type:'swap_transfer',standard:'erc191',signerId:terms.owner,depositAddress:quote.quote.depositAddress},options);
 const offer={terms,quote,generated},review=checkConfidentialSpend(offer,{now:now(),verifySignature});
 return {state:'awaiting-owner-review',offer,review};
}

export async function prepareConfidentialFunding(input,{now=Date.now,verifySignature=verifyQuoteSignature,...options}={}){
 const terms=structuredClone(input),body=fundingRequest(terms,{now:now()});
 const quote=await request('quote',body,options),offer={terms,quote};
 const review=checkPrivateFunding(offer,{now:now(),verifySignature});
 return {state:'awaiting-funding-review',offer,review};
}

// The caller must durably retain its signed request and submission attempt first.
// A lost HTTP response does not establish that the provider refused the transfer.
export async function submitConfidentialSpend(input,signed,{now=Date.now,verifySignature=verifyQuoteSignature,...options}={}){
 const offer=structuredClone(input),review=checkConfidentialSpend(offer,{now:now(),verifySignature}),signedData=checkConfidentialSignedData(review,signed);
 checkAccess(options);
 let result;
 try{
  result=await request('submit-intent',{type:'swap_transfer',signedData},options);
  assert(typeof result?.intentHash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.intentHash)&&base58.decode(result.intentHash).length===32,'Invalid private submission response.');
 }catch{
  const error=Error('Private submission outcome is unknown. Keep the signed request and check its original deposit before retrying.');error.submissionUnknown=true;throw error;
 }
 return {state:'submitted',intentHash:result.intentHash,depositAddress:review.depositAddress,settlementVerified:false};
}

export async function readConfidentialSpendStatus(input,{now=Date.now,verifySignature=verifyQuoteSignature,...options}={}){
 const offer=structuredClone(input),quotedAt=Date.parse(offer?.quote?.timestamp),time=now();
 assert(Number.isSafeInteger(time)&&time>=0&&Number.isSafeInteger(quotedAt)&&quotedAt<=time+30000,'Invalid original private quote time.');
 // Use the earliest possible review time under the same clock and lifetime
 // bounds as signing. The provider timestamp need not equal the owner's clock.
 const reviewedAt=Math.max(0,quotedAt-30000,Date.parse(offer?.terms?.signingDeadline)-345600000);
 assert(reviewedAt<=time,'Original private approval has no valid review time.');
 const review=checkConfidentialSpend(offer,{now:reviewedAt,verifySignature});
 const result=await request('status?depositAddress='+encodeURIComponent(review.depositAddress),undefined,options);
 assert(result?.quoteResponse?.signature===offer.quote.signature,'Private status changed the original quote.');
 checkConfidentialSpend({...offer,quote:result.quoteResponse},{now:reviewedAt,verifySignature});
 const details=result.swapDetails;assert(details&&typeof details==='object'&&!Array.isArray(details),'Private status has no swap details.');
 return checkConfidentialObservation(review,{type:'lenz/private-status/v1',depositAddress:review.depositAddress,status:result.status,updatedAt:providerTime(result.updatedAt),observedAt:now(),amountIn:details.amountIn??null,amountOut:details.amountOut??null,refundedAmount:details.refundedAmount??null,withdrawFee:details.withdrawFee??null,settlementVerified:false,providerReportSigned:false},{now:now()});
}
