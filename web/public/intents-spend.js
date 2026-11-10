import {verifyQuoteSignature} from './intents-vendor/quote.js';
import {base58,base64} from './intents-vendor/codecs.js';
import {keccak256,recoverAddress} from './evm-vendor/offline-budget.js';
import {acquireWalletPrompt} from './wallet-prompt.js';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
const amount=v=>typeof v==='string'&&/^[1-9][0-9]{0,38}$/.test(v)&&BigInt(v)<2n**128n;
const asset=v=>typeof v==='string'&&/^nep141:[a-z0-9._-]{2,128}$/.test(v);
const time=v=>typeof v==='string'&&Number.isSafeInteger(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const PRIVATE_ASSET_PREFIX='imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:';

export function checkConfidentialSpendTerms(value,now=Date.now()){
 assert(Number.isSafeInteger(now)&&now>=0,'Invalid review time.');
 const terms=structuredClone(value);
 assert(exact(terms,['owner','originAsset','destinationAsset','amount','minOutput','recipient','refundDeadline','signingDeadline','slippageBps'])&&address(terms.owner)&&address(terms.recipient),'Invalid private spending terms.');
 assert(asset(terms.originAsset)&&asset(terms.destinationAsset)&&amount(terms.amount)&&amount(terms.minOutput),'Invalid private assets or quantities.');
 assert(Number.isInteger(terms.slippageBps)&&terms.slippageBps>=0&&terms.slippageBps<=1000,'Invalid slippage limit.');
 assert(time(terms.refundDeadline)&&time(terms.signingDeadline)&&Date.parse(terms.refundDeadline)>now+60000&&Date.parse(terms.signingDeadline)>=Date.parse(terms.refundDeadline)&&Date.parse(terms.signingDeadline)<=now+345600000,'Private approval expired or exceeds four days.');
 return terms;
}

// The owner supplies terms separately from the courier's offer. A valid provider
// signature cannot replace the owner's chosen amount, beneficiary or lifetime.
export function checkConfidentialSpend(input,{now=Date.now(),verifySignature=verifyQuoteSignature}={}){
 assert(input&&JSON.stringify(input).length<=65536,'Private offer is too large.');
 const {terms:value,quote:response,generated}=structuredClone(input),terms=checkConfidentialSpendTerms(value,now);
 assert(response?.quote&&response?.quoteRequest&&verifySignature(response)===true,'Private quote signature failed.');
 const request=response.quoteRequest,quote=response.quote;
 const expected={dry:false,swapType:'EXACT_INPUT',originAsset:terms.originAsset,destinationAsset:terms.destinationAsset,amount:terms.amount,slippageTolerance:terms.slippageBps,depositType:'CONFIDENTIAL_INTENTS',recipientType:'CONFIDENTIAL_INTENTS',recipient:terms.recipient,refundType:'CONFIDENTIAL_INTENTS',refundTo:terms.owner,deadline:terms.refundDeadline,confidentiality:'advanced'};
 for(const [key,value]of Object.entries(expected))assert(request[key]===value,'Private quote changed '+key+'.');
 assert((request.depositMode===undefined||request.depositMode==='SIMPLE')&&(!Object.hasOwn(request,'appFees')||Array.isArray(request.appFees)&&request.appFees.length===0)&&(!Object.hasOwn(request,'insured')||request.insured===false),'Unsupported private quote fees or mode.');
 for(const key of ['customRecipientMsg','virtualChainRecipient','virtualChainRefundRecipient','rebates'])assert(!Object.hasOwn(request,key),'Unsupported private routing instruction.');
 assert(time(response.timestamp)&&Date.parse(response.timestamp)<=now+30000&&Date.parse(response.timestamp)<Date.parse(terms.refundDeadline),'Invalid private quote time.');
 assert(quote.amountIn===terms.amount&&quote.minAmountIn===terms.amount&&amount(quote.amountOut)&&amount(quote.minAmountOut)&&BigInt(quote.minAmountOut)>=BigInt(terms.minOutput)&&BigInt(quote.amountOut)>=BigInt(quote.minAmountOut),'Private quote amount changed.');
 assert(quote.refundFee==='0'&&quote.withdrawFee==='0','Nonzero or unknown refund and withdrawal fees need a separate review.');
 assert(typeof quote.depositAddress==='string'&&/^[0-9a-f]{64}$/.test(quote.depositAddress)&&!/^0{64}$/.test(quote.depositAddress)&&quote.deadline===terms.signingDeadline,'Private deposit or signature expiry changed.');
 for(const key of ['depositMemo','chainDepositAddresses','virtualChainRecipient','virtualChainRefundRecipient','customRecipientMsg'])assert(!Object.hasOwn(quote,key),'Unsupported private deposit routing.');
 assert(exact(generated?.intent,['standard','payload'])&&generated.intent.standard==='erc191'&&typeof generated.intent.payload==='string'&&generated.intent.payload.length<=4096,'Unsupported private signing format.');
 const text=generated.intent.payload,payload=JSON.parse(text);
 assert(JSON.stringify(payload)===text&&exact(payload,['verifying_contract','signer_id','deadline','nonce','intents'])&&payload.verifying_contract==='intents.far'&&payload.signer_id===terms.owner&&payload.deadline===terms.signingDeadline,'Private signing authority differs.');
 assert(Array.isArray(payload.intents)&&payload.intents.length===1,'Only one private deposit transfer is allowed.');
 const transfer=payload.intents[0],tokenId=PRIVATE_ASSET_PREFIX+terms.originAsset;
 assert(exact(transfer,['intent','receiver_id','tokens'])&&transfer.intent==='transfer'&&transfer.receiver_id===quote.depositAddress&&exact(transfer.tokens,[tokenId])&&transfer.tokens[tokenId]===terms.amount,'Private transfer differs from the reviewed quote.');
 assert(typeof payload.nonce==='string'&&payload.nonce.length===44,'Invalid private nonce.');
 const nonce=base64.decode(payload.nonce);
 assert(nonce.length===32&&base64.encode(nonce)===payload.nonce&&[86,40,246,198,0].every((v,i)=>nonce[i]===v)&&new DataView(nonce.buffer,nonce.byteOffset,nonce.byteLength).getBigUint64(9,true)===BigInt(Date.parse(terms.signingDeadline))*1000000n,'Private nonce expiry differs.');
 // The SDK authenticates net amounts and refund/withdrawal fees. It excludes
 // app fees, insurance, confidentiality and the request's refund-start time.
 return {...terms,quotedAt:response.timestamp,depositAddress:quote.depositAddress,payload:text,amountOut:quote.amountOut,minAmountOut:quote.minAmountOut,refundFee:'0',withdrawFee:'0',privacyVerified:false,refundDeadlineSigned:false,feeBreakdownVerified:false};
}

export function confidentialSignedData(payload,signature,owner){
 assert(typeof signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(signature),'Invalid private spending signature.');
 const raw=Uint8Array.from(signature.slice(2).match(/../g),byte=>parseInt(byte,16));
 assert([0,1,27,28].includes(raw[64]),'Invalid private signature recovery byte.');
 const encoder=new TextEncoder(),body=encoder.encode(payload),prefix=encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`),message=new Uint8Array(prefix.length+body.length);
 message.set(prefix);message.set(body,prefix.length);
 assert(recoverAddress(keccak256(message),signature).toLowerCase()===owner,'Private signature belongs to another owner.');
 if(raw[64]>=27)raw[64]-=27;
 return {standard:'erc191',payload,signature:'secp256k1:'+base58.encode(raw)};
}

export function checkConfidentialSignedData(review,input){
 const signedData=structuredClone(input);
 assert(exact(signedData,['standard','payload','signature'])&&signedData.standard==='erc191'&&signedData.payload===review.payload&&typeof signedData.signature==='string'&&/^secp256k1:[1-9A-HJ-NP-Za-km-z]{87,90}$/.test(signedData.signature),'Private signature differs from reviewed terms.');
 const raw=base58.decode(signedData.signature.slice(10));assert(raw.length===65&&raw[64]<=1,'Invalid private signature encoding.');
 const hex='0x'+Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
 assert(confidentialSignedData(review.payload,hex,review.owner).signature===signedData.signature,'Private owner signature failed.');
 return signedData;
}

// This capability requests no RPC balance or transaction. The installed wallet
// still needs to support personal_sign while offline; it retains the money key.
export async function signConfidentialSpend(provider,input,{signal,now=Date.now,verifySignature=verifyQuoteSignature}={}){
 assert(provider&&['request','on','removeListener'].every(k=>typeof provider[k]==='function'),'Use a wallet with account-change notifications.');
 signal?.throwIfAborted();
 const captured=structuredClone(input),review=checkConfidentialSpend(captured,{now:now(),verifySignature}),controller=new AbortController();
 const active=AbortSignal.any([controller.signal,AbortSignal.timeout(60000),...(signal?[signal]:[])]),listeners=[];
 let onAbort;
 const releasePrompt=acquireWalletPrompt(provider);
 const task=(async()=>{
  const ownerAccounts=value=>Array.isArray(value)&&value.length>0&&typeof value[0]==='string'&&value[0].toLowerCase()===review.owner;
  try{
   for(const event of ['accountsChanged','chainChanged','disconnect']){
    const handler=value=>{if(event==='accountsChanged'&&ownerAccounts(value))return;controller.abort(Error('Wallet account or network changed.'));};
    provider.on(event,handler);listeners.push([event,handler]);
   }
   const request=async(method,params)=>{active.throwIfAborted();const value=await provider.request({method,...(params?{params}:{})});active.throwIfAborted();return value;};
   assert(ownerAccounts(await request('eth_requestAccounts')),'Choose the private balance owner in your wallet.');
   const chain=await request('eth_chainId');assert(typeof chain==='string'&&/^0x[1-9a-f][0-9a-f]*$/i.test(chain)&&chain.length<=66,'Invalid wallet network.');
   assert(ownerAccounts(await request('eth_accounts')),'Wallet owner changed before approval.');
   checkConfidentialSpend(captured,{now:now(),verifySignature});
   const hex='0x'+Array.from(new TextEncoder().encode(review.payload),b=>b.toString(16).padStart(2,'0')).join('');
   const signature=await request('personal_sign',[hex,review.owner]);
   assert(ownerAccounts(await request('eth_accounts'))&&await request('eth_chainId')===chain,'Wallet owner or network changed during approval.');
   checkConfidentialSpend(captured,{now:now(),verifySignature});active.throwIfAborted();
   return confidentialSignedData(review.payload,signature,review.owner);
  }finally{
   // Cancellation cannot dismiss the provider's prompt. Hold the lock until its
   // actual promise settles, including across a caller retry after cancellation.
   releasePrompt();
   for(const [event,handler]of listeners)try{provider.removeListener(event,handler);}catch{}
  }
 })();
 try{return await Promise.race([task,new Promise((_,reject)=>{onAbort=()=>reject(active.reason);active.addEventListener('abort',onAbort,{once:true});if(active.aborted)onAbort();})]);}
 finally{active.removeEventListener('abort',onAbort);}
}
