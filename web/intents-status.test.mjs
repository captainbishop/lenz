import test from 'node:test';
import assert from 'node:assert/strict';
const {checkConfidentialObservation}=await import(process.env.LENZ_STATUS_MODULE??'./public/intents-status.js');

const now=Date.parse('2026-11-10T12:00:00.000Z');
const review={depositAddress:'ab'.repeat(32),quotedAt:'2026-11-10T11:00:00.000Z',amount:'1000',minAmountOut:'950'};
const observation=(changes={})=>({type:'lenz/private-status/v1',depositAddress:review.depositAddress,status:'PROCESSING',updatedAt:'2026-11-10T11:59:59.000Z',observedAt:now,amountIn:null,amountOut:null,refundedAmount:null,withdrawFee:null,settlementVerified:false,providerReportSigned:false,...changes});

test('a status timestamp cannot accumulate two clock-skew allowances into a future update',()=>{
 const input=observation({observedAt:now+60000,updatedAt:new Date(now+120000).toISOString()});
 assert.throws(()=>checkConfidentialObservation(review,input,{now}),/time/);
});

test('observations require valid request binding even before amounts are known',()=>{
 for(const changes of [{depositAddress:''},{depositAddress:'0'.repeat(64)},{amount:'0'},{amount:'1e3'},{minAmountOut:'0'},{minAmountOut:'950.0'},{quotedAt:'2026-11-10'}]){
  const invalid={...review,...changes};
  assert.throws(()=>checkConfidentialObservation(invalid,observation({depositAddress:invalid.depositAddress}),{now}),/review/);
 }
});

test('pending statuses preserve unknown amounts and remain readable after approval expiry',()=>{
 for(const status of ['KNOWN_DEPOSIT_TX','PENDING_DEPOSIT','INCOMPLETE_DEPOSIT','PROCESSING','FAILED']){
  const input=observation({status}),result=checkConfidentialObservation(review,input,{now:now+7*86400000});
  assert.deepEqual(result,input);assert.equal(result.amountIn,null);assert.equal(result.amountOut,null);
  assert.equal(result.settlementVerified,false);assert.equal(result.providerReportSigned,false);
 }
});

test('a successful report binds exact input and minimum output without becoming settlement evidence',()=>{
 const input=observation({status:'SUCCESS',amountIn:'1000',amountOut:'950',withdrawFee:'0'});
 assert.deepEqual(checkConfidentialObservation(review,input,{now}),input);
 for(const change of [{amountIn:'999'},{amountIn:'1001'},{amountIn:null},{amountOut:'949'},{amountOut:null},{withdrawFee:'1'}]){
  assert.throws(()=>checkConfidentialObservation(review,{...input,...change},{now}),/amounts/);
 }
 const unknownFee=checkConfidentialObservation(review,{...input,withdrawFee:null},{now});
 assert.equal(unknownFee.withdrawFee,null);assert.equal(unknownFee.settlementVerified,false);
});

test('refund reports retain partial amounts and cannot exceed the approved input',()=>{
 const input=observation({status:'REFUNDED',refundedAmount:'750'});
 assert.deepEqual(checkConfidentialObservation(review,input,{now}),input);
 for(const refundedAmount of [null,'1001'])assert.throws(()=>checkConfidentialObservation(review,{...input,refundedAmount},{now}),/refund/);
});

test('quantities remain canonical u128 strings without losing precision',()=>{
 const amount='170141183460469231731687303715884105727',large={...review,amount,minAmountOut:amount};
 const result=checkConfidentialObservation(large,observation({status:'SUCCESS',amountIn:amount,amountOut:amount,withdrawFee:'0'}),{now});
 assert.equal(result.amountIn,amount);assert.equal(result.amountOut,amount);
 for(const field of ['amountIn','amountOut','refundedAmount','withdrawFee'])for(const value of [0,0n,-1,'-1','01','1e3','1.5','','340282366920938463463374607431768211456']){
  assert.throws(()=>checkConfidentialObservation(review,observation({[field]:value}),{now}),/amount/);
 }
});

test('foreign deposits, unsupported statuses and added authority fields are rejected',()=>{
 for(const changes of [{depositAddress:'cd'.repeat(32)},{status:'COMPLETED'},{status:0},{type:'lenz/private-status/v2'},{balance:'1000'},{settlementVerified:true},{providerReportSigned:true}]){
  assert.throws(()=>checkConfidentialObservation(review,observation(changes),{now}));
 }
 const missing=observation();delete missing.amountOut;
 assert.throws(()=>checkConfidentialObservation(review,missing,{now}));
});

test('invalid and pre-quote timestamps fail without extending the original request',()=>{
 for(const changes of [{observedAt:now+60001},{observedAt:Date.parse(review.quotedAt)-1,updatedAt:review.quotedAt},{observedAt:'1794312000000'},{updatedAt:'2026-11-10'},{updatedAt:'2026-11-10T12:00:00+00:00'},{updatedAt:'2026-11-10T10:58:59.999Z'},{observedAt:now-120000,updatedAt:new Date(now).toISOString()}]){
  assert.throws(()=>checkConfidentialObservation(review,observation(changes),{now}),/time/);
 }
 for(const time of [NaN,Infinity,'now'])assert.throws(()=>checkConfidentialObservation(review,observation(),{now:time}),/time/);
 const edge=observation({observedAt:now+60000,updatedAt:new Date(now+60000).toISOString()});
 assert.deepEqual(checkConfidentialObservation(review,edge,{now}),edge);
});

test('validated observations are detached from caller mutations and leave the review intact',()=>{
 const input=observation(),original=structuredClone(review),result=checkConfidentialObservation(review,input,{now});
 input.status='SUCCESS';input.amountOut='999999';assert.equal(result.status,'PROCESSING');assert.equal(result.amountOut,null);
 result.withdrawFee='0';assert.equal(input.withdrawFee,null);assert.deepEqual(review,original);
});
