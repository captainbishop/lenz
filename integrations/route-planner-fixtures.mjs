// Synthetic examples only. Addresses, assets and amounts are not deployment data.
export const NOW = 1800000000000;
const near = {chainId:'near:mainnet',kind:'nep141',id:'fixture-token.near',decimals:6};
const base = {chainId:'eip155:8453',kind:'erc20',id:'0x1111111111111111111111111111111111111111',decimals:6};
const output = {...base,id:'0x2222222222222222222222222222222222222222'};
const venue = {chainId:'hypercore:mainnet',kind:'venue',id:'USDC',decimals:6};
const owner = '0x3333333333333333333333333333333333333333';
const fee = asset => ({asset,amount:'1000'});
const limits = {deadline:NOW+600000,minReceive:'900000',maxFees:[fee(near),fee(base)]};
export const examples = {
  'near-evm-return': {id:'fixture-spot-return',source:{asset:near,amount:'1000000'},destination:{marketId:'uniswap',chainId:base.chainId,action:'swap',outputAsset:output},recipient:{chainId:base.chainId,address:owner},limits,privacy:'private',returnTo:{asset:near,address:'fixture-receiver.near',minAmount:'800000'}},
  'aave-position': {id:'fixture-credit',source:{asset:base,amount:'1000000'},destination:{marketId:'aave',chainId:base.chainId,action:'supply',outputAsset:output},recipient:{chainId:base.chainId,address:owner},limits:{...limits,maxFees:[fee(base)]},privacy:'private',returnTo:null},
  'hyperliquid-order': {id:'fixture-order',source:{asset:venue,amount:'1000000'},destination:{marketId:'hyperliquid',chainId:venue.chainId,action:'place-order',order:{instrument:'ETH-PERP',side:'buy',size:'10000',limitPrice:'300000',maxLeverage:2,reduceOnly:false}},recipient:{chainId:venue.chainId,address:owner},limits:{...limits,minReceive:'0',maxFees:[fee(venue)]},privacy:'private',returnTo:null},
};
