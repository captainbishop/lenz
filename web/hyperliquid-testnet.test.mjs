import test from 'node:test';
import assert from 'node:assert/strict';
import {hyperInfo,submitTradingAction} from './public/hyperliquid-trading.js';
import {orderTypedData,resolveOrderMarket,prepareOrder,checkedOrderReview} from './public/hyperliquid-order.js';
import {normalizeHyperliquidCatalog,checkedHyperliquidCatalog,hyperliquidRequest} from './public/hyperliquid-catalog.js';
import {normalizePredictions,checkedPredictions} from './public/prediction-model.js';
import {executeTradingOrder} from './public/hyperliquid-execution.js';

test('trading account reads use the genuine testnet API without redirects or credentials',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.hyperliquid-testnet.xyz/info');
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    return Response.json({universe:[]});
  };
  try{assert.deepEqual(await hyperInfo({type:'meta'}),{universe:[]});}finally{globalThis.fetch=previous;}
});

test('order signatures use the testnet replay domain from the official SDK',()=>{
  const action={type:'order',orders:[{a:4,b:true,p:'1670.1',s:'0.0147',r:false,t:{limit:{tif:'Ioc'}}}],grouping:'na'};
  const typed=orderTypedData(action,1677777606040);
  assert.equal(typed.message.source,'b');
  assert.equal(typed.message.connectionId,'0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908');
});

const domain={environment:'testnet',chainId:'hypercore:testnet'};
const spot={tokens:[{index:0,name:'USDC',szDecimals:8},{index:1105,name:'HYPE',szDecimals:2}],universe:[{index:1035,name:'@1035',tokens:[1105,0]}]};
const row={...domain,id:'spot:1035',kind:'spot',coin:'@1035',quote:{index:0,symbol:'USDC'}};
const account='0x1111111111111111111111111111111111111111';
const review=()=>prepareOrder(resolveOrderMarket(row,{spot}),account,{side:'buy',size:'0.02',price:'1224.9',reduceOnly:false},{mode:'disabled',fee:'0.001',spot:[{token:0,total:'100',hold:'0'}]});

test('fresh testnet metadata resolves HYPE and BTC using their actual separate asset indexes',()=>{
  assert.equal(resolveOrderMarket(row,{spot}).asset,11035);
  const perps={collateralToken:0,universe:[{name:'SOL',szDecimals:2,maxLeverage:10},{name:'APT',szDecimals:2,maxLeverage:3},{name:'ATOM',szDecimals:2,maxLeverage:10},{name:'BTC',szDecimals:5,maxLeverage:40}]};
  assert.equal(resolveOrderMarket({...domain,id:'perp::3',kind:'perp',coin:'BTC',quote:{index:0,symbol:'USDC'}},{perps}).asset,3);
  assert.throws(()=>resolveOrderMarket({...row,id:'spot:107',coin:'@107'},{spot}),/changed|unavailable/);
  assert.throws(()=>resolveOrderMarket({...row,chainId:'hypercore:mainnet',environment:'mainnet'},{spot}),/network/);
});

test('mainnet or unbound catalogues, predictions and saved orders cannot acquire testnet authority',async()=>{
  const catalog=normalizeHyperliquidCatalog({spot:[spot,[]],outcomes:{questions:[],outcomes:[{outcome:11274,name:'BTC above threshold',description:'',quoteToken:'USDC',sideSpecs:[{name:'Yes'},{name:'No'}]}]}});
  assert.equal(checkedHyperliquidCatalog(catalog).chainId,'hypercore:testnet');
  for(const value of [{...catalog,version:1},{...catalog,environment:'mainnet',chainId:'hypercore:mainnet'},{...catalog,rows:catalog.rows.map(row=>({...row,environment:'mainnet',chainId:'hypercore:mainnet'}))}])assert.throws(()=>checkedHyperliquidCatalog(value));
  const prediction=normalizePredictions('hyperliquid',catalog);
  assert.throws(()=>checkedPredictions({...prediction,environment:'mainnet',chainId:'hypercore:mainnet'}));
  assert.throws(()=>normalizePredictions('hyperliquid',{...catalog,rows:catalog.rows.map(row=>({...row,environment:'mainnet',chainId:'hypercore:mainnet'}))}));
  for(const marketId of ['hypercore:spot:@1035','hypercore:mainnet:spot:@1035'])assert.throws(()=>hyperliquidRequest({marketId,interval:'1m',privacy:'public'}));
  const current=review(),legacy={...current,version:1,environment:'mainnet',chainId:'hypercore:mainnet'};
  assert.throws(()=>checkedOrderReview(legacy));
  await assert.rejects(executeTradingOrder(legacy,{assertCurrent(){assert.fail('A legacy order reached the wallet');}},{read(){assert.fail('A legacy order requested account data');}}));
});

test('unsupported or expired actions fail before any testnet submission',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('An unsupported action reached the exchange');
  try{
    await assert.rejects(submitTradingAction({type:'withdraw3'},Date.now(),Date.now()+60000,{}));
    const r=review();await assert.rejects(submitTradingAction(r.action,r.nonce-120000,r.expiresAt-120000,{}),/expired/);
  }finally{globalThis.fetch=previous;}
});
