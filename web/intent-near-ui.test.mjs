import test from 'node:test';
import assert from 'node:assert/strict';
import {nearTestUnits,formatNearTestAmount,nearTestSelection,checkedNearBalances,formatHoldingAmount} from './public/intent-near-ui.js';

test('testnet swap entry preserves exact six-decimal quantities',()=>{
 assert.equal(nearTestUnits('0.000001'),'1');assert.equal(nearTestUnits('0.123456'),'123456');assert.equal(nearTestUnits('1.000000'),'1000000');
 for(const value of ['0','-1','1.000001','0.0000001','1e-6',' 1','01','NaN'])assert.throws(()=>nearTestUnits(value));
});
test('minimum, account, chain, assets and deadline are fixed by the selected swap',()=>{
 const owner='11'.repeat(32),chosen=nearTestSelection(owner,'0.123456',{now:1000000});
 assert.equal(chosen.source.amount,'123456');assert.equal(chosen.destination.minAmount,'246912');assert.equal(chosen.destination.accountId,owner);assert.equal(chosen.source.accountId,owner);assert.equal(chosen.source.chainId,'near:testnet');assert.equal(chosen.destination.chainId,'near:testnet');assert.equal(chosen.deadline,1300000);assert.equal(chosen.privacy,'public');assert.equal(chosen.source.asset,'nep141:sourceif13a.lenz-dev-1794582631653.testnet');assert.equal(chosen.destination.asset,'nep141:targetif13a.lenz-dev-1794582631653.testnet');
 assert.throws(()=>nearTestSelection('invalid.testnet','1',{now:1000000}));
});
test('unknown balances stay unavailable and large quantities retain precision',()=>{
 assert.equal(formatNearTestAmount(null,'LTT'),'—');assert.equal(formatNearTestAmount(undefined,'LTT'),'—');assert.equal(formatNearTestAmount('0','LTS'),'0 LTS');assert.equal(formatNearTestAmount('123456','LTS'),'0.123456 LTS');assert.equal(formatNearTestAmount('9007199254740993123456','LTT'),'9007199254740993.123456 LTT');
});
test('the composer preserves a chosen recipient, minimum and original bounded deadline',()=>{
 const owner='11'.repeat(32),chosen=nearTestSelection(owner,'0.123456',{now:1000000,recipient:'recipient.testnet',minimum:'0.2',deadline:1250000});
 assert.equal(chosen.destination.minAmount,'200000');assert.equal(chosen.destination.accountId,'recipient.testnet');assert.equal(chosen.deadline,1250000);
 for(const options of [{minimum:'0'},{minimum:'0.246913'},{recipient:'recipient.near'},{privacy:'private'},{deadline:1600001}])assert.throws(()=>nearTestSelection(owner,'0.123456',{now:1000000,...options}));
});
test('checked holdings bind owner and network while cached quantities stay last verified',()=>{
 const owner='11'.repeat(32),status={network:'testnet',owner,checkedAt:1000000,sourceBalance:'1000000',resultBalance:'100000',externalResultBalance:null};
 const rows=checkedNearBalances(status,owner,{current:false});assert.equal(rows[0].units,null);assert.equal(rows[0].cachedUnits,'1000000');assert.equal(rows[0].status,'last-verified');assert.equal(rows[1].status,'unknown');assert.equal(rows[1].verifierUnits,'100000');
 for(const changed of [{owner:'22'.repeat(32)},{network:'mainnet'},{sourceBalance:'-1'},{checkedAt:null},{externalResultBalance:undefined}])assert.throws(()=>checkedNearBalances({...status,...changed},owner));
});
test('other funded assets retain their actual decimals and exact quantity',()=>{
 assert.equal(formatHoldingAmount('1000000000000000000',18),'1');assert.equal(formatHoldingAmount('123456789',8),'1.23456789');assert.equal(formatHoldingAmount('9007199254740993',0),'9007199254740993');assert.equal(formatHoldingAmount(null,18),'—');assert.equal(formatHoldingAmount('1',37),'—');
});
