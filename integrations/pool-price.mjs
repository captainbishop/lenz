import {discoverUniswap} from './market-discovery.mjs';
import {checkedPoolPrice} from '../web/public/pool-price.js';
export async function readPoolPrice(options={}){
  const observation=await discoverUniswap({...options,recent:true}),row=observation.rows[0],evidence=observation.evidence;
  if(row.status!=='liquidity-observed')throw Error('Pool unavailable.');
  return checkedPoolPrice({kind:'pool-price',marketId:row.id,source:evidence.source,sqrtPriceX96:row.sqrtPriceX96,sourceTime:evidence.blockTimestamp,observedAt:observation.observedAt,blockNumber:evidence.blockNumber,blockHash:evidence.blockHash,executable:false},{now:(options.clock??Date.now)()});
}
