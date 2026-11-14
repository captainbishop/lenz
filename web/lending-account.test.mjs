import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readLendingAccount} from './public/lending-account.js';
const {Interface,MaxUint256}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const abi=new Interface(['function ADDRESSES_PROVIDER() view returns(address)','function getPool() view returns(address)','function getPriceOracle() view returns(address)','function BASE_CURRENCY() view returns(address)','function BASE_CURRENCY_UNIT() view returns(uint256)','function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)']);
const from='0x'+'12'.repeat(20),provider='0x'+'34'.repeat(20),oracle='0x'+'56'.repeat(20),zero='0x'+'00'.repeat(20),blockHash='0x'+'ab'.repeat(32);
const pools={'0x1':'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2','0x2105':'0xa238dd80c259a72e81d7e4664a9801593f98d1c5','0xa4b1':'0x794a61358d6845594f94dc1db02a252b5b4814ad'};
function fixture(chainId='0x1'){
 const calls=[],state={currency:zero,unit:100000000n,data:[125050000000n,50000000000n,45000000000n,8000n,7600n,2000800000000000000n],stale:false,hook:null};
 const lease={identity:{address:from,chainId},assertCurrent(){assert(!state.stale,'Wallet changed');},async request(method,params){
  calls.push({method,params});if(state.hook){const value=await state.hook(method,params);if(value!==undefined)return value;}
  if(method==='eth_accounts')return [from];if(method==='eth_chainId')return chainId;if(method==='eth_blockNumber')return '0x2a';
  if(method==='eth_getBlockByNumber')return {number:'0x2a',hash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)};
  if(method==='eth_getCode')return '0x1234';
  assert.equal(method,'eth_call');assert.equal(params[1],'0x2a');const parsed=abi.parseTransaction({data:params[0].data}),name=parsed.name;
  const expectedTo=name==='ADDRESSES_PROVIDER'||name==='getUserAccountData'?pools[chainId]:name==='getPool'||name==='getPriceOracle'?provider:oracle;assert.equal(params[0].to,expectedTo);
  if(name==='getUserAccountData')assert.equal(parsed.args[0].toLowerCase(),from);
  const values={ADDRESSES_PROVIDER:[provider],getPool:[pools[chainId]],getPriceOracle:[oracle],BASE_CURRENCY:[state.currency],BASE_CURRENCY_UNIT:[state.unit],getUserAccountData:state.data};
  return abi.encodeFunctionResult(name,values[name]);
 }};return {lease,calls,state};
}
for(const chain of Object.keys(pools))test('reads exact account and oracle units at one canonical block on '+chain,async()=>{
 const f=fixture(chain),result=await readLendingAccount(f.lease);
 assert.equal(result.collateral,'1250.5');assert.equal(result.debt,'500');assert.equal(result.borrowingPower,'450');assert.equal(result.healthFactor,'2.0008');assert.equal(result.currency,'USD');assert.equal(result.address,from);assert.equal(result.pool,pools[chain]);assert.equal(result.blockHash,blockHash);
 assert(!f.calls.some(c=>/send|sign|switch/i.test(c.method)));
});
test('zero debt has no health factor and is distinct from a failed read',async()=>{const f=fixture();f.state.data=[0n,0n,0n,0n,0n,MaxUint256];assert.equal((await readLendingAccount(f.lease)).healthFactor,null);f.state.hook=method=>{if(method==='eth_call')throw Error('RPC unavailable');};await assert.rejects(readLendingAccount(f.lease),/RPC unavailable/);});
test('rejects unsupported chains before any provider read',async()=>{const f=fixture('0x89');await assert.rejects(readLendingAccount(f.lease),/supported/);assert.equal(f.calls.length,0);});
test('checks returned currency and decimals before assigning USD',async()=>{for(const change of [{currency:oracle},{unit:10n**18n}]){const f=fixture();Object.assign(f.state,change);await assert.rejects(readLendingAccount(f.lease),/currency/);}});
test('rejects malformed and padded ABI data, zero provider and pool mismatch',async()=>{for(const replacement of ['0x','0x'+'00'.repeat(32),'0x'+'ff'.repeat(64),abi.encodeFunctionResult('getPool',[oracle])]){const f=fixture();f.state.hook=(m,p)=>m==='eth_call'&&p[0].data===abi.getFunction('getPool').selector?replacement:undefined;await assert.rejects(readLendingAccount(f.lease));}});
test('rejects stale wallet and silently changed account or chain',async()=>{for(const method of ['eth_accounts','eth_chainId','eth_blockNumber']){const f=fixture();f.state.hook=m=>{if(m!==method)return;if(m==='eth_accounts')return [oracle];if(m==='eth_chainId')return '0x2105';f.state.stale=true;};await assert.rejects(readLendingAccount(f.lease),/changed/);}});
test('rejects changed canonical block and stale block time',async()=>{for(const stale of [false,true]){const f=fixture();let blocks=0;f.state.hook=m=>{if(m==='eth_getBlockByNumber'){blocks++;return {number:'0x2a',hash:!stale&&blocks>1?'0x'+'cd'.repeat(32):blockHash,timestamp:'0x'+(Math.floor(Date.now()/1000)-(stale?3600:0)).toString(16)};}};await assert.rejects(readLendingAccount(f.lease),/block/i);}});
test('invalid account data cannot masquerade as an empty position',async()=>{for(const data of [[1n,1n,1n,10001n,7600n,1n],[1n,1n,1n,8000n,10001n,1n]]){const f=fixture();f.state.data=data;await assert.rejects(readLendingAccount(f.lease),/account/);}});
