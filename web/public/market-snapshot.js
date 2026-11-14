import {HYPERLIQUID} from './hyperliquid-environment.js';
import {marketSource} from './evm-markets.js';
import {immutable} from './defi-catalog.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const boundedText=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const decimal=x=>typeof x==='string'&&/^-?(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,24})?$/.test(x);
export function marketSnapshot(value,{now=Date.now()}={}){
  check(value&&value.version===1&&value.kind==='market-observation'&&value.executable===false,'Invalid market observation');
  check(['uniswap','aave','hyperliquid'].includes(value.provider),'Invalid market provider');
  const chainId=marketSource(value).chainId;
  check(value.chainId===chainId&&value.network===(value.provider==='hyperliquid'?HYPERLIQUID.environment:'mainnet'),'Market chain mismatch');
  check(Number.isSafeInteger(value.observedAt)&&value.observedAt>=0&&value.observedAt<=now+5000&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>value.observedAt&&value.expiresAt<=value.observedAt+60000,'Invalid market observation time');
  check(Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=2000,'Invalid market collection');
  const ids=new Set();
  const rows=value.rows.map(row=>{
    check(row&&boundedText(row.id)&&!ids.has(row.id)&&boundedText(row.label,100)&&row.chainId===chainId&&row.marketId===value.provider&&row.executable===false,'Invalid market row');ids.add(row.id);
    check(['liquidity','credit','perpetuals'].includes(row.category)&&['listed','delisted','paused','frozen','inactive','liquidity-observed','unavailable'].includes(row.status),'Invalid market state');
    if(value.provider==='hyperliquid'){
      check(value.evidence?.source===HYPERLIQUID.info,'Market source changed');
      check(row.category==='perpetuals'&&boundedText(row.instrument,40)&&Number.isSafeInteger(row.venueIndex)&&row.venueIndex>=0&&Number.isInteger(row.sizeDecimals)&&row.sizeDecimals>=0&&row.sizeDecimals<=12&&Number.isInteger(row.maxLeverage)&&row.maxLeverage>=1&&row.maxLeverage<=100&&['markPrice','oraclePrice','funding','openInterest'].every(k=>decimal(row[k])),'Invalid perpetual market');
    }else{
      check(typeof row.address==='string'&&/^0x[0-9a-f]{40}$/.test(row.address)&&Array.isArray(row.assets)&&row.assets.length>=1&&row.assets.length<=2,'Invalid market asset');
      for(const asset of row.assets)check(asset?.chainId===chainId&&asset.kind==='erc20'&&/^0x[0-9a-f]{40}$/.test(asset.id)&&Number.isInteger(asset.decimals)&&asset.decimals>=0&&asset.decimals<=36&&boundedText(asset.symbol,16),'Invalid token identity');
      if(value.provider==='uniswap')check(row.category==='liquidity'&&Number.isInteger(row.feePips)&&row.feePips>=0&&row.feePips<1000000&&typeof row.liquidity==='string'&&/^[0-9]{1,78}$/.test(row.liquidity),'Invalid liquidity market');
      else {
        check(row.category==='credit'&&['active','paused','frozen','borrowingEnabled'].every(k=>typeof row[k]==='boolean')&&Number.isInteger(row.ltvBps)&&row.ltvBps>=0&&row.ltvBps<=10000&&Number.isInteger(row.liquidationThresholdBps)&&row.liquidationThresholdBps>=0&&row.liquidationThresholdBps<=10000,'Invalid credit market');
        for(const key of ['supplyAPY','borrowAPY'])check(row[key]==null||typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0&&row[key]<=100000,'Invalid lending rate');
        for(const key of ['availableLiquidity','totalSupplied','totalBorrowed','supplyCap','borrowCap'])check(row[key]==null||typeof row[key]==='string'&&/^[0-9]{1,78}(?:\.[0-9]{1,36})?$/.test(row[key]),'Invalid lending quantity');
      }
    }
    return structuredClone(row);
  });
  check(value.evidence&&boundedText(value.evidence.source)&&boundedText(value.evidence.assurance)&&boundedText(value.evidence.statement,500),'Invalid market evidence');
  return immutable({...structuredClone(value),rows});
}
export function marketFreshness(snapshot,{saved=false,online=true,now=Date.now()}={}){
  if(saved||!online)return 'Saved data';
  if(now<snapshot.observedAt-5000||now>=snapshot.expiresAt)return 'Needs refresh';
  return 'Recently read';
}
