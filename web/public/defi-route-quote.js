import {HYPERLIQUID} from './hyperliquid-environment.js';
import {routeObjective} from './defi-route-plan.js';
import {immutable} from './defi-catalog.js';
import {checkedMarketQuote,decimalUnits,requireQuote as check} from './market-quote.js';

const base='eip155:8453',hypercore=HYPERLIQUID.chainId;
export const QUOTE_ASSETS=immutable({USDC:{chainId:base,kind:'erc20',id:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',decimals:6},WETH:{chainId:base,kind:'erc20',id:'0x4200000000000000000000000000000000000006',decimals:18}});
const tokens=QUOTE_ASSETS;
const sameAsset=(a,b)=>a&&['chainId','kind','id','decimals'].every(k=>a[k]===b[k]);
export function objectiveInput(objective){
  const {version,kind,...input}=objective;
  check(version===1&&kind==='lenz-route-objective','Invalid saved objective.');return input;
}

// Matching an unauthenticated read-only estimate is never execution authority.
export function bindRouteQuote(input,value,{now=Date.now()}={}){
  const objective=routeObjective(input,{now});
  check(objective.privacy==='transparent','A private route cannot use a public estimate.');
  check(JSON.stringify(value).length<=16384,'Estimate is too large.');
  const quote=checkedMarketQuote(value,value?.request,{now}),r=quote.result,d=objective.destination;
  check(quote.observedAt>=0&&quote.observedAt<=now,'Estimate has not been observed yet.');
  check(objective.source.asset.chainId===d.chainId&&objective.returnTo===null,'Funding and return routes need separate verified quotes.');
  check(d.marketId===quote.request.provider,'Estimate provider differs from the route.');
  let matched;
  if(d.marketId==='uniswap'){
    check(d.chainId===base&&d.action==='swap','Estimate requires a Base swap.');
    check(sameAsset(objective.source.asset,tokens[r.inputSymbol])&&sameAsset(d.outputAsset,tokens[r.outputSymbol]),'Estimate assets differ from the route.');
    check(objective.source.amount===r.inputUnits,'Estimate input differs from the spend bound.');
    check(BigInt(r.minOutputUnits)>=BigInt(objective.limits.minReceive),'Estimate minimum is below the route minimum.');
    matched=['provider','pool','chain','input-asset','output-asset','exact-input','minimum-output'];
  }else{
    check(d.chainId===hypercore&&d.action==='place-order','Estimate requires a HyperCore order.');
    check(sameAsset(objective.source.asset,{chainId:hypercore,kind:'venue',id:'USDC',decimals:6}),'Unsupported collateral asset.');
    const o=d.order;
    check(o.sizeDecimals===r.sizeDecimals&&o.priceDecimals===6,'Order precision must match the estimate.');
    check(o.instrument===r.instrument&&o.side===quote.request.side&&o.size===r.sizeUnits,'Estimate order differs from the route.');
    const worst=decimalUnits(r.worstPrice,6),limit=BigInt(o.limitPrice);
    check(o.side==='buy'?worst<=limit:worst>=limit,'Estimate exceeds the order price limit.');
    matched=['provider','instrument','chain','side','size','size-precision','price-limit'];
  }
  return immutable({version:1,kind:'lenz-route-quote-match',objective,quote,matched,checkedAt:now,expiresAt:Math.min(objective.limits.deadline,quote.expiresAt),executable:false,
    unverified:['provider-authenticity','recipient-control','balances-and-allowances','total-fees','signing-and-execution','finality-and-recovery',...(d.marketId==='hyperliquid'?['collateral-sufficiency','margin-and-leverage','reduce-only-and-position','order-size-rules']:[])]});
}
