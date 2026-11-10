import {createRequire} from 'node:module';
import {Wallet} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {verifyQuoteSignature} from './public/intents-vendor/quote.js';
const require=createRequire(new URL('../integrations/quote-verifier/package.json',import.meta.url));
const nacl=require('tweetnacl'),{base58}=require('@scure/base'),sdk=require('@defuse-protocol/one-click-sdk-typescript');
const manager=nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8));
export const managerKey='ed25519:'+base58.encode(manager.publicKey);
export const wallet=new Wallet('0x'+'11'.repeat(32)),owner=wallet.address.toLowerCase(),now=1794211200000;
export const verifier=q=>verifyQuoteSignature(q,managerKey);
export const signQuote=q=>{q.signature='ed25519:'+base58.encode(nacl.sign.detached(new TextEncoder().encode(sdk.quoteHash(q)),manager.secretKey));return q;};
export function fixture(){
 const terms={owner,originAsset:'nep141:eth.omft.near',destinationAsset:'nep141:eth.omft.near',amount:'10000000000000000',minOutput:'9900000000000000',recipient:'0x'+'22'.repeat(20),refundDeadline:new Date(now+3600000).toISOString(),signingDeadline:new Date(now+3600000+259200000).toISOString(),slippageBps:0};
 const quote=signQuote({quoteRequest:{dry:false,depositMode:'SIMPLE',swapType:'EXACT_INPUT',depositType:'CONFIDENTIAL_INTENTS',recipientType:'CONFIDENTIAL_INTENTS',refundType:'CONFIDENTIAL_INTENTS',originAsset:terms.originAsset,destinationAsset:terms.destinationAsset,amount:terms.amount,recipient:terms.recipient,refundTo:owner,deadline:terms.refundDeadline,slippageTolerance:0,confidentiality:'advanced',appFees:[],insured:false,quoteWaitingTimeMs:0},quote:{amountIn:terms.amount,minAmountIn:terms.amount,amountOut:terms.amount,minAmountOut:terms.amount,depositAddress:'ab'.repeat(32),deadline:terms.signingDeadline,timeWhenInactive:terms.signingDeadline,refundFee:'0',withdrawFee:'0'},timestamp:new Date(now).toISOString()});
 const nonce=new Uint8Array(32);nonce.set([86,40,246,198,0]);new DataView(nonce.buffer).setBigUint64(9,BigInt(Date.parse(terms.signingDeadline))*1000000n,true);
 const payload={verifying_contract:'intents.far',signer_id:owner,deadline:terms.signingDeadline,nonce:Buffer.from(nonce).toString('base64'),intents:[{intent:'transfer',receiver_id:quote.quote.depositAddress,tokens:{['imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:'+terms.originAsset]:terms.amount}}]};
 return {terms,quote,generated:{intent:{standard:'erc191',payload:JSON.stringify(payload)}},payload};
}
