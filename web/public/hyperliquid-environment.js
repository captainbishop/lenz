// HyperCore has its own signing domain; the wallet's selected EVM chain is separate.
export const HYPERLIQUID=Object.freeze({
  environment:'testnet',chainId:'hypercore:testnet',name:'HyperCore testnet',
  api:'https://api.hyperliquid-testnet.xyz',
  info:'https://api.hyperliquid-testnet.xyz/info',
  socket:'wss://api.hyperliquid-testnet.xyz/ws',orderSource:'b',
  app:'https://app.hyperliquid-testnet.xyz/trade',faucet:'https://app.hyperliquid-testnet.xyz/drip',
  catalogKey:'lenz-hyperliquid-testnet-catalog-v2',
  ordersKey:'lenz-hyperliquid-testnet-orders-v2',
  lendingKey:'lenz-hyperliquid-testnet-lending-v2',
  predictionsKey:'lenz-prediction-testnet-snapshots-v2',
});
export function checkedHyperliquidDomain(value){
  if(value?.environment!==HYPERLIQUID.environment||value?.chainId!==HYPERLIQUID.chainId)throw Error('Hyperliquid network changed. Refresh the testnet market.');
  return value;
}
