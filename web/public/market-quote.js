import {immutable} from './defi-catalog.js';
export const QUOTE_POOL='uniswap:0xd0b53d9277642d899df5c87a3966a349a798f224';
export const requireQuote=(ok,message)=>{if(!ok)throw Error(message);};
const check=requireQuote;
export function canonicalAmount(value){
  check(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/.test(value),'Enter a decimal amount.');
  return value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
}
export function decimalUnits(value,decimals){
  check(Number.isInteger(decimals)&&decimals>=0&&decimals<=18,'Unsupported precision.');
  const [whole,fraction='']=canonicalAmount(value).split('.');
  check(fraction.length<=decimals,`Use at most ${decimals} decimal places.`);
  const units=BigInt(whole+fraction.padEnd(decimals,'0'));
  check(units>0n&&units<2n**128n,'Amount is outside the preview range.');return units;
}
export function formatUnits(value,decimals){
  const digits=String(value).padStart(decimals+1,'0');
  return decimals?canonicalAmount(digits.slice(0,-decimals)+'.'+digits.slice(-decimals)):digits;
}
export function marketQuoteRequest(value){
  check(value&&Object.getPrototypeOf(value)===Object.prototype,'Invalid quote request.');
  check(['uniswap','hyperliquid'].includes(value.provider),'Quotes unavailable for this market.');
  const swap=value.provider==='uniswap',keys=['provider','marketId','side','amount','privacy',...(swap?['slippageBps']:[])];
  check(Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Unexpected quote fields.');
  check(value.privacy==='public','Public quote consent required.');
  check(swap?value.marketId===QUOTE_POOL:typeof value.marketId==='string'&&/^hyperliquid:(?:0|[1-9][0-9]{0,3}):[A-Za-z0-9][A-Za-z0-9:._/-]{0,39}$/.test(value.marketId),'Unsupported market identity.');
  check((swap?['usdc-to-weth','weth-to-usdc']:['buy','sell']).includes(value.side),'Invalid quote direction.');
  const amount=canonicalAmount(value.amount);decimalUnits(amount,swap?(value.side==='usdc-to-weth'?6:18):18);
  if(swap)check(Number.isInteger(value.slippageBps)&&value.slippageBps>=0&&value.slippageBps<=500,'Slippage must be between 0 and 5%.');
  return immutable({provider:value.provider,marketId:value.marketId,side:value.side,amount,privacy:'public',...(swap?{slippageBps:value.slippageBps}:{})});
}
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value);
export function checkedMarketQuote(value,expected,{now=Date.now()}={}){
  const request=marketQuoteRequest(expected),swap=request.provider==='uniswap';
  check(value?.version===1&&value.kind==='market-quote-preview'&&value.executable===false,'Invalid quote preview.');
  check(JSON.stringify(marketQuoteRequest(value.request))===JSON.stringify(request),'Quote terms changed.');
  check(Number.isSafeInteger(value.observedAt)&&value.observedAt<=now+5000&&Number.isSafeInteger(value.sourceTime)&&value.sourceTime>=0&&value.sourceTime<=now+5000,'Invalid quote time.');
  check(Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&value.expiresAt>value.observedAt&&value.expiresAt<=value.observedAt+30000&&value.expiresAt<=value.sourceTime+(swap?60000:30000),'Quote expired.');
  check(value.evidence?.source===(swap?'https://mainnet.base.org':'https://api.hyperliquid.xyz/info'),'Quote source changed.');
  const r=value.result;
  if(swap){
    const input=request.side==='usdc-to-weth'?'USDC':'WETH',output=input==='USDC'?'WETH':'USDC';
    check(r?.inputSymbol===input&&r.outputSymbol===output&&r.inputDecimals===(input==='USDC'?6:18)&&r.outputDecimals===(output==='USDC'?6:18),'Quote assets changed.');
    check(r.inputUnits===decimalUnits(request.amount,r.inputDecimals).toString()&&positive(r.outputUnits)&&positive(r.minOutputUnits)&&positive(r.gasUnits)&&r.feePips===500,'Invalid quote amounts.');
    check(BigInt(r.minOutputUnits)===BigInt(r.outputUnits)*BigInt(10000-request.slippageBps)/10000n,'Quote minimum changed.');
    check(value.evidence.assurance==='rpc-latest-block'&&/^0x[0-9a-f]{64}$/i.test(value.evidence.blockHash)&&/^[0-9]+$/.test(value.evidence.blockNumber),'Invalid quote block.');
  }else{
    check(r?.instrument===request.marketId.split(':').slice(2).join(':')&&Number.isInteger(r.sizeDecimals)&&r.sizeDecimals>=0&&r.sizeDecimals<=6,'Quote instrument changed.');
    check(r.sizeUnits===decimalUnits(request.amount,r.sizeDecimals).toString()&&r.notionalDecimals===6&&positive(r.notionalUnits)&&r.fullDepth===true&&Number.isInteger(r.levelsUsed)&&r.levelsUsed>=1&&r.levelsUsed<=20,'Incomplete order-book estimate.');
    decimalUnits(r.worstPrice,6);
  }
  return immutable(structuredClone(value));
}
