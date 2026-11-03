import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { discoverMarkets, STRATEGY_SCOPE } from '../web/public/defi-catalog.js';
import { examples,NOW } from './route-planner-fixtures.mjs';
const {routeObjective,previewRoute,assetReference}=await import(process.env.LENZ_ROUTE_MODULE?pathToFileURL(process.env.LENZ_ROUTE_MODULE):new URL('../web/public/defi-route-plan.js',import.meta.url));
const copy=name=>structuredClone(examples[name??'near-evm-return']);
const preview=(o,extra={})=>previewRoute(o,{now:NOW,...extra});
test('catalog discovers independent providers and retains full strategy scope',()=>{
  assert.deepEqual(discoverMarkets({category:'credit'}).map(m=>m.id),['aave','rhea']);
  assert.deepEqual(discoverMarkets({family:'hypercore'}).map(m=>m.id),['hyperliquid']);
  for(const category of ['staking','restaking','farming','rewards','speculative-token-trading'])assert(STRATEGY_SCOPE.includes(category));
  assert.throws(()=>discoverMarkets()[0].actions.push('arbitrary-call'),TypeError);
});
test('NEAR/EVM route includes funding, destination effect and verified return',()=>{
  const p=preview(copy());assert.deepEqual(p.steps.map(s=>s.kind),['check-source','fund-destination','destination-action','verify-destination','return-assets','verify-return']);
  assert.equal(p.steps[2].marketId,'uniswap');assert.equal(p.steps[4].chainId,'near:mainnet');
  assert.equal(p.objective.returnTo.minAmount,'800000');assert.equal(p.objective.privacy,'private');
  assert(p.steps.every(s=>s.state==='unverified'&&s.recovery.releaseReservation===false));
  p.steps.forEach((s,i)=>assert.deepEqual(s.dependsOn,i?[p.steps[i-1].id]:[]));
});
test('same-chain Aave keeps its position on Base without a mandatory NEAR/Rhea hop',()=>{
  const p=preview(copy('aave-position'));assert.equal(p.steps.length,3);assert(p.steps.every(s=>s.chainId==='eip155:8453'));assert.equal(p.objective.returnTo,null);
});
test('Hyperliquid order modification, cancellation and reduction retain venue bounds',()=>{
  const original=copy('hyperliquid-order');assert.equal(preview(original).objective.destination.order.maxLeverage,2);
  for(const action of ['modify-order','cancel-order','reduce-position','close-position']){
    const o=copy('hyperliquid-order');o.destination.action=action;o.destination.positionId='fixture-order-7';
    if(['cancel-order','close-position'].includes(action)){delete o.destination.order;o.source.amount='0';}
    if(action==='reduce-position')o.destination.order.reduceOnly=true;
    const p=preview(o);assert.equal(p.objective.destination.action,action);assert.equal(p.objective.destination.positionId,'fixture-order-7');
  }
});
test('HyperEVM cannot stand in for HyperCore perpetuals',()=>{
  const o=copy('hyperliquid-order');o.destination.chainId='eip155:999';o.recipient.chainId='eip155:999';assert.throws(()=>preview(o),/actual execution environment/);
});
test('rejects testnet/mainnet funding and wrong recipient chain',()=>{
  const o=copy();o.source.asset.chainId='near:testnet';assert.throws(()=>preview(o),/testnet and mainnet/);
  const other=copy();other.recipient.chainId='eip155:1';assert.throws(()=>preview(other),/Recipient chain/);
});
test('token identity includes chain, standard, contract and consistent decimals',()=>{
  const a=copy().destination.outputAsset;assert.notDeepEqual(assetReference(a),assetReference({...a,chainId:'eip155:1'}));
  assert.throws(()=>assetReference({...a,id:'USDC'}),/address/);
  assert.throws(()=>assetReference({...a,kind:'nep141'}),/kind/);
  const o=copy('aave-position');o.limits.maxFees[0].asset={...o.limits.maxFees[0].asset,decimals:18};assert.throws(()=>preview(o),/Conflicting asset decimals/);
});
test('rejects floats, unsafe numbers, absent fee budgets and zero swap output',()=>{
  for(const amount of [1e30,'1.5','-1','01','1e18','9'.repeat(79)]){const o=copy();o.source.amount=amount;assert.throws(()=>preview(o),/integer base units/);}
  const o=copy();o.limits.maxFees=[];assert.throws(()=>preview(o),/fee budgets/);
  const zero=copy();zero.limits.minReceive='0';assert.throws(()=>preview(zero),/Minimum received/);
});
test('rejects expired requests without unlocking any prior reservation',()=>{
  const o=copy();o.limits.deadline=NOW;assert.throws(()=>preview(o),/Expired objective/);
});
test('privacy is explicit and private execution is never inferred from transport',()=>{
  const o=copy();delete o.privacy;assert.throws(()=>preview(o),/privacy policy/);
  const p=preview(copy());assert.equal(p.executable,false);assert(p.blockers.some(b=>b.includes('settlement and recovery')));
  o.privacy='transparent';assert.equal(preview(o).executable,false);
});
test('rejects hidden calldata, dispatch claims and unrelated order fields',()=>{
  for(const field of ['calldata','executable','signature']){const o=copy();o[field]='injected';assert.throws(()=>preview(o),/objective fields/);}
  const o=copy();o.destination.order={instrument:'ETH'};assert.throws(()=>preview(o),/Unexpected order/);
});
test('return cannot imply withdrawing a newly opened position',()=>{
  const o=copy('aave-position');o.returnTo=copy().returnTo;assert.throws(()=>preview(o),/separate explicit exit/);
});
test('rejects missing order reference and a reduction that increases exposure',()=>{
  const o=copy('hyperliquid-order');o.destination.action='cancel-order';delete o.destination.order;assert.throws(()=>preview(o),/position\/order/);
  const reduction=copy('hyperliquid-order');reduction.destination.action='reduce-position';reduction.destination.positionId='fixture-position';assert.throws(()=>preview(reduction),/reduce-only/);
});
test('fixture and stale reads remain distinguishable and never authorize execution',()=>{
  const data={observedAt:NOW-1000,expiresAt:NOW+1000,source:'caller-supplied test observation'};
  assert.equal(preview(copy()).evidence.freshness,'unavailable');
  assert.equal(preview(copy(),{observation:{...data,kind:'fixture'}}).evidence.freshness,'fixture');
  const p=preview(copy(),{observation:{...data,kind:'live-read'}});assert.equal(p.evidence.freshness,'reported-live');assert.equal(p.executable,false);
  assert.equal(preview(copy(),{observation:{...data,kind:'live-read',expiresAt:NOW}}).evidence.freshness,'cached');
  assert.throws(()=>preview(copy(),{observation:{...data,kind:'live-read',observedAt:NOW+1}}),/Invalid observation/);
});
test('returned objective and plan are immutable snapshots of caller input',()=>{
  const o=copy(), p=preview(o), objective=routeObjective(o,{now:NOW});o.source.amount='99999999';o.limits.maxFees[0].amount='999';
  assert.equal(p.objective.source.amount,'1000000');assert.equal(objective.limits.maxFees[0].amount,'1000');
  assert.throws(()=>p.objective.limits.maxFees[0].amount='999',TypeError);
  assert.throws(()=>p.steps[0].recovery.releaseReservation=true,TypeError);
});
