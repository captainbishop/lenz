import {immutable} from './defi-catalog.js';
// Reviewed Chainlink proxy addresses/heartbeats, 2026-11-04. See docs/oracle-prices.md.
export const ORACLE_NETWORKS=immutable({
  ethereum:{name:'Ethereum',chainId:1,rpc:'https://ethereum-rpc.publicnode.com',explorer:'https://etherscan.io/address/',period:15000},
  arbitrum:{name:'Arbitrum',chainId:42161,rpc:'https://arb1.arbitrum.io/rpc',explorer:'https://arbiscan.io/address/',period:15000,sequencer:'0xfdb631f5ee196f0ed6faa767959853a9f217697d'},
  base:{name:'Base',chainId:8453,rpc:'https://mainnet.base.org',explorer:'https://basescan.org/address/',period:15000,sequencer:'0xbcf85224fc0756b9fa45aa7892530b47e10b6433'},
  hyperevm:{name:'HyperEVM',chainId:999,rpc:'https://rpc.hyperliquid.xyz/evm',explorer:'https://hyperevmscan.io/address/',period:30000},
});
const entries=[
  ['ethereum','BTC','0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',3600],
  ['ethereum','ETH','0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',3600],
  ['ethereum','LINK','0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',3600],
  ['ethereum','USDC','0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',82800],
  ['arbitrum','BTC','0x6ce185860a4963106506C203335A2910413708e9',1755],
  ['arbitrum','ETH','0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',1755],
  ['arbitrum','LINK','0x86E53CF1B870786351Da77A57575e79CB55812CB',1755],
  ['arbitrum','USDC','0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',255],
  ['arbitrum','NEAR','0xBF5C3fB2633e924598A46B9D07a174a9DBcF57C0',86400],
  ['arbitrum','HYPE','0xf9ce4fE2F0EcE0362cb416844AE179a49591D567',86400],
  ['base','BTC','0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F',1200],
  ['base','ETH','0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',1200],
  ['base','LINK','0x17CAb8FE31E32f08326e5E27412894e49B0f9D65',86400],
  ['base','USDC','0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',86400],
  ['hyperevm','BTC','0x71A2017296De30F4597B36FBD90b7e8Ec6E97A82',86400],
  ['hyperevm','ETH','0x017151e74fB3a393673B5B5149F53578c0Fa55B0',86400],
  ['hyperevm','USDC','0xA0Adc43ce7AfE3EE7d7eac3C994E178D0620223B',86400],
  ['hyperevm','HYPE','0xa5a72eF19F82A579431186402425593a559ed352',86400],
];
export const ORACLE_FEEDS=immutable(entries.map(([network,asset,address,heartbeat])=>({id:network+':'+asset,network,asset,address:address.toLowerCase(),heartbeat,decimals:8,description:asset+' / USD'})));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const uint=(v,bits=256)=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<(1n<<BigInt(bits));
export function oracleRequest(input){check(exact(input,['network'])&&Object.hasOwn(ORACLE_NETWORKS,input.network),'Unsupported price network');return immutable({network:input.network});}
export function oracleSnapshot(value,{now=Date.now(),cached=false}={}){
  check(exact(value,['version','kind','network','chainId','source','observedAt','blockNumber','blockHash','blockTime','sequencer','feeds','executable']),'Invalid oracle snapshot');
  check(Object.hasOwn(ORACLE_NETWORKS,value.network),'Unknown oracle network');
  const network=ORACLE_NETWORKS[value.network];check(value.version===1&&value.kind==='oracle-prices'&&value.chainId===network.chainId&&value.source===network.rpc&&value.executable===false,'Wrong oracle network or authority');
  check(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000&&(cached||now-value.observedAt<60000),'Stale oracle read');
  check(uint(value.blockNumber)&&/^0x[0-9a-f]{64}$/.test(value.blockHash)&&Number.isSafeInteger(value.blockTime)&&value.blockTime>0&&value.blockTime<=value.observedAt+5000&&value.observedAt-value.blockTime<60000,'Invalid oracle block');
  if(network.sequencer){const s=value.sequencer;check(exact(s,['address','answer','startedAt','updatedAt'])&&s.address===network.sequencer&&s.answer==='0'&&Number.isSafeInteger(s.startedAt)&&s.startedAt>0&&Number.isSafeInteger(s.updatedAt)&&s.updatedAt>=s.startedAt&&s.updatedAt<=value.blockTime+5000&&value.blockTime-s.startedAt>3600000,'Network price check unavailable');}
  else check(value.sequencer===null,'Unexpected sequencer');
  const expected=ORACLE_FEEDS.filter(f=>f.network===value.network);check(Array.isArray(value.feeds)&&value.feeds.length===expected.length,'Incomplete oracle coverage');
  const seen=new Set();
  for(const row of value.feeds){
    const f=expected.find(f=>f.id===row.id);check(f&&!seen.has(row.id),'Unknown or duplicate oracle');seen.add(row.id);
    if(row.status==='unavailable'){check(exact(row,['id','status']),'Invalid unavailable oracle');continue;}
    check(exact(row,['id','status','address','decimals','description','answer','roundId','answeredInRound','startedAt','updatedAt'])&&row.status==='current'&&row.address===f.address&&row.decimals===f.decimals&&row.description===f.description,'Wrong oracle identity');
    check(uint(row.answer,255)&&BigInt(row.answer)>0n&&uint(row.roundId,80)&&BigInt(row.roundId)>0n&&uint(row.answeredInRound,80)&&BigInt(row.answeredInRound)>=BigInt(row.roundId),'Invalid oracle answer');
    check(Number.isSafeInteger(row.updatedAt)&&row.updatedAt>0&&Number.isSafeInteger(row.startedAt)&&row.startedAt>0&&row.startedAt<=row.updatedAt&&row.updatedAt<=value.blockTime+5000&&row.updatedAt<=value.observedAt+5000&&value.observedAt-row.updatedAt<=f.heartbeat*1000,'Stale oracle answer');
  }
  return immutable(structuredClone(value));
}
export function oracleDecimal(row){const v=row.answer.padStart(row.decimals+1,'0');return v.slice(0,-row.decimals)+'.'+v.slice(-row.decimals);}
export function oracleState(snapshot,row,{now=Date.now(),online=true,saved=false}={}){
  if(!row||row.status!=='current')return 'Unavailable';
  if(!online)return 'Offline · Saved';
  const f=ORACLE_FEEDS.find(f=>f.id===row.id);
  if(saved||now-snapshot.observedAt>=60000||now-row.updatedAt>f.heartbeat*1000)return 'Earlier price';
  return 'Updated';
}
