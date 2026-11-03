import { CHAINS, MARKETS, immutable } from './defi-catalog.js';

const fail = message => { throw Error(message); };
const own = (object,key) => Object.hasOwn(object,key);
function record(value, keys, name) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(k=>!keys.includes(k))) fail(`Invalid ${name} fields`);
}
function text(value,name) {
  if (typeof value!=='string' || !value || value.length>160 || /[\u0000-\u001f\u007f]/.test(value)) fail(`Invalid ${name}`);
  return value;
}
function chain(id) { if (!own(CHAINS,id)) fail('Unknown chain'); return CHAINS[id]; }
function units(value, allowZero=false) {
  if (typeof value!=='string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || (!allowZero && value==='0')) fail('Use bounded integer base units');
  return value;
}
function address(value,chainId) {
  const family=chain(chainId).family;
  if (family==='evm'||family==='hypercore') {
    if (typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value)||/^0x0{40}$/i.test(value)) fail('Invalid destination address');
    return value.toLowerCase();
  }
  if (typeof value!=='string'||value.length<2||value.length>64||!/^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/.test(value)) fail('Invalid NEAR account');
  return value;
}
export function assetReference(value) {
  record(value,['chainId','kind','id','decimals'],'asset');
  const family=chain(value.chainId).family;
  if (!Number.isInteger(value.decimals)||value.decimals<0||value.decimals>36) fail('Invalid asset decimals');
  let id=value.id;
  if (value.kind==='native') { if(id!=='native')fail('Invalid native asset'); }
  else if(value.kind==='erc20'&&family==='evm') id=address(id,value.chainId);
  else if(value.kind==='nep141'&&family==='near') id=address(id,value.chainId);
  else if(value.kind==='venue'&&family==='hypercore') { if(typeof id!=='string'||!/^[A-Z0-9][A-Z0-9:._-]{0,39}$/.test(id))fail('Invalid venue asset'); }
  else fail('Asset kind does not match chain');
  return immutable({chainId:value.chainId,kind:value.kind,id,decimals:value.decimals});
}
const key = a => `${a.chainId}/${a.kind}/${a.id}`;
const positionActions=['withdraw','borrow','repay','remove-liquidity','collect-fees','modify-order','cancel-order','reduce-position','close-position','withdraw-margin'];
const orderActions=['place-order','modify-order','reduce-position'];
const openingActions=['supply','add-liquidity','place-order','modify-order','deposit-margin','reduce-position'];

// This document records a desired outcome. It is never signing or dispatch authority.
export function routeObjective(input,{now=Date.now()}={}) {
  record(input,['id','source','destination','recipient','limits','privacy','returnTo'],'objective');
  if (!Number.isSafeInteger(now)||now<0)fail('Invalid current time');
  record(input.source,['asset','amount'],'source');
  record(input.destination,['marketId','chainId','action','outputAsset','positionId','order'],'destination');
  record(input.recipient,['chainId','address'],'recipient');
  record(input.limits,['deadline','minReceive','maxFees'],'limits');
  const source={asset:assetReference(input.source.asset),amount:units(input.source.amount,true)};
  const dest=input.destination, market=MARKETS.find(m=>m.id===dest.marketId);
  if(!market||!market.actions.includes(dest.action))fail('Unknown market action');
  const target=chain(dest.chainId);
  if(target.family!==market.family)fail('Market requires its actual execution environment');
  if(chain(source.asset.chainId).network!==target.network)fail('Cannot route across testnet and mainnet');
  if(source.amount==='0'&&!['cancel-order','close-position','collect-fees','withdraw','withdraw-margin','remove-liquidity'].includes(dest.action))fail('Action requires a positive spend bound');
  if(input.recipient.chainId!==dest.chainId)fail('Recipient chain differs from destination');
  const recipient={chainId:dest.chainId,address:address(input.recipient.address,dest.chainId)};
  if(!['private','transparent'].includes(input.privacy))fail('Explicit privacy policy required');
  if(!Number.isSafeInteger(input.limits.deadline)||input.limits.deadline<=now)fail('Expired objective');
  const minReceive=units(input.limits.minReceive,true);
  if(['swap','supply','withdraw','borrow','remove-liquidity','withdraw-margin'].includes(dest.action)&&minReceive==='0')fail('Minimum received must be positive');
  const fees=input.limits.maxFees;
  if(!Array.isArray(fees)||fees.length===0||fees.length>12)fail('Explicit fee budgets required');
  const maxFees=fees.map(f=>{record(f,['asset','amount'],'fee');return {asset:assetReference(f.asset),amount:units(f.amount,true)};});
  if(new Set(maxFees.map(f=>key(f.asset))).size!==maxFees.length)fail('Duplicate fee asset');
  if(maxFees.some(f=>chain(f.asset.chainId).network!==target.network))fail('Fee network mismatch');
  const destination={marketId:market.id,chainId:dest.chainId,action:dest.action};
  if(dest.outputAsset!==undefined){destination.outputAsset=assetReference(dest.outputAsset);if(destination.outputAsset.chainId!==dest.chainId)fail('Output asset chain mismatch');}
  if(minReceive!=='0'&&!destination.outputAsset)fail('Minimum received needs an exact output asset');
  if(positionActions.includes(dest.action))destination.positionId=text(dest.positionId,'position/order reference');
  else if(dest.positionId!==undefined)fail('Unexpected position reference');
  if(orderActions.includes(dest.action)){
    record(dest.order,['instrument','side','size','sizeDecimals','limitPrice','priceDecimals','maxLeverage','reduceOnly'],'order');
    if(typeof dest.order.instrument!=='string'||!/^[A-Z0-9][A-Z0-9:._-]{0,39}$/.test(dest.order.instrument))fail('Invalid instrument');
    if(!['buy','sell'].includes(dest.order.side)||typeof dest.order.reduceOnly!=='boolean')fail('Invalid order policy');
    if(!Number.isInteger(dest.order.maxLeverage)||dest.order.maxLeverage<1||dest.order.maxLeverage>50)fail('Invalid leverage bound');
    if(dest.action==='reduce-position'&&!dest.order.reduceOnly)fail('Reduction must be reduce-only');
    destination.order={instrument:dest.order.instrument,side:dest.order.side,size:units(dest.order.size),limitPrice:units(dest.order.limitPrice),maxLeverage:dest.order.maxLeverage,reduceOnly:dest.order.reduceOnly};
    if(dest.order.sizeDecimals!==undefined||dest.order.priceDecimals!==undefined){
      if(!Number.isInteger(dest.order.sizeDecimals)||dest.order.sizeDecimals<0||dest.order.sizeDecimals>6||dest.order.priceDecimals!==6)fail('Explicit order precision required');
      destination.order.sizeDecimals=dest.order.sizeDecimals;destination.order.priceDecimals=6;
    }
  } else if(dest.order!==undefined)fail('Unexpected order terms');
  let returnTo=null;
  if(input.returnTo!==null){
    record(input.returnTo,['asset','address','minAmount'],'return');
    if(openingActions.includes(dest.action))fail('A position needs a separate explicit exit objective before return');
    if(!destination.outputAsset||minReceive==='0')fail('Return requires an exact received asset and minimum');
    const asset=assetReference(input.returnTo.asset);
    if(chain(asset.chainId).network!==target.network)fail('Return network mismatch');
    returnTo={asset,address:address(input.returnTo.address,asset.chainId),minAmount:units(input.returnTo.minAmount)};
  }
  const assets=[source.asset,...maxFees.map(f=>f.asset),destination.outputAsset,returnTo?.asset].filter(Boolean),decimals=new Map();
  for(const asset of assets){if(decimals.has(key(asset))&&decimals.get(key(asset))!==asset.decimals)fail('Conflicting asset decimals');decimals.set(key(asset),asset.decimals);}
  return immutable({version:1,kind:'lenz-route-objective',id:text(input.id,'objective ID'),source,destination,recipient,limits:{deadline:input.limits.deadline,minReceive,maxFees},privacy:input.privacy,returnTo});
}

export function previewRoute(input,{now=Date.now(),observation=null}={}) {
  const objective=routeObjective(input,{now});
  let evidence={kind:'none',freshness:'unavailable'};
  if(observation!==null){
    record(observation,['kind','observedAt','expiresAt','source'],'observation');
    if(!['fixture','live-read'].includes(observation.kind)||!Number.isSafeInteger(observation.observedAt)||!Number.isSafeInteger(observation.expiresAt)||observation.observedAt<0||observation.observedAt>now||observation.expiresAt<=observation.observedAt)fail('Invalid observation');
    evidence={...observation,source:text(observation.source,'evidence source'),freshness:observation.kind==='fixture'?'fixture':observation.expiresAt<=now?'cached':'reported-live'};
  }
  const steps=[];
  const add=(kind,chainId,details)=>{const id=`${objective.id}:${steps.length+1}`;steps.push({id,kind,chainId,dependsOn:steps.length?[steps.at(-1).id]:[],state:'unverified',...details,recovery:{onUnknown:'reconcile-before-retry',releaseReservation:false}});};
  add('check-source',objective.source.asset.chainId,{asset:objective.source.asset,maxSpend:objective.source.amount});
  if(objective.source.asset.chainId!==objective.destination.chainId) add('fund-destination',objective.destination.chainId,{fromChain:objective.source.asset.chainId,requires:'verified asset pair, bridge or venue funding adapter, exact destination and fee budget'});
  add('destination-action',objective.destination.chainId,{marketId:objective.destination.marketId,action:objective.destination.action,requires:'exact market deployment, bounded authorization and current conditions'});
  add('verify-destination',objective.destination.chainId,{requires:'final operation-specific balance, position, debt or order evidence'});
  if(objective.returnTo){
    add('return-assets',objective.returnTo.asset.chainId,{fromChain:objective.destination.chainId,requires:'verified return asset pair, recipient and final received minimum'});
    add('verify-return',objective.returnTo.asset.chainId,{requires:'final recipient-specific evidence; separate backing and liability checks before offline credit'});
  }
  return immutable({version:1,kind:'lenz-route-preview',objective,evidence,steps,executable:false,status:'needs-integration',blockers:[
    'Market and asset deployments, provider routes and fees are not verified by this planner.',
    objective.privacy==='private'?'Private quote, execution, settlement and recovery boundaries require verified support.':'Transparent execution was requested; exact disclosures still need review.',
    'A connected executor, reviewed bounded signing and durable reconciliation are required.',
    'Caller-supplied observations never authorize execution, settle funds or release reservations.',
  ]});
}
