import test from 'node:test';
import assert from 'node:assert/strict';
import {walletIntentHoldings,walletHyperliquidHoldings} from './public/wallet-holdings.js';

const owner={chainId:'0x2105',address:'0x'+'11'.repeat(20),network:{symbol:'ETH',decimals:18},balance:'0xde0b6b3a7640000',observedAt:100000};
const token={request:{network:'base',account:owner.address,contract:'0x'+'22'.repeat(20)},symbol:'USDC',name:'USD Coin',decimals:6,balance:'1234567',observedAt:100000};

test('swap funds retain their actual chain, account and integer quantities',()=>{
 const rows=walletIntentHoldings([token,{...token,request:{...token.request,account:'0x'+'33'.repeat(20)}}],owner,{online:true,now:100001});
 assert.equal(rows.length,2);
 assert.equal(rows[0].chainId,'eip155:8453');assert.equal(rows[0].asset,'native');assert.equal(rows[0].accountId,owner.address);assert.equal(rows[0].units,'1000000000000000000');
 assert.equal(rows[1].chainId,'eip155:8453');assert.equal(rows[1].asset,'erc20:'+token.request.contract);assert.equal(rows[1].accountId,owner.address);assert.equal(rows[1].units,'1234567');assert.equal(rows[1].decimals,6);
});

test('offline and old observations expose saved quantities without asserting current spendable funds',()=>{
 for(const options of [{online:false,now:100001},{online:true,now:200001}]){
  const rows=walletIntentHoldings([token],owner,options);
  assert(rows.every(row=>row.units===null&&row.status==='last-verified'));
  assert.equal(rows[1].cachedUnits,'1234567');assert.equal(rows[1].verifiedAt,100000);
 }
 assert.deepEqual(walletIntentHoldings([token],null,{online:true,now:100001}),[]);
});

test('unfunded native assets and zero token balances do not occupy the owned wallet list',()=>{
 assert.deepEqual(walletIntentHoldings([{...token,balance:'0'}],{...owner,balance:'0x0'},{online:true,now:100001}),[]);
 const received=walletIntentHoldings([token],{...owner,balance:'0x0'},{online:true,now:100001});assert.equal(received.length,1);assert.equal(received[0].symbol,'USDC');assert.equal(received[0].units,'1234567');
});

test('HyperCore collateral and spot receipt holdings keep custody and available funds separate',()=>{
 const now=Date.now(),snapshot={version:1,environment:'testnet',chainId:'hypercore:testnet',source:'https://api.hyperliquid-testnet.xyz/info',account:owner.address,observedAt:now,mode:'disabled',partial:false,spot:[{tokenIndex:0,symbol:'USDC',tokenId:'0x'+'44'.repeat(16),decimals:6,total:'100',hold:'20',available:'80'}],perps:{totalRawUSDC:'50',accountValue:'52',withdrawable:'40',marginUsed:'10'}};
 const rows=walletHyperliquidHoldings(snapshot,{online:true,now});assert.equal(rows.length,2);assert.equal(rows[0].displayAmount,'100');assert.equal(rows[0].units,'80000000');assert.equal(rows[1].displayAmount,'50');assert.equal(rows[1].units,'40000000');assert.notEqual(rows[0].asset,rows[1].asset);
 const cached=walletHyperliquidHoldings(snapshot,{online:false,now});assert(cached.every(row=>row.units===null&&row.status==='last-verified'));
 snapshot.perps.totalRawUSDC=null;assert.equal(walletHyperliquidHoldings(snapshot,{online:true,now}).length,1);
});
