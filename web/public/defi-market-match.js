import {immutable} from './defi-catalog.js';
import {previewRoute} from './defi-route-plan.js';
import {marketSnapshot,marketFreshness} from './market-snapshot.js';
import {MARKET_SOURCES,marketSource} from './evm-markets.js';
const sameAsset=(a,b)=>a.chainId===b.chainId&&a.kind===b.kind&&a.id.toLowerCase()===b.id.toLowerCase()&&a.decimals===b.decimals;
// Discovery narrows candidates; it supplies no quote, position proof or authority.
export function previewWithMarkets(input,observations,{now=Date.now()}={}){
  if(!Array.isArray(observations)||observations.length>MARKET_SOURCES.length)throw Error('Too many market observations');
  const plan=previewRoute(input,{now}),objective=plan.objective;
  const snapshots=observations.map(value=>marketSnapshot(value,{now}));
  if(new Set(snapshots.map(s=>marketSource(s).key)).size!==snapshots.length)throw Error('Duplicate market source');
  const candidates=[],requirements=[];
  const snapshot=snapshots.find(s=>s.provider===objective.destination.marketId&&s.chainId===objective.destination.chainId);
  if(snapshot){
    for(const row of snapshot.rows){
      if(row.marketId==='hyperliquid'){
        if(!objective.destination.order||row.instrument!==objective.destination.order.instrument)continue;
        if(row.status!=='listed'||objective.destination.order.maxLeverage>row.maxLeverage)continue;
      }else{
        const receivesReserve=row.marketId==='aave'&&['borrow','withdraw'].includes(objective.destination.action);
        const asset=receivesReserve?objective.destination.outputAsset:objective.source.asset;
        if(asset?.chainId===row.chainId&&!row.assets.some(a=>sameAsset(a,asset)))continue;
        if(row.marketId==='aave'&&objective.destination.action==='borrow'&&!row.borrowingEnabled)continue;
        if(objective.destination.action==='swap'&&(!objective.destination.outputAsset||!row.assets.some(a=>sameAsset(a,objective.destination.outputAsset))))continue;
        if(!['listed','liquidity-observed'].includes(row.status))continue;
      }
      candidates.push({id:row.id,marketId:row.marketId,chainId:row.chainId,address:row.address??null,instrument:row.instrument??null,observedAt:snapshot.observedAt,freshness:marketFreshness(snapshot,{now}),executable:false});
    }
    if(marketFreshness(snapshot,{now})!=='Recently read')requirements.push('The market observation needs refreshing before quote or authorization review.');
  }
  if(!candidates.length)requirements.push('No observed market matches the exact asset or instrument constraints.');
  if(objective.source.asset.chainId!==objective.destination.chainId)requirements.push('The destination funding asset and complete bridge or venue-deposit route remain unverified.');
  if(objective.destination.marketId==='aave')requirements.push('Reserve discovery does not verify share tokens, debt, account health, capacity or withdrawal effects.');
  if(objective.destination.marketId==='hyperliquid')requirements.push('Order precision, price increments, margin tiers, account ownership and position effects need venue-specific verification.');
  return immutable({...plan,discovery:{candidates,requirements},blockers:[...plan.blockers,...requirements]});
}
