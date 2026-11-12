import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EVM_MARKETS} from './public/evm-markets.js';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
export const abi=new Interface([
 'function ADDRESSES_PROVIDER() view returns(address)', 'function getPool() view returns(address)', 'function getAddress(bytes32) view returns(address)',
 'function getConfiguration(address) view returns(uint256)', 'function getUserConfiguration(address) view returns(uint256)',
 'function getReserveAddressById(uint16) view returns(address)',
 'function getReserveData(address) view returns((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))',
 'function POOL() view returns(address)', 'function UNDERLYING_ASSET_ADDRESS() view returns(address)', 'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)',
]);
export const wallet='0x'+'12'.repeat(20),provider='0x2f39d218133afab8f2b819b1066c7e434ad94e9e',aToken='0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',variableToken='0x72e95b8931767c79ba4eee721354d6e99a61d004',stableToken='0x'+'90'.repeat(20),blockHash='0x'+'ab'.repeat(32),zero='0x'+'00'.repeat(20);
export function positionFixture(network='ethereum',assetIndex=1){
 const market=EVM_MARKETS[network],asset=market.tokens[assetIndex],chainId='0x'+BigInt(market.chainId.split(':')[1]).toString(16),calls=[];
 const bindings={ethereum:[provider,[['0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8','0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe'],[aToken,variableToken]]],base:['0xe20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d',[['0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7','0x24e6e0795b3c7c71d965fcc4f371803d1c1dca1e'],['0x4e65fe4dba92790696d040ac24aa414708f5c0ab','0x59dca05b6c26dbd64b5381374aaac5cd05644c28']]],arbitrum:['0xa97684ead0e402dc232d5a977953df7ecbab3cdb',[['0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8','0x0c84331e39d6658cd6e6b9ba04736cc4c4734351'],['0x724dc807b04555b71ed48a6896b6f41593b8c637','0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6']]]},[poolProvider,tokens]=bindings[network],[supplyToken,debtToken]=tokens[assetIndex];
 const row={marketId:'aave',category:'credit',chainId:market.chainId,address:market.aavePool,assets:[asset]};
 const state={changed:false,stableMock:true,stable:stableToken,collateral:true,config:BigInt(asset.decimals)<<48n|1n<<56n,blockTime:Math.floor(Date.now()/1000)-900,hook:null};
 const lease={identity:{address:wallet,chainId},assertCurrent(){assert(!state.changed,'Wallet changed.');},async request(method,params=[]){
  calls.push({method,params});const hooked=await state.hook?.(method,params);if(hooked!==undefined)return hooked;
  if(method==='eth_accounts')return[wallet];if(method==='eth_chainId')return chainId;
  if(method==='eth_blockNumber')return '0x2a';if(method==='eth_getBalance')return '0x0';
  if(method==='eth_getBlockByNumber')return {number:'0x2a',hash:blockHash,timestamp:'0x'+state.blockTime.toString(16)};
  if(method==='eth_getCode')return '0x1234';
  assert.equal(method,'eth_call');assert.deepEqual(params[1],{blockHash,requireCanonical:true});
  const p=abi.parseTransaction({data:params[0].data}),name=p.name,to=params[0].to;
  const expected=['ADDRESSES_PROVIDER','getReserveData','getConfiguration','getUserConfiguration','getReserveAddressById'].includes(name)?market.aavePool:['getPool','getAddress'].includes(name)?poolProvider:to;
  assert.equal(to,expected);
  if(['getReserveData','getConfiguration'].includes(name))assert.equal(p.args[0].toLowerCase(),asset.id);
  if(['getUserConfiguration','balanceOf'].includes(name))assert.equal(p.args[0].toLowerCase(),wallet);
  const supply=assetIndex===0?1250500000000000000000n:1250500000n,debt=assetIndex===0?205000000000000000000n:205000000n;
  const values={ADDRESSES_PROVIDER:[poolProvider],getPool:[market.aavePool],getAddress:[state.stableMock?state.stable:zero],getConfiguration:[state.config],getUserConfiguration:[state.collateral?1n<<7n:0n],getReserveAddressById:[asset.id],getReserveData:[[state.config,10n**27n,0n,10n**27n,0n,0n,0n,3n,supplyToken,state.stable,debtToken,zero,0n,0n,0n]],POOL:[market.aavePool],UNDERLYING_ASSET_ADDRESS:[asset.id],decimals:[asset.decimals],balanceOf:[to===supplyToken?supply:to===debtToken?debt:10000000n]};
  return abi.encodeFunctionResult(name,values[name]);
 }};return{lease,row,state,calls};
}
