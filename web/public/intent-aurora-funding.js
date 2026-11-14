import {checkAuroraFundingReview} from './intent-aurora-funding-plan.js';

export function createAuroraFundingClient(source,{fetchImpl=fetch}={}){
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 async function request(operation,body={},options={}){
  check(navigator.onLine,'Reconnect to check the original private grant.');const lease=source.capture();lease.assertCurrent();options.signal?.throwIfAborted();
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  const response=await fetchImpl('/api/intent-aurora-funds/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal}),value=await response.json();lease.assertCurrent();check(response.ok,value.error??'Private test funding is unavailable. Keep the original note.');return value;
 }
 async function original(id){const rows=await source.snapshot(),row=rows.find(row=>row.review?.id===id);check(row,'Open the original private funding request.');return row;}
 async function prepare(options={}){
  const commitment=await source.createNote(),row=(await source.snapshot()).find(row=>row.commitment===commitment);check(!row.outcome?.funded,'This private note is already funded.');
  if(row.signed&&!row.outcome?.cleanupComplete)throw Error('Check the original signed private funding request.');
  if(!row.signed&&row.review?.deadline>Date.now())return checkAuroraFundingReview(row.review);
  const review=await request('prepare',{owner:source.identity().accountId,commitment},options);checkAuroraFundingReview(review);check(review.commitment===commitment&&review.owner===source.identity().accountId,'The private grant changed its note or owner.');await source.saveReview(review);return review;
 }
 async function fund(id,options={}){
  await source.signFunding(id,options);const body=await source.beginDispatch(id,options),result=await request('submit',body,options);await source.saveOutcome(id,result);return result;
 }
 async function reconcile(id,options={}){const row=await original(id);check(row.signed,'The original private grant has no signature.');const result=await request('reconcile',{review:row.review,signed:row.signed},options);await source.saveOutcome(id,result);return result;}
 async function continueRequest(id,operation,options){const body=await source.beginDispatch(id,options),result=await request(operation,body,options);await source.saveOutcome(id,result);return result;}
 return Object.freeze({configuration:options=>request('config',{},options),prepare,fund,reconcile,resume:(id,options={})=>continueRequest(id,'resume',options),cleanup:(id,options={})=>continueRequest(id,'cleanup',options),cancelReview:id=>source.cancelReview(id)});
}
