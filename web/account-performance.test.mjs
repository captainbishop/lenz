import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePerformance,loadPerformance,accountPositions,accountOpenOrders} from './public/account-performance.js';

const end=1780000000000,start=end-30*86400000;
const fill=(tid,dir,closedPnl,fee='1')=>({tid,coin:'HYPE',dir,closedPnl,fee,feeToken:'USDC',px:'20',sz:'2',time:start+tid*1000});
test('performance uses actual fills and fees, separates wins, losses and break-even closes',()=>{
 const result=summarizePerformance([fill(1,'Open Long','0'),fill(2,'Close Long','10'),fill(3,'Close Short','-4'),fill(4,'Close Long','0')],{start,end});
 assert.equal(result.pnl,'2');assert.equal(result.volume,'160');assert.equal(result.fees,'4');
 assert.deepEqual([result.wins,result.losses,result.flat],[1,1,1]);assert.equal(result.winRate,33.33333333333333);
 assert.equal(result.history.length,4);assert.equal(result.history.at(-1).cumulative,'2');
});
test('duplicate fills do not inflate performance and conflicting duplicates are rejected',()=>{
 const row=fill(1,'Close Long','10');assert.equal(summarizePerformance([row,row],{start,end}).pnl,'9');
 assert.throws(()=>summarizePerformance([row,{...row,closedPnl:'1000'}],{start,end}));
});
test('unknown, spot and other-collateral markets cannot inflate USDC performance',()=>{
 const result=summarizePerformance([fill(1,'Close Long','10'),{...fill(2,'Buy','0'),coin:'@107'},{...fill(3,'Close Long','500'),coin:'xyz:ABC'}],{start,end});
 assert.equal(result.pnl,'9');assert.equal(result.volume,'40');assert.equal(result.excluded,2);
 assert.throws(()=>summarizePerformance([{...fill(1,'Close Long','10'),feeToken:'BTC'}],{start,end}));
});
test('missing history is not zero history; empty verified history has no win rate',()=>{
 assert.throws(()=>summarizePerformance(null,{start,end}));
 assert.throws(()=>summarizePerformance([fill(1,'Close Long','NaN')],{start,end}));
 assert.throws(()=>summarizePerformance([{...fill(1,'Close Long','10'),time:end+1}],{start,end}));
 assert.equal(summarizePerformance([],{start,end}).winRate,null);
 assert.equal(summarizePerformance([],{start,end}).pnl,'0');
});
test('large accounts are explicitly partial; fee rebates and decimals retain exact totals',()=>{
 const rows=Array.from({length:2000},(_,i)=>({...fill(i,'Open Long','0','-0.00000001'),px:'0.0001',sz:'0.0001'}));
 const result=summarizePerformance(rows,{start,end});assert.equal(result.limited,true);assert.equal(result.pnl,'0.00002');assert.equal(result.volume,'0.00002');
});
test('history reads bind the selected account and time window and do not submit actions',async()=>{
 Object.defineProperty(globalThis.navigator,'onLine',{configurable:true,value:true});const account='0x'+'ab'.repeat(20),calls=[];
 const result=await loadPerformance(account,{now:end,read:async body=>{calls.push(body);return body.type==='userFillsByTime'?[fill(1,'Close Long','10')]:body.type==='openOrders'?[]:{marginSummary:{accountValue:'100.5'},withdrawable:'80',assetPositions:[]};}});
 assert.equal(result.account,account);assert.equal(result.equity,'100.5');assert.equal(result.performance.pnl,'9');
 assert.deepEqual(calls,[{type:'userFillsByTime',user:account,startTime:start,endTime:end,aggregateByTime:false},{type:'clearinghouseState',user:account},{type:'openOrders',user:account}]);
 Object.defineProperty(globalThis.navigator,'onLine',{configurable:true,value:false});await assert.rejects(loadPerformance(account,{read:()=>assert.fail('Offline read escaped')}));
});
test('positions and orders distinguish unavailable from empty and reject ambiguous records',()=>{
 assert.equal(accountPositions(undefined),null);assert.equal(accountOpenOrders(null),null);assert.deepEqual(accountPositions([]),[]);assert.deepEqual(accountOpenOrders([]),[]);
 const position={position:{coin:'HYPE',szi:'-2',entryPx:'20',unrealizedPnl:'-4',liquidationPx:null,marginUsed:'10'}};
 assert.deepEqual(accountPositions([position]),[{coin:'HYPE',side:'short',size:'2',entryPrice:'20',pnl:'-4',liquidationPrice:null,margin:'10'}]);assert.throws(()=>accountPositions([position,position]));
 const order={coin:'HYPE',oid:123,side:'B',sz:'2',limitPx:'20',timestamp:end};assert.equal(accountOpenOrders([order])[0].side,'Buy');assert.throws(()=>accountOpenOrders([order,order]));assert.throws(()=>accountOpenOrders([{...order,limitPx:'NaN'}]));
});
