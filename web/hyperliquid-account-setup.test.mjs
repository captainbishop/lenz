import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {newHyperliquidSetupAction,checkedHyperliquidSetupAction,hyperliquidSetupTypedData,verifyHyperliquidSetupSignature} from './public/hyperliquid-account-setup.js';
import {resolveOrderMarket,prepareOrder} from './public/hyperliquid-order.js';
const {Wallet}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const signer=new Wallet('0x'+'0'.repeat(63)+'1'),account=signer.address.toLowerCase();
test('the exact official testnet setup signature changes only the signing account to Standard mode',async()=>{
 const action=newHyperliquidSetupAction(account,1700000000000),data=hyperliquidSetupTypedData(action),signature=await signer.signTypedData(data.domain,data.types,data.message);assert.equal(data.primaryType,'HyperliquidTransaction:UserSetAbstraction');assert.equal(data.domain.chainId,421614);assert.equal(data.message.abstraction,'disabled');assert.equal(verifyHyperliquidSetupSignature(action,signature).v===27||verifyHyperliquidSetupSignature(action,signature).v===28,true);
 for(const changed of [{hyperliquidChain:'Mainnet'},{type:'usdSend'},{abstraction:'portfolioMargin'},{signatureChainId:'0xa4b1'},{amount:'100'},{expiresAfter:1700000060000}])assert.throws(()=>checkedHyperliquidSetupAction({...action,...changed}));
 assert.throws(()=>verifyHyperliquidSetupSignature({...action,user:'0x'+'1'.repeat(40)},signature),/signing wallet changed/);assert.throws(()=>verifyHyperliquidSetupSignature({...action,nonce:action.nonce+1},signature));
});
test('the new grant can afford minimum spot and a minimum BTC perp at verified twenty-times leverage in labelled account fixtures',()=>{
 const spot={tokens:[{index:0,name:'USDC',szDecimals:8},{index:1,name:'TEST',szDecimals:2}],universe:[{index:0,name:'@0',tokens:[1,0]}]},perps={universe:[{name:'BTC',szDecimals:5,maxLeverage:20}],collateralToken:0},source={environment:'testnet',chainId:'hypercore:testnet',quote:{index:0,symbol:'USDC'}},input={side:'buy',size:'0.1',price:'100',reduceOnly:false};
 const spotMarket=resolveOrderMarket({...source,id:'spot:0',kind:'spot',coin:'@0'},{spot,perps}),perpMarket=resolveOrderMarket({...source,id:'perp::0',kind:'perp',coin:'BTC'},{spot,perps}),funds={spot:[{token:0,total:'12',hold:'0'}],perp:{assetPositions:[],withdrawable:'3'},fee:'0.01',mode:'disabled',leverage:{type:'cross',value:20},markPrice:'100'};
 assert.equal(prepareOrder(spotMarket,account,input,funds,{now:1700000000000,cloid:'0x'+'ab'.repeat(16)}).spend,'10.1');assert.equal(prepareOrder(perpMarket,account,input,funds,{now:1700000000000,cloid:'0x'+'ab'.repeat(16)}).spend,'0.6');
});
