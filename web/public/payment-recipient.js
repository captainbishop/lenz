import {assert} from './peer-crypto.js';
import {address,transferAssets} from './evm-transfer.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {receivingInput,verifyReceivingInstruction} from './receiving-instructions.js';

export async function paymentRecipient(text,{network,recipientId,now=Date.now()}={}){
 const instruction=receivingInput(text);
 if(instruction){
  const verified=await verifyReceivingInstruction(instruction,{recipientId,now}),t=verified.terms;
  return {address:t.address,chainId:t.chainId,asset:t.asset,profile:t.profile,expiresAt:t.expiresAt,instruction:verified};
 }
 text=text.trim();
 assert(!text.startsWith('lenz1_'),'Ask this person for a receiving link for the asset you want to send.');
 if(text.startsWith('ethereum:')){
  const match=/^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})@([1-9][0-9]{0,15})(?:\/transfer\?address=(0x[0-9a-fA-F]{40}))?$/.exec(text);
  assert(match,'Use a payment link with an exact network and receiving address. Amount-bearing links are not supported.');
  const chainId='0x'+BigInt(match[2]).toString(16),asset=match[3]?address(match[1]):'native',recipient=address(match[3]??match[1]);
  assert(Object.hasOwn(WALLET_NETWORKS,chainId),'Receiving network is not supported.');
  assert(transferAssets(chainId).some(a=>a.id===asset),'Receiving asset is not supported.');
  return {address:recipient,chainId,asset,profile:null,expiresAt:null,instruction:null};
 }
 const recipient=address(text);
 assert(Object.hasOwn(WALLET_NETWORKS,network),'Choose the recipient’s network. An address alone does not identify it.');
 return {address:recipient,chainId:network,asset:null,profile:null,expiresAt:null,instruction:null};
}
export function checkRecipientTransfer(recipient,terms,{now=Date.now()}={}){
 assert(recipient.chainId===terms.chainId,'Receiving network differs. A cross-chain payment route is not connected yet.');
 assert(!recipient.asset||recipient.asset===terms.asset,'Choose the asset requested in the receiving link.');
 assert(recipient.address===terms.recipient,'Receiving address changed.');
 assert(!recipient.expiresAt||now<recipient.expiresAt,'Receiving link expired. Ask for a new link.');
}
