// Real testnet exchange checks using only the disposable deployer's redeemed tUSD.
// This is not the offline signed-instruction adapter or a user-facing swap API.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { configuration, relayAccount, provider, call, view } from './client.mjs';
import { rheaQuote, RHEA } from '../integrations/rhea.mjs';
const config=await configuration(), account=await relayAccount();
assert(config.ready&&config.network==='testnet'&&config.contract===`tusd.${account.accountId}`);
assert(account.accountId.startsWith('lenz-dev-'));
const token=config.contract, wrap='wrap.testnet', dex=RHEA.contract;
const oneYocto='0.000000000000000000000001';
const file=new URL('./rhea-flow-results.json',import.meta.url);
let evidence;
try{evidence=JSON.parse(await readFile(file,'utf8'));assert.equal(evidence.token,token);}
catch(error){if(error.code!=='ENOENT')throw error;}
evidence??={network:'testnet',token,exchange:dex,account:account.accountId,steps:{},checks:[],
  interfaceSource:'https://guide.rhea.finance/developers-1/cli-trading',
  scope:'Disposable NEAR testnet account: redeemed reserve tUSD, Rhea liquidity, bounded direct swap and withdrawal. No offline Rhea authorization adapter or production privacy claim.'};
async function save(){evidence.checkedAt=new Date().toISOString();await writeFile(file,JSON.stringify(evidence,null,2)+'\n',{flush:true});}
async function step(name,operation){
  if(evidence.steps[name])return evidence.steps[name];
  try{const result=await operation();evidence.steps[name]=result??{ok:true};if(evidence.failure){(evidence.failures??=[]).push(evidence.failure);delete evidence.failure;}await save();console.log('PASS '+name);return evidence.steps[name];}
  catch(error){evidence.failure={step:name,message:error.message,txHash:error.txHash??error.transactionResult?.transaction?.hash};await save();throw error;}
}
async function check(name,operation){await operation();if(!evidence.checks.includes(name))evidence.checks.push(name);await save();console.log('PASS '+name);}
const state=await provider.viewAccount({accountId:dex,blockQuery:{finality:'final'}});
if(evidence.exchangeCodeHash)assert.equal(state.code_hash,evidence.exchangeCodeHash,'Exchange code changed; review before resuming');
evidence.exchangeCodeHash=state.code_hash;
await step('redeemed tUSD is available',async()=>{
  const balance=await view(token,'ft_balance_of',{account_id:account.accountId});assert(BigInt(balance)>=6000000n,'Run the reserve redemption test first');return {balance};
});
await step('register account on Rhea',()=>call(account,dex,'storage_deposit',{account_id:account.accountId,registration_only:false},'0.2'));
await step('register Rhea on tUSD',()=>call(account,token,'storage_deposit',{account_id:dex,registration_only:true},'0.02'));
await step('register recipient on wrapped NEAR',()=>call(account,wrap,'storage_deposit',{account_id:account.accountId,registration_only:true},'0.02'));
await step('register Rhea on wrapped NEAR',()=>call(account,wrap,'storage_deposit',{account_id:dex,registration_only:true},'0.02'));
await step('register token pair in the Rhea account',()=>call(account,dex,'register_tokens',{token_ids:[token,wrap]},oneYocto));
await step('wrap faucet-funded test NEAR',()=>call(account,wrap,'near_deposit',{},'0.1'));
await step('deposit six redeemed tUSD',()=>call(account,token,'ft_transfer_call',{receiver_id:dex,amount:'6000000',msg:''},oneYocto));
await step('deposit wrapped test NEAR',()=>call(account,wrap,'ft_transfer_call',{receiver_id:dex,amount:'100000000000000000000000',msg:''},oneYocto));
const pool=await step('create tUSD and wrapped NEAR test pool',()=>call(account,dex,'add_simple_pool',{tokens:[token,wrap],fee:25},'0.1'));
const poolId=pool.value;assert(Number.isSafeInteger(poolId));evidence.poolId=poolId;
await step('fund test pool liquidity',()=>call(account,dex,'add_liquidity',{pool_id:poolId,amounts:['5000000','100000000000000000000000']},'0.05'));
await step('reject an impossible minimum without debiting deposits',async()=>{
  const before=await view(dex,'get_deposits',{account_id:account.accountId});let rejected;
  try{await call(account,dex,'swap',{actions:[{pool_id:poolId,token_in:token,amount_in:'1000000',token_out:wrap,min_amount_out:'1000000000000000000000000000000'}]},oneYocto);}
  catch(error){assert(/slippage|minimum|min.amount|E68/i.test(error.message),error.message);rejected={message:error.message,txHash:error.txHash??error.transactionResult?.transaction?.hash};}
  assert(rejected,'Slippage guard did not reject the impossible minimum');
  assert.deepEqual(await view(dex,'get_deposits',{account_id:account.accountId}),before);
  return {rejected,before};
});
const swap=await step('swap one tUSD under the quoted output bound',async()=>{
  const quote=await rheaQuote({network:'testnet',contract:dex,poolId,tokenIn:token,tokenOut:wrap,amountIn:'1000000',slippageBps:50});
  const before=await view(dex,'get_deposits',{account_id:account.accountId});
  const receipt=await call(account,dex,'swap',{actions:[{pool_id:poolId,token_in:token,amount_in:'1000000',token_out:wrap,min_amount_out:quote.minAmountOut}]},oneYocto);
  const after=await view(dex,'get_deposits',{account_id:account.accountId});
  assert.equal(BigInt(before[token])-BigInt(after[token]),1000000n);
  const received=BigInt(after[wrap]??'0')-BigInt(before[wrap]??'0');assert(received>=BigInt(quote.minAmountOut));
  return {quote,receipt,before,after,received:received.toString()};
});
await step('withdraw exchange output into the authorized NEP-141 account',async()=>{
  const before=await view(wrap,'ft_balance_of',{account_id:account.accountId});
  const receipt=await call(account,dex,'withdraw',{token_id:wrap,amount:swap.received},oneYocto);
  const after=await view(wrap,'ft_balance_of',{account_id:account.accountId});
  assert.equal(BigInt(after)-BigInt(before),BigInt(swap.received));return {receipt,before,after};
});
await check('pool remains funded and the output owner is registered',async()=>{
  const p=await view(dex,'get_pool',{pool_id:poolId});assert.deepEqual(p.token_account_ids,[token,wrap]);assert(p.amounts.every(a=>BigInt(a)>0n));
  assert(await view(wrap,'storage_balance_of',{account_id:account.accountId}));evidence.pool=p;
});
evidence.ok=true;await save();
