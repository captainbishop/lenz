import test from 'node:test';
import assert from 'node:assert/strict';
import {hyperliquidHoldingsSnapshot,checkedHyperliquidHoldings} from './public/hyperliquid-holdings-model.js';
const snapshot=()=>({environment:'testnet',chainId:'hypercore:testnet',account:'0x'+'1'.repeat(40),observedAt:Date.now(),collateralToken:0,spotTokens:[{index:0,name:'USDC',tokenId:'0x'+'2'.repeat(32),weiDecimals:6},{index:10,name:'HYPE',tokenId:'0x'+'3'.repeat(32),weiDecimals:8}],funds:{mode:'disabled',spot:[{token:0,total:'0',hold:'0'},{token:10,total:'10',hold:'2'}],perp:{withdrawable:'100',marginSummary:{totalRawUsd:'125',accountValue:'120',totalMarginUsed:'20'}}}});
test('checked holdings expose positive owned spot quantities and distinct genuine perps collateral values without fiat valuation',()=>{
 const value=hyperliquidHoldingsSnapshot(snapshot());assert.equal(value.spot.length,1);assert.deepEqual(value.spot[0],{tokenIndex:10,symbol:'HYPE',tokenId:'0x'+'3'.repeat(32),decimals:8,total:'10',hold:'2',available:'8'});assert.deepEqual(value.perps,{totalRawUSDC:'125',accountValue:'120',withdrawable:'100',marginUsed:'20'});assert.equal(value.source,'https://api.hyperliquid-testnet.xyz/info');assert(!JSON.stringify(value).includes('valuation'));
});
test('unknown token metadata and absent perps values stay partial and unavailable while healthy owned quantities remain',()=>{
 const input=snapshot();input.funds.spot.push({token:999,total:'50',hold:'0'});delete input.funds.perp.marginSummary;const value=hyperliquidHoldingsSnapshot(input);assert.equal(value.partial,true);assert.equal(value.spot.length,1);assert.equal(value.perps.totalRawUSDC,null);assert.equal(value.perps.accountValue,null);assert.equal(value.perps.withdrawable,'100');
});
test('mainnet substitutions, changed collateral and unsupported account modes cannot become testnet wallet holdings',()=>{
 for(const input of [{...snapshot(),chainId:'hypercore:mainnet'},{...snapshot(),collateralToken:1}])assert.throws(()=>hyperliquidHoldingsSnapshot(input));const input=snapshot();input.funds.mode='portfolioMargin';const value=hyperliquidHoldingsSnapshot(input);assert.equal(value.spot.length,0);assert(Object.values(value.perps).every(item=>item===null));assert.equal(value.partial,true);assert.throws(()=>checkedHyperliquidHoldings({...value,spot:[{tokenIndex:0,symbol:'USDC',tokenId:null,decimals:6,total:'1',hold:'0',available:'1'}]}));
});
