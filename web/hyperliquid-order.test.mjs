import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOrderMarket,prepareOrder,orderTypedData,inspectOrder,checkedOrderAction,orderPosition} from './public/hyperliquid-order.js';

const spot={tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,name:'@107',tokens:[150,0]}]};
const perps={universe:[{name:'BTC',szDecimals:5,maxLeverage:40}],collateralToken:0};
const account='0x1111111111111111111111111111111111111111';
const market=()=>resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'spot:107',kind:'spot',coin:'@107',quote:{index:0,symbol:'USDC'}},{spot,perps});
const input={side:'buy',size:'1.25',price:'20',reduceOnly:false};
const balance={spot:[{token:0,coin:'USDC',total:'100',hold:'0'}],perp:null,fee:'0.001',mode:'disabled'};

test('position summary keeps exact market, direction and unavailable risk values distinct',()=>{
  const m=resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'perp::0',kind:'perp',coin:'BTC',quote:{index:0,symbol:'USDC'}},{spot,perps});
  const position={coin:'BTC',szi:'-0.125',entryPx:'100',unrealizedPnl:'-2.5',liquidationPx:null,marginUsed:'8'};
  const funds={perp:{assetPositions:[{position:{...position,coin:'xyz:BTC',szi:'5'}},{position}]}};
  assert.deepEqual(orderPosition(m,funds),{side:'short',size:'0.125',entryPrice:'100',pnl:'-2.5',liquidationPrice:null,margin:'8'});
  assert.equal(orderPosition(m,{perp:{assetPositions:[]}}),null);
  assert.throws(()=>orderPosition(m,{perp:{}}),/unavailable/);
  assert.throws(()=>orderPosition(m,{perp:{assetPositions:[{position:{}}]}}),/unavailable/);
  assert.throws(()=>orderPosition(m,{perp:{assetPositions:[{position},{position}]}}),/ambiguous/);
  assert.throws(()=>orderPosition(m,{perp:{assetPositions:[{position:{...position,szi:'bad'}}]}}),/amount/);
});

test('selected spot pair becomes one bounded order on that exact HyperCore market',()=>{
  const review=prepareOrder(market(),account,input,balance,{now:1700000000000,cloid:'0x'+'ab'.repeat(16)});
  assert.deepEqual(review.action,{type:'order',orders:[{a:10107,b:true,p:'20',s:'1.25',r:false,t:{limit:{tif:'Gtc'}},c:'0x'+'ab'.repeat(16)}],grouping:'na'});
  assert.equal(review.spend,'25.025');
  assert.equal(review.expiresAt,1700000060000);
});
test('market mismatch, wrong collateral, precision and insufficient funds cannot reach review',()=>{
  assert.throws(()=>resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'spot:108',kind:'spot',coin:'@107',quote:{index:0}},{spot,perps}),/changed|unavailable/);
  assert.throws(()=>prepareOrder(market(),account,{...input,size:'1.234'},balance),/decimal/);
  assert.throws(()=>prepareOrder(market(),account,input,{...balance,spot:[{token:0,coin:'USDC',total:'25',hold:'0'}]}),/fund/);
  assert.throws(()=>prepareOrder(market(),account,input,{...balance,mode:'portfolioMargin'}),/account mode/);
});
test('perpetual review preserves existing leverage and permits only actual position reductions',()=>{
  const m=resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'perp::0',kind:'perp',coin:'BTC',quote:{index:0,symbol:'USDC'}},{spot,perps});
  const state={...balance,markPrice:'50000',perp:{withdrawable:'50',assetPositions:[{position:{coin:'BTC',szi:'0.01',leverage:{type:'cross',value:2}}}]} };
  const review=prepareOrder(m,account,{side:'sell',size:'0.001',price:'50000',reduceOnly:true},state);
  assert.equal(review.action.orders[0].r,true);
  assert.equal(review.leverage,2);
  assert.throws(()=>prepareOrder(m,account,{side:'buy',size:'0.001',price:'50000',reduceOnly:true},state),/reduce/);
});
test('perpetual collateral estimate accounts for mark price and margin mode',()=>{
  const m=resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'perp::0',kind:'perp',coin:'BTC',quote:{index:0,symbol:'USDC'}},{spot,perps});
  const funds={...balance,markPrice:'100',leverage:{type:'cross',value:2},perp:{withdrawable:'1000',assetPositions:[]}};
  const review=prepareOrder(m,account,{side:'sell',size:'10',price:'1',reduceOnly:false},funds);
  assert.equal(review.spend,'501');assert.equal(review.marginMode,'cross');assert.equal(review.markPrice,'100');
  assert.throws(()=>prepareOrder(m,account,{side:'sell',size:'10',price:'1',reduceOnly:false},{...funds,perp:{...funds.perp,withdrawable:'10'}}),/margin/);
});
test('status is bound to the reviewed order and retains partial fills',()=>{
  const review=prepareOrder(market(),account,input,balance);
  const response={status:'order',order:{order:{coin:'@107',side:'B',limitPx:'20',sz:'0.25',origSz:'1.25',oid:321,timestamp:1700000000000,cloid:review.action.orders[0].c},status:'open',statusTimestamp:1700000000001}};
  const result=inspectOrder(review,response);
  assert.equal(result.state,'open');assert.equal(result.remaining,'0.25');assert.equal(result.filled,'1');
  assert.throws(()=>inspectOrder(review,{...response,order:{...response.order,order:{...response.order.order,coin:'@108'}}}),/match/);
  assert.equal(inspectOrder(review,{status:'unknownOid'}).state,'unknown');
  assert.equal(inspectOrder(review,{...response,order:{...response.order,status:'scheduledCancel'}}).state,'cancelled');
});
test('signing matches the official Python SDK golden vector',()=>{
  const action={type:'order',orders:[{a:4,b:true,p:'1670.1',s:'0.0147',r:false,t:{limit:{tif:'Ioc'}}}],grouping:'na'};
  assert.equal(orderTypedData(action,1677777606040).message.connectionId,'0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908');
  assert.notEqual(orderTypedData(action,1677777606040,1677777666040).message.connectionId,orderTypedData(action,1677777606040).message.connectionId);
});
test('the wallet signing capability rejects withdrawal and unreviewed action fields',()=>{
  assert.throws(()=>checkedOrderAction({type:'withdraw3',destination:account,amount:'10'}),/Unsupported/);
  const review=prepareOrder(market(),account,input,balance);
  assert.throws(()=>checkedOrderAction({...review.action,builder:{b:account,f:100}}),/reviewed/);
});
