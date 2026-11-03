// Integration scope, not a list of connected markets or verified deployments.
export function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export const CHAINS = immutable({
  'eip155:1': { name:'Ethereum', family:'evm', network:'mainnet' },
  'eip155:8453': { name:'Base', family:'evm', network:'mainnet' },
  'eip155:42161': { name:'Arbitrum', family:'evm', network:'mainnet' },
  'eip155:1313161554': { name:'Aurora', family:'evm', network:'mainnet' },
  'eip155:998': { name:'HyperEVM testnet', family:'evm', network:'testnet' },
  'eip155:999': { name:'HyperEVM', family:'evm', network:'mainnet' },
  'near:mainnet': { name:'NEAR', family:'near', network:'mainnet' },
  'near:testnet': { name:'NEAR testnet', family:'near', network:'testnet' },
  // Local venue identifiers; these do not imply an EVM signing interface.
  'hypercore:mainnet': { name:'HyperCore', family:'hypercore', network:'mainnet' },
  'hypercore:testnet': { name:'HyperCore testnet', family:'hypercore', network:'testnet' },
});
export const MARKETS = immutable([
  { id:'uniswap', name:'Uniswap', family:'evm', categories:['spot','liquidity'], actions:['swap','add-liquidity','remove-liquidity','collect-fees'], source:'https://docs.uniswap.org/', status:'integration-target' },
  { id:'aave', name:'Aave', family:'evm', categories:['credit'], actions:['supply','withdraw','borrow','repay'], source:'https://aave.com/docs', status:'integration-target' },
  { id:'hyperliquid', name:'Hyperliquid', family:'hypercore', categories:['perpetuals','margin'], actions:['place-order','modify-order','cancel-order','reduce-position','close-position','deposit-margin','withdraw-margin'], source:'https://hyperliquid.gitbook.io/hyperliquid-docs/', status:'integration-target' },
  { id:'rhea', name:'Rhea', family:'near', categories:['spot','credit','liquidity'], actions:['swap','supply','withdraw','borrow','repay','add-liquidity','remove-liquidity'], source:'https://docs.rhea.finance/', status:'public-testnet-swap-only' },
]);
export const STRATEGY_SCOPE = immutable(['spot','credit','liquidity','perpetuals','margin','staking','restaking','farming','rewards','speculative-token-trading','further-strategies']);
export function discoverMarkets({ category, family } = {}) {
  return MARKETS.filter(m => (!category || m.categories.includes(category)) && (!family || m.family === family));
}
