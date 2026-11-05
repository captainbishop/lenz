import {INTENTS_API} from './intents.mjs';
import {verifyQuoteSignature} from './quote-verifier/index.mjs';
import {receiveAssets,receiveSelection} from '../web/public/receive-assets.js';
import {assert,keysAre} from '../web/public/peer-crypto.js';
import {getAddress} from '../web/public/evm-vendor/address.js';
import {WALLET_NETWORKS} from '../web/public/evm-networks.js';

const refundChains=Object.freeze({eth:'0x1',arb:'0xa4b1',base:'0x2105'});
function refundAddress(token,value){
  assert(Object.hasOwn(refundChains,token.blockchain)&&Object.hasOwn(WALLET_NETWORKS,refundChains[token.blockchain]),'Refund validation is not connected for this network.');
  assert(typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/i.test(value),'Use a real refund address on the source network, not a Lenz ID.');
  return getAddress(value).toLowerCase();
}

async function request(path,{fetcher=fetch,apiKey,body,signal}={}){
  const response=await fetcher(INTENTS_API+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json',...(apiKey?{'X-API-Key':apiKey}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:signal??AbortSignal.timeout(15000)});
  assert(response.ok,'NEAR Intents is unavailable.');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.byteLength;if(size>3000000)throw Error('Intents response too large.');chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export async function readReceiveAssets(options={}){return receiveAssets(await request('/v0/tokens',options));}

// Dry preparation only. Account ownership and recovery must be established by a
// confidential-account adapter before any address allocation can be exposed.
export function confidentialReceiveRequest(input,{tokens,account,now=Date.now()}={}){
  const selected=receiveSelection(input,tokens),until=Date.parse(selected.deadline);
  assert(Number.isFinite(until)&&until>now&&until<=now+86400000,'Receiving deadline must be within 24 hours.');
  assert(keysAre(account,['type','id'])&&account.type==='CONFIDENTIAL_INTENTS'&&typeof account.id==='string'&&/^[a-z0-9][a-z0-9._-]{1,127}$/.test(account.id),'A confidential Intents account is required.');
  return {dry:true,swapType:'EXACT_INPUT',originAsset:selected.token.assetId,destinationAsset:selected.token.assetId,amount:selected.amount,slippageTolerance:0,depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:account.id,refundType:'ORIGIN_CHAIN',refundTo:refundAddress(selected.token,selected.refundTo),deadline:selected.deadline,confidentiality:'advanced'};
}
export async function previewConfidentialReceive(input,{tokens,account,apiKey,fetcher=fetch,now=Date.now(),verifySignature=verifyQuoteSignature}={}){
  const body=confidentialReceiveRequest(input,{tokens,account,now});
  assert(typeof apiKey==='string'&&apiKey.trim().length>0,'Confidential receiving requires partner access.');
  const result=await request('/v0/quote',{body,apiKey,fetcher});
  assert(result?.quote&&result?.quoteRequest,'Invalid receiving quote.');
  for(const [key,value]of Object.entries(body))assert(result.quoteRequest[key]===value,'Receiving terms changed.');
  assert(!Object.hasOwn(result.quote,'depositAddress')&&!Object.hasOwn(result.quote,'depositMemo')&&!Object.hasOwn(result.quote,'chainDepositAddresses'),'Dry preview must not allocate a deposit.');
  const {amountIn,amountOut,minAmountOut}=result.quote;
  assert(amountIn===body.amount&&typeof amountOut==='string'&&/^[1-9][0-9]{0,77}$/.test(amountOut)&&minAmountOut===amountOut&&BigInt(amountOut)<=BigInt(amountIn),'Invalid receiving amounts.');
  const timestamp=Date.parse(result.timestamp);assert(Number.isFinite(timestamp)&&timestamp>=now-300000&&timestamp<=now+30000,'Stale receiving quote.');
  assert(verifySignature(result)===true,'Receiving quote signature failed.');
  return {state:'preview',asset:receiveAssets(tokens).find(t=>t.assetId===body.originAsset),amountIn,amountOut,fees:(BigInt(amountIn)-BigInt(amountOut)).toString(),recipientType:body.recipientType,recipient:body.recipient,refundTo:body.refundTo,deadline:body.deadline,depositAvailable:false,executable:false,privacyVerified:false,quote:result};
}
