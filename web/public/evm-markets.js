import {HYPERLIQUID} from './hyperliquid-environment.js';
import {immutable,CHAINS} from './defi-catalog.js';
// Reviewed deployment identities; source links and limits: docs/market-discovery.md.
const token=(chainId,id,symbol,decimals)=>({chainId,kind:'erc20',id,symbol,decimals});
export const EVM_MARKETS=immutable({
  base:{chainId:'eip155:8453',rpc:'https://mainnet.base.org',factory:'0x33128a8fc17869897dce68ed026d694621f6fdfd',aavePool:'0xa238dd80c259a72e81d7e4664a9801593f98d1c5',tokens:[token('eip155:8453','0x4200000000000000000000000000000000000006','WETH',18),token('eip155:8453','0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','USDC',6)]},
  ethereum:{chainId:'eip155:1',rpc:'https://ethereum-rpc.publicnode.com',factory:'0x1f98431c8ad98523631ae4a59f267346ea31f984',aavePool:'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',tokens:[token('eip155:1','0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2','WETH',18),token('eip155:1','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','USDC',6)]},
  arbitrum:{chainId:'eip155:42161',rpc:'https://arb1.arbitrum.io/rpc',factory:'0x1f98431c8ad98523631ae4a59f267346ea31f984',aavePool:'0x794a61358d6845594f94dc1db02a252b5b4814ad',tokens:[token('eip155:42161','0x82af49447d8a07e3bd95bd0d56f35241523fbab1','WETH',18),token('eip155:42161','0xaf88d065e77c8cc2239327c5edb3a432268e5831','USDC',6)]},
});
export function marketNetwork(network='base'){
  if(!Object.hasOwn(EVM_MARKETS,network))throw Error('Unsupported market network');
  return EVM_MARKETS[network];
}
export const MARKET_SOURCES=immutable([
  ...['base','ethereum','arbitrum'].flatMap(network=>['uniswap','aave'].map(provider=>({key:network==='base'?provider:provider+':'+network,provider,network,chainId:EVM_MARKETS[network].chainId,name:(provider==='uniswap'?'Uniswap':'Aave')+' · '+CHAINS[EVM_MARKETS[network].chainId].name}))),
  {key:'hyperliquid',provider:'hyperliquid',chainId:HYPERLIQUID.chainId,name:'Hyperliquid · HyperCore testnet'},
]);
export function marketSource(snapshot){
  const source=MARKET_SOURCES.find(s=>s.provider===snapshot.provider&&s.chainId===snapshot.chainId);
  if(!source)throw Error('Unsupported market source');return source;
}
export function marketReadRequest(input){
  if(!input||Object.keys(input).some(k=>!['provider','network'].includes(k))||!['uniswap','aave','hyperliquid'].includes(input.provider))throw Error('Choose a discovery provider');
  if(input.provider==='hyperliquid'){if(Object.hasOwn(input,'network'))throw Error('Unexpected venue network');return immutable({provider:input.provider});}
  const network=input.network??'base';marketNetwork(network);return immutable({provider:input.provider,network});
}
