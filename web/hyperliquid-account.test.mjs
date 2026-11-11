import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBalances} from './public/hyperliquid-account.js';
test('account balances bind token indexes and reject malformed or overheld amounts',()=>{
 const funds={mode:'disabled',spot:[{token:0,coin:'FAKE',total:'12.5',hold:'2.5'},{token:1,total:'-5',hold:'0'},{token:2,total:'2',hold:'3'}],perp:{withdrawable:'NaN',marginSummary:{accountValue:'42.25',totalMarginUsed:'-1'}}};
 const value=accountBalances(funds,[{index:0,name:'USDC'},{index:1,name:'HYPE'},{index:2,name:'ETH'}]);
 assert.deepEqual(value.spot,[{symbol:'USDC',available:'10'}]);assert.equal(value.equity,'42.25');assert.equal(value.withdrawable,null);assert.equal(value.margin,null);assert.equal(value.partial,true);
 assert.equal(accountBalances({...funds,mode:'unified'},[]),null);
});
