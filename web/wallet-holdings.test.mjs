import test from 'node:test';import assert from 'node:assert/strict';
import {holdingsValue,walletHoldings} from './public/wallet-holdings.js';
import {tokenMarket,tokenImageURL} from './public/token-market.js';
const now=1800000000000,account='0x'+'12'.repeat(20),contract='0x'+'56'.repeat(20),request={network:'ethereum',contract,account,publicConsent:true};
const pair={chainId:'ethereum',baseToken:{address:contract},pairAddress:'0x'+'78'.repeat(20),priceUsd:'0.000025',liquidity:{usd:100000},volume:{h24:10000}};
const row={request,decimals:6,balance:'1000000000000',observedAt:now,price:tokenMarket([pair],request,{now}).price,nativePrice:{answer:'300000000000',decimals:8,observedAt:now}};
test('holdings bind account and chain, deduplicate imports and value exact integer quantities',()=>{
 const rows=walletHoldings([row,{...row,observedAt:now-1},{...row,request:{...request,account:contract}},{...row,request:{...request,network:'base'}}],{chainId:'0x1',address:account});assert.equal(rows.length,1);
 assert.deepEqual(holdingsValue(rows,{now,nativeBalance:'0xde0b6b3a7640000',nativeObservedAt:now}),{value:'3025.00',unpriced:0,priced:2});
 assert.deepEqual(holdingsValue([...rows,{...row,price:null}],{now}),{value:'25.00',unpriced:1,priced:1});
});
test('fresh prices never revive old native or token balances',()=>{
 assert.deepEqual(holdingsValue([row],{now,nativeBalance:'0xde0b6b3a7640000',nativeObservedAt:now-60001}),{value:'25.00',unpriced:1,priced:1});
 assert.deepEqual(holdingsValue([{...row,observedAt:now-60001}],{now}),{value:null,unpriced:1,priced:0});
});
test('market prices require exact chain/contract and active liquidity, never a matching ticker',()=>{
 for(const bad of [{...pair,chainId:'base'},{...pair,baseToken:{address:account,symbol:'MEME'}},{...pair,liquidity:{usd:1}},{...pair,volume:{h24:0}},{...pair,priceUsd:'Infinity'}])assert.equal(tokenMarket([bad],request,{now}).price,null);
 assert.equal(tokenMarket([pair],request,{now}).price.answer,'25000000000000');
 for(const bad of ['javascript:alert(1)','https://localhost/secret','https://cdn.dexscreener.com.evil.test/logo.png','https://user@cdn.dexscreener.com/logo.png'])assert.equal(tokenImageURL(bad),null);
});
