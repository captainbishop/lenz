import {checkedMarketQuote,canonicalAmount,decimalUnits,requireQuote as check} from './market-quote.js';
import {QUOTE_ASSETS,bindRouteQuote,objectiveInput} from './defi-route-quote.js';

// Only the explicit review fields can become a saved objective. No wallet inference.
export function draftFromQuote(value,terms,{now=Date.now()}={}){
  check(terms.publicRoute===true,'Allow a public route to save this estimate.');
  const quote=checkedMarketQuote(value,value.request,{now}),swap=quote.request.provider==='uniswap',r=quote.result;
  check([3600000,86400000].includes(terms.duration),'Choose a review period.');
  const chainId=swap?'eip155:8453':'hypercore:mainnet',collateral={chainId,kind:'venue',id:'USDC',decimals:6};
  const fee=canonicalAmount(terms.fee)==='0'?'0':decimalUnits(terms.fee,swap?18:6).toString();
  const objective={id:terms.id,source:{asset:swap?QUOTE_ASSETS[r.inputSymbol]:collateral,amount:swap?r.inputUnits:decimalUnits(terms.collateral,6).toString()},
    destination:{marketId:quote.request.provider,chainId,action:swap?'swap':'place-order',...(swap?{outputAsset:QUOTE_ASSETS[r.outputSymbol]}:{order:{instrument:r.instrument,side:quote.request.side,size:r.sizeUnits,sizeDecimals:r.sizeDecimals,priceDecimals:6,limitPrice:decimalUnits(terms.limitPrice,6).toString(),maxLeverage:terms.leverage,reduceOnly:terms.reduceOnly}})},
    recipient:{chainId,address:terms.address.trim()},limits:{deadline:now+terms.duration,minReceive:swap?r.minOutputUnits:'0',maxFees:[{asset:swap?{chainId,kind:'native',id:'native',decimals:18}:collateral,amount:fee}]},privacy:'transparent',returnTo:null};
  return objectiveInput(bindRouteQuote(objective,quote,{now}).objective);
}
