import test from 'node:test';
import assert from 'node:assert/strict';
import {zcashTestSelection,zcashTestUnits,formatZcashAmount,checkZcashSelection} from './public/intent-zcash-plan.js';
test('native payment selection retains recipient, amount and request through review',{ },()=>{
 const chosen=zcashTestSelection('native-zcash:a:'+'1'.repeat(64),'utest1'+'q'.repeat(70),'0.01',{requestId:'11111111-1111-4111-8111-111111111111',deadline:1000});
 assert.equal(chosen.source.amount,'1000000');assert.equal(chosen.destination.minAmount,'1000000');assert.equal(checkZcashSelection(chosen).destination.accountId,'utest1'+'q'.repeat(70));assert.equal(formatZcashAmount('1010000'),'0.0101 test ZEC');
 for(const amount of ['0.10000001','0','1','-0.01','0.00000000','0.001e1'])assert.throws(()=>zcashTestUnits(amount));
});
