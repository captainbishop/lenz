import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { KeyPair, nearToYocto } from 'near-api-js';
import { relayAccount, view, call, provider } from './client.mjs';
import { adapterConfig, verifyAdapter, adapterCall, verifyPacketRoot } from './adapter-client.mjs';
import { createIdentity } from '../web/public/peer-crypto.js';
import { emptyNearVault, fundingRequest } from '../web/public/near-protocol.js';
import { prepareRheaSwap } from '../web/public/rhea-protocol.js';
import { rheaQuote } from '../integrations/rhea.mjs';
import { TESTNET_RPC } from '../integrations/near-network.mjs';
const c=await adapterConfig(), relay=await relayAccount();await verifyAdapter(c);
const file=new URL('./adapter/live-results.json',import.meta.url);
let evidence;try{evidence=JSON.parse(await readFile(file,'utf8'));assert.equal(evidence.adapter,c.adapter);}catch(e){if(e.code!=='ENOENT')throw e;}
evidence??={adapter:c.adapter,network:'testnet',cases:{},checks:[],scope:'Disposable identities and NEAR testnet funds. Real reserve, Rhea and signed-recipient balances; no user wallet or privacy claim.'};
if(evidence.failure){(evidence.previousFailures??=[]).push(evidence.failure);delete evidence.failure;}
evidence.rpc=TESTNET_RPC;
async function save(){evidence.checkedAt=new Date().toISOString();await writeFile(file,JSON.stringify(evidence,null,2)+'\n',{flush:true});}
async function check(name,fn){if(evidence.checks.includes(name))return;await fn();evidence.checks.push(name);await save();console.log('PASS '+name);}
const recipientPath=new URL('./.testnet/adapter-recipient.json',import.meta.url);let recipient;
try{recipient=JSON.parse(await readFile(recipientPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const pair=KeyPair.fromRandom('ed25519');recipient={accountId:`retry.${relay.accountId}`,publicKey:pair.getPublicKey().toString(),privateKey:pair.toString()};await writeFile(recipientPath,JSON.stringify(recipient),{flag:'wx',mode:0o600});}
try{await provider.viewAccount({accountId:recipient.accountId,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))throw e;await relay.createAccount({newAccountId:recipient.accountId,publicKey:recipient.publicKey,nearToTransfer:nearToYocto('0.1')});}
for(const token of [c.reserve,c.tokenOut])await call(relay,token,'storage_deposit',{account_id:relay.accountId,registration_only:true},'0.02');
async function runCase(name,kind){
  let entry=evidence.cases[name];
  if(!entry){
    const identity=await createIdentity('Disposable Rhea test'), funding=await fundingRequest(identity,c.reserve,'3');
    const vault=emptyNearVault(c.reserve);vault.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});
    const quote=await rheaQuote({network:'testnet',contract:c.exchange,poolId:c.poolId,tokenIn:c.reserve,tokenOut:c.tokenOut,amountIn:'1000000',slippageBps:100});
    const r=await prepareRheaSwap(vault,identity,c,{text:'1',minOutput:kind==='slippage'?'1000000000000000000000000000000':quote.minAmountOut,receiver:kind==='retry'?recipient.accountId:relay.accountId,deadlineMs:Date.now()+(kind==='expiry'?1000:3600000)});
    entry=evidence.cases[name]={packet:r.packet,funding,quote,transactions:[],before:{tusd:await view(c.reserve,'ft_balance_of',{account_id:r.packet.instruction.receiver_id}),wrap:await view(c.tokenOut,'ft_balance_of',{account_id:r.packet.instruction.receiver_id})}};await save();
  }
  const p=entry.packet;
  if(!await view(c.reserve,'get_root',{id:p.root.id})){const {owner,amount,nonce,signature}=entry.funding;entry.transactions.push(await call(relay,c.reserve,'fund_test',{owner,amount,nonce,signature},'0.03'));await save();}
  await verifyPacketRoot(c,p);
  if(p.path.length && !await view(c.reserve,'get_note',{id:p.instruction.input})){entry.transactions.push(await call(relay,c.reserve,'settle',{path:p.path},'0.1'));await save();}
  if(kind==='success'&&!entry.preRedeemed){
    const i=p.instruction;entry.transactions.push(await call(relay,c.reserve,'redeem',{input:i.input,receiver_id:c.adapter,nonce:i.nonce,signature:i.redemption_signature},'0.02'));entry.preRedeemed=true;await save();
  }
  let order=await view(c.adapter,'get_order',{id:p.id});
  if(!order){const tx=await adapterCall(relay,c,'submit',{instruction:p.instruction});entry.transactions.push(tx);order=tx.order;await save();}
  for(let n=0;n<12 && !['complete','refunded'].includes(order.stage);n++){
    assert(!['rejected','attention'].includes(order.stage),JSON.stringify(order));
    const tx=await adapterCall(relay,c,'advance',{id:p.id});entry.transactions.push(tx);order=tx.order;entry.order=order;await save();console.log(name+': '+order.stage);
    if(kind==='retry' && order.stage==='output_available' && tx.failedReceipts.length){
      entry.retryObserved=true;await save();
      entry.transactions.push(await call(relay,c.tokenOut,'storage_deposit',{account_id:recipient.accountId,registration_only:true},'0.02'));await save();
    }
  }
  entry.order=order;
  const expected=['expiry','slippage'].includes(kind)?'refunded':'complete';assert.equal(order.stage,expected);
  entry.after={tusd:await view(c.reserve,'ft_balance_of',{account_id:p.instruction.receiver_id}),wrap:await view(c.tokenOut,'ft_balance_of',{account_id:p.instruction.receiver_id})};
  if(expected==='complete'){assert.equal(BigInt(entry.after.wrap)-BigInt(entry.before.wrap),BigInt(order.output));assert.equal(entry.after.tusd,entry.before.tusd);}
  else {assert.equal(BigInt(entry.after.tusd)-BigInt(entry.before.tusd),1000000n);assert.equal(entry.after.wrap,entry.before.wrap);}
  if(kind==='retry')assert(entry.retryObserved,'Expected an actual unregistered-recipient payout failure');
  if(kind==='slippage')assert(entry.transactions.some(t=>t.failedReceipts?.length),'Expected actual exchange rejection');
  await save();console.log('PASS '+name);
}
try{
  await check('signed swap pays exact output after a carrier pre-redeems the same authorization',()=>runCase('success','success'));
  await check('minimum-output rejection refunds exact input to signed account',()=>runCase('slippage','slippage'));
  await check('expired submission redeems and refunds without swapping',()=>runCase('expiry','expiry'));
  await check('unregistered output account fails payout then receives it once after registration',()=>runCase('retry','retry'));
  await check('duplicate submit and advance never pay twice',async()=>{
    const p=evidence.cases.success.packet;const before=await view(c.tokenOut,'ft_balance_of',{account_id:p.instruction.receiver_id});
    const a=await adapterCall(relay,c,'submit',{instruction:p.instruction}),b=await adapterCall(relay,c,'advance',{id:p.id});
    assert.equal(a.order.stage,'complete');assert.equal(b.order.stage,'complete');assert.equal(await view(c.tokenOut,'ft_balance_of',{account_id:p.instruction.receiver_id}),before);evidence.duplicates=[a,b];
  });
  evidence.ok=true;delete evidence.failure;await save();
}catch(e){evidence.failure={message:e.message};await save();throw e;}
