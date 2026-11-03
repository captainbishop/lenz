import {QUOTE_POOL,decimalUnits,formatUnits,requireQuote as check} from './market-quote.js';
import {immutable} from './defi-catalog.js';
export function checkedPoolPrice(value,{now=Date.now(),cached=false}={}){
  check(value?.kind==='pool-price'&&value.marketId===QUOTE_POOL&&value.source==='https://mainnet.base.org'&&value.executable===false,'Wrong pool price.');
  check(typeof value.sqrtPriceX96==='string'&&/^[1-9][0-9]{0,48}$/.test(value.sqrtPriceX96),'Invalid pool price.');
  const sqrt=BigInt(value.sqrtPriceX96);check(sqrt>4295128739n&&sqrt<1461446703485210103287273052203988822378723970342n,'Invalid pool price.');
  check(Number.isSafeInteger(value.observedAt)&&Number.isSafeInteger(value.sourceTime)&&value.sourceTime<=value.observedAt+5000&&value.sourceTime>=value.observedAt-60000&&value.observedAt<=now+5000,'Invalid price time.');
  check(cached||value.sourceTime>now-60000,'Price expired.');
  check(typeof value.blockNumber==='string'&&/^[1-9][0-9]{0,19}$/.test(value.blockNumber)&&/^0x[0-9a-f]{64}$/i.test(value.blockHash),'Invalid price block.');
  return immutable({kind:value.kind,marketId:QUOTE_POOL,source:value.source,sqrtPriceX96:value.sqrtPriceX96,sourceTime:value.sourceTime,observedAt:value.observedAt,blockNumber:value.blockNumber,blockHash:value.blockHash,executable:false});
}
export function poolReceive(price,amount,side){
  check(['usdc-to-weth','weth-to-usdc'].includes(side),'Invalid swap direction.');
  const input=decimalUnits(amount,side==='usdc-to-weth'?6:18),sqrt=BigInt(price.sqrtPriceX96),ratio=sqrt*sqrt,scale=1n<<192n,net=input*999500n/1000000n;
  const output=side==='usdc-to-weth'?net*scale/ratio:net*ratio/scale;
  return formatUnits(output,side==='usdc-to-weth'?18:6);
}
