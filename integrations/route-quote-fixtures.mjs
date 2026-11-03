import {quoteMarket} from './market-quotes.mjs';
import {quoteMock,SWAP,PERP,NOW} from './market-quote-fixtures.mjs';
export {NOW};
export async function routeQuoteFixture(provider='uniswap',side){
  const request=structuredClone(provider==='uniswap'?SWAP:PERP);if(side)request.side=side;
  const quote=await quoteMarket(request,quoteMock()),r=quote.result,base='eip155:8453',venue='hypercore:mainnet';
  const assets={USDC:{chainId:base,kind:'erc20',id:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',decimals:6},WETH:{chainId:base,kind:'erc20',id:'0x4200000000000000000000000000000000000006',decimals:18}};
  const swap=provider==='uniswap',chainId=swap?base:venue,collateral={chainId:venue,kind:'venue',id:'USDC',decimals:6};
  const objective={id:'fixture-route-'+provider,source:{asset:swap?assets[r.inputSymbol]:collateral,amount:swap?r.inputUnits:'1000000'},destination:{marketId:provider,chainId,action:swap?'swap':'place-order',...(swap?{outputAsset:assets[r.outputSymbol]}:{order:{instrument:r.instrument,side:request.side,size:r.sizeUnits,sizeDecimals:r.sizeDecimals,limitPrice:request.side==='buy'?'1100000000':'900000000',priceDecimals:6,maxLeverage:2,reduceOnly:false}})},recipient:{chainId,address:'0x'+'33'.repeat(20)},limits:{deadline:NOW+60000,minReceive:swap?r.minOutputUnits:'0',maxFees:[{asset:swap?{chainId:base,kind:'native',id:'native',decimals:18}:collateral,amount:'1000'}]},privacy:'transparent',returnTo:null};
  return {objective,quote};
}
