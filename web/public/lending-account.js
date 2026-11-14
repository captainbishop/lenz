import {EVM_MARKETS} from './evm-markets.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {address,amount,check,uint,hash} from './evm-transfer.js';

const selectors={provider:'0x0542975c',pool:'0x026b1d5f',oracle:'0xfca513a8',currency:'0xe19f4700',unit:'0x8c89b64f',account:'0xbf92857c'};
function words(value,count){
 check(typeof value==='string'&&new RegExp('^0x[0-9a-fA-F]{'+count*64+'}$').test(value),'Invalid lending account response.');
 return value.slice(2).match(/.{64}/g).map(word=>BigInt('0x'+word));
}
function contract(value){const [word]=words(value,1);check(word>0n&&word<2n**160n,'Invalid lending contract address.');return address('0x'+word.toString(16).padStart(40,'0'));}
const decimal=(value,places)=>amount('0x'+value.toString(16),places);

// A provider observation, not a proof of chain state or permission to borrow.
export async function readLendingAccount(lease){
 const {chainId}=lease.identity;check(Object.hasOwn(WALLET_NETWORKS,chainId),'Lending account is not supported on this network.');
 const walletAddress=address(lease.identity.address),pool=EVM_MARKETS[WALLET_NETWORKS[chainId].key].aavePool;
 async function identity(){
  lease.assertCurrent();const accounts=await lease.request('eth_accounts');
  check(Array.isArray(accounts)&&accounts.length>0&&address(accounts[0])===walletAddress,'Wallet account changed.');
  const chain=await lease.request('eth_chainId');check(uint(chain)&&BigInt(chain)===BigInt(chainId),'Wallet network changed.');lease.assertCurrent();
 }
 await identity();const block=await lease.request('eth_blockNumber');check(uint(block),'Invalid lending block.');
 function validateBlock(value){
  check(value&&value.number===block&&hash(value.hash)&&uint(value.timestamp),'Invalid lending block.');
  const age=BigInt(Math.floor(Date.now()/1000))-BigInt(value.timestamp);check(age>=-60n&&age<=180n,'Lending block is stale. Refresh your wallet provider.');return value;
 }
 const before=validateBlock(await lease.request('eth_getBlockByNumber',[block,false]));
 const call=async(to,data)=>{lease.assertCurrent();const result=await lease.request('eth_call',[{to,data},block]);lease.assertCurrent();return result;};
 const code=await lease.request('eth_getCode',[pool,block]);check(typeof code==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(code),'Lending pool is unavailable.');
 const provider=contract(await call(pool,selectors.provider));
 check(contract(await call(provider,selectors.pool))===pool,'Lending pool changed.');
 const oracle=contract(await call(provider,selectors.oracle));
 const [currency]=words(await call(oracle,selectors.currency),1),[unit]=words(await call(oracle,selectors.unit),1);
 check(currency===0n&&unit===100000000n,'Unsupported lending base currency.');
 const [collateral,debt,power,threshold,ltv,health]=words(await call(pool,selectors.account+walletAddress.slice(2).padStart(64,'0')),6);
 check(threshold<=10000n&&ltv<=10000n,'Invalid lending account ratios.');
 const after=validateBlock(await lease.request('eth_getBlockByNumber',[block,false]));check(after.hash===before.hash,'Lending block changed. Read the account again.');await identity();
 return Object.freeze({address:walletAddress,chainId,pool,oracle,block,blockHash:after.hash,blockTime:Number(BigInt(after.timestamp))*1000,observedAt:Date.now(),currency:'USD',
  collateral:decimal(collateral,8),debt:decimal(debt,8),borrowingPower:decimal(power,8),healthFactor:debt===0n?null:decimal(health,18),liquidationRisk:debt>0n&&health<10n**18n});
}
