const check=(ok,message)=>{if(!ok)throw Error(message);};
const copy=value=>structuredClone(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(left,right)=>JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
const amount=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value);
export const intentOwner=source=>JSON.stringify([source.chainId,source.accountId]);
export function checkIntentSelection(value){
 check(value&&Object.getPrototypeOf(value)===Object.prototype&&text(value.action)&&['private','public'].includes(value.privacy),'Choose an action and its privacy.');
 const {source,destination}=value;
 check(source&&destination&&[source.chainId,source.asset,source.accountId,destination.chainId,destination.asset,destination.accountId].every(text),'Choose the funds and destination.');
 check(amount(source.amount)&&amount(destination.minAmount),'Enter an amount and minimum result.');
 check(Number.isSafeInteger(value.deadline)&&value.deadline>0,'Choose a request deadline.');
 check(JSON.stringify(value).length<=4096,'The selected action is too large.');return copy(value);
}
const reviewSelection=value=>checkIntentSelection({action:value.action,source:value.source,destination:value.destination,deadline:value.deadline,privacy:value.privacy,...(Object.hasOwn(value,'route')?{route:value.route}:{}),...(Object.hasOwn(value,'requestId')?{requestId:value.requestId}:{})});
const empty=()=>({draft:null,review:null,attempts:[]});
function journal(value){
 check(value&&Array.isArray(value.attempts)&&value.attempts.length<=64&&JSON.stringify(value).length<=2000000,'Saved requests cannot be read.');
 const ids=new Set(),authorities=new Set();
 for(const attempt of value.attempts){
  check(text(attempt.id)&&!ids.has(attempt.id)&&attempt.review?.id===attempt.id&&['approval-unresolved','declined','authorized','submission-unresolved','executed','refunded','expired'].includes(attempt.status),'Saved requests conflict.');ids.add(attempt.id);
  check(Number.isSafeInteger(attempt.createdAt)&&attempt.createdAt>0,'Saved request time changed.');
  if(attempt.recoveryRequested)check(['recover','withdrawRefund'].includes(attempt.recoveryRequested.operation)&&Number.isSafeInteger(attempt.recoveryRequested.requestedAt)&&attempt.recoveryRequested.requestedAt>0,'The original recovery request changed.');
  check(text(attempt.authorityId)&&(!authorities.has(attempt.authorityId)||attempt.status==='declined'),'Saved source authorities conflict.');if(attempt.status!=='declined')authorities.add(attempt.authorityId);
  if(!['approval-unresolved','declined'].includes(attempt.status))check(attempt.authorization?.intentId===attempt.id&&text(attempt.authorization.artifactId),'Saved authorization changed.');
 }
 return copy(value);
}
export const checkIntentJournal=journal;
function sourceMatches(lease,chosen){
 const identity=lease.identity;check(identity&&identity.chainId===chosen.source.chainId&&(identity.accountId??identity.address)===chosen.source.accountId,'Choose the original wallet and account.');lease.assertCurrent();
}
export function createIntentWorkspace({service,store,source,now=Date.now,changed=()=>{}}){
 check(service&&store&&source,'The action service is unavailable.');
 let state=empty(),owner=null,phase='choose',busy=false,error='',executionAvailable=false,generation=0,controller=null;
 const snapshot=()=>copy({phase,busy,error,executionAvailable,...state});
 const paint=()=>changed(snapshot());
 function invalidate(){generation++;controller?.abort(Error('The action changed. Review it again.'));controller=null;busy=false;executionAvailable=false;}
 function current(ticket,signal){check(ticket===generation,'The action changed. Review it again.');signal?.throwIfAborted();}
 async function persist(operation,ticket=generation,signal){
  check(owner,'Choose the source funds.');const key=owner;
  const saved=await store.update(key,async retained=>{current(ticket,signal);journal(retained);await operation(retained);current(ticket,signal);return retained;},{signal,guard:()=>current(ticket,signal)});
  current(ticket,signal);state=journal(saved);return state;
 }
 async function select(value){
  const chosen=checkIntentSelection(value);invalidate();const ticket=generation,key=intentOwner(chosen.source);owner=key;error='';
  const retained=journal(await store.read(key));current(ticket);state=retained;await persist(saved=>{saved.draft=chosen;saved.review=null;},ticket);phase='choose';paint();return snapshot();
 }
 async function restore(selectedSource){
  invalidate();const ticket=generation;owner=intentOwner(selectedSource);const retained=journal(await store.read(owner));current(ticket);state=retained;phase=state.review?'review':'choose';error='';paint();return snapshot();
 }
 async function prepare(){
  check(!busy,'Finish the current request first.');const chosen=checkIntentSelection(state.draft),lease=source.capture();sourceMatches(lease,chosen);
  check(chosen.deadline>now(),'The request deadline passed. Review a new request.');
  const ticket=++generation,c=new AbortController();controller=c;busy=true;error='';paint();
  try{
   const capability=await service.capabilities(chosen,{signal:c.signal});current(ticket,c.signal);sourceMatches(lease,chosen);
   check(capability?.available===true&&capability.privacy===chosen.privacy,capability?.reason||'This action is unavailable with the selected privacy.');
   executionAvailable=capability.execute===true;
   const received=await service.prepare(copy(chosen),lease,{signal:c.signal});current(ticket,c.signal);sourceMatches(lease,chosen);
   const review=service.validateReview(copy(received),copy(chosen));
   check(review&&text(review.id)&&review.action===chosen.action&&same(review.source,chosen.source)&&same(review.destination,chosen.destination)&&review.deadline===chosen.deadline&&review.privacy===chosen.privacy,'The route changed the reviewed action.');
   await persist(retained=>{check(same(retained.draft,chosen),'The selected funds changed.');retained.review=copy(review);},ticket,c.signal);phase='review';
  }catch(reason){if(ticket===generation){error=reason instanceof Error?reason.message:'The route is unavailable.';phase='choose';}throw reason;}
  finally{if(ticket===generation){busy=false;controller=null;paint();}}
  return snapshot();
 }
 async function cancel(){invalidate();error='';if(owner)await persist(retained=>{retained.review=null;});phase='choose';paint();return snapshot();}
 async function recordAttempt(key,id,review,operation){
  const saved=await store.update(key,async retained=>{
   journal(retained);const attempt=retained.attempts.find(row=>row.id===id);
   check(attempt&&same(attempt.review,review),'The saved request changed.');await operation(attempt);journal(retained);return retained;
  });
  if(owner===key){state=journal(saved);paint();}return saved;
 }
 async function approve(){
  check(!busy,'Finish the current request first.');const review=copy(state.review),chosen=checkIntentSelection(state.draft),lease=source.capture();
  check(review&&review.deadline>now(),'Review the action before confirming.');sourceMatches(lease,chosen);
  check(typeof service.authorize==='function'&&typeof service.validateAuthorization==='function','Confirmation is unavailable for this route.');
  const authorityId=service.authorityId?.(copy(review))??review.authorityId;
  check(text(authorityId),'The source authority cannot be identified.');
  const ticket=++generation,key=owner,c=new AbortController();let walletDeclined=false;controller=c;busy=true;error='';paint();
  try{
   const capability=await service.capabilities(chosen,{signal:c.signal});current(ticket,c.signal);sourceMatches(lease,chosen);
   check(capability?.available===true&&capability.execute===true&&capability.privacy===review.privacy,capability?.reason||'Execution is unavailable for this route.');
   await persist(retained=>{
    check(same(retained.review,review),'The reviewed action changed.');
    const existing=retained.attempts.find(row=>row.id===review.id);
    check(!existing||existing.status==='declined'&&same(existing.review,review),'Check the existing request before trying again.');
    check(!retained.attempts.some(row=>row.authorityId===authorityId&&row.status!=='declined'),'Check the existing source authority before trying again.');
    if(service.requiresExclusiveSource===true)check(!retained.attempts.some(row=>row.id!==review.id&&row.review.source.asset===chosen.source.asset&&!['declined','executed','refunded','expired'].includes(row.status)),'Check the existing request for these funds before approving another.');
    if(existing)existing.status='approval-unresolved';
    else retained.attempts.push({id:review.id,authorityId,review:copy(review),createdAt:now(),status:'approval-unresolved',authorization:null,outcome:null});
   },ticket,c.signal);
   current(ticket,c.signal);sourceMatches(lease,chosen);
   let signed;try{signed=await service.authorize(copy(review),lease,{signal:c.signal});}catch(reason){walletDeclined=reason?.code===4001||service.authorizationNotCreated?.(reason)===true;throw reason;}
   const authorization=service.validateAuthorization(copy(signed),copy(review));
   check(authorization?.intentId===review.id&&text(authorization.artifactId),'The wallet approved a different request.');
   // A wallet may finish after this view closes. Retain that authority under its
   // original owner; cancellation cannot revoke a signature already created.
   await recordAttempt(key,review.id,review,attempt=>{check(attempt.status==='approval-unresolved','The approval already changed.');attempt.authorization=copy(authorization);attempt.status='authorized';});
   current(ticket,c.signal);sourceMatches(lease,chosen);phase='activity';
  }catch(reason){
   if(walletDeclined)await recordAttempt(key,review.id,review,attempt=>{if(attempt.status==='approval-unresolved')attempt.status='declined';}).catch(()=>{});
   if(ticket===generation)error=reason instanceof Error?reason.message:'Approval could not be confirmed.';throw reason;
  }finally{if(ticket===generation){busy=false;controller=null;paint();}}
  return snapshot();
 }
 function checkOutcome(value,attempt){
  const outcome=service.validateOutcome(copy(value),copy(attempt));
  check(outcome?.intentId===attempt.id&&outcome.artifactId===attempt.authorization?.artifactId&&['pending','unknown','executed','refunded','expired'].includes(outcome.status),'The result belongs to another request.');
  if(['executed','refunded','expired'].includes(outcome.status))check(outcome.verified===true&&outcome.evidence&&typeof outcome.evidence==='object','Settlement has not been independently verified.');
  return outcome;
 }
 async function recoverAuthorization(id){
  check(!busy,'Finish the current request first.');const attempt=copy(state.attempts.find(row=>row.id===id));
  check(attempt?.status==='approval-unresolved'&&!attempt.authorization&&typeof service.recoverAuthorization==='function','The original approval cannot be recovered through this route.');
  const chosen=reviewSelection(attempt.review),lease=source.capture();sourceMatches(lease,chosen);
  const key=owner,ticket=++generation,c=new AbortController();controller=c;busy=true;error='';paint();
  try{
   const signed=await service.recoverAuthorization(copy(attempt),{signal:c.signal});
   const authorization=service.validateAuthorization(copy(signed),copy(attempt.review));
   check(authorization?.intentId===attempt.id&&text(authorization.artifactId),'The retained approval belongs to another request.');
   await recordAttempt(key,id,attempt.review,row=>{check(row.status==='approval-unresolved'&&!row.authorization,'The original approval already changed.');row.authorization=copy(authorization);row.status='authorized';});
   current(ticket,c.signal);sourceMatches(lease,chosen);phase='activity';
  }catch(reason){if(ticket===generation)error=reason instanceof Error?reason.message:'The original approval is unavailable.';throw reason;}
  finally{if(ticket===generation){busy=false;controller=null;paint();}}
  return snapshot();
 }
 async function outcomeOperation(id,dispatch,resume=false){
  check(!busy,'Finish the current request first.');const attempt=copy(state.attempts.find(row=>row.id===id));
  check(attempt?.authorization||!dispatch&&service.supportsUnsignedExpiry===true&&attempt?.status==='approval-unresolved','The wallet approval is unresolved. Check it in the original wallet.');
  check(!['executed','refunded','expired'].includes(attempt.status)&&(!dispatch||attempt.status==='authorized'||resume&&attempt.status==='submission-unresolved'),'Check the existing request before trying again.');
  if(resume)check(service.supportsOriginalResume===true&&attempt.status==='submission-unresolved'&&attempt.outcome?.resubmissionSafe===true,'Check the original request before resuming it.');
  const key=owner,ticket=++generation,c=new AbortController();controller=c;busy=true;error='';paint();
  try{
   if(dispatch){
    const chosen=reviewSelection(attempt.review),lease=source.capture();sourceMatches(lease,chosen);
    check(chosen.deadline>now(),'The permission expired. Check the existing request.');
    if(resume){
     const observed=checkOutcome(await service.reconcile(copy(attempt),{signal:c.signal}),attempt);current(ticket,c.signal);sourceMatches(lease,chosen);
     await recordAttempt(key,id,attempt.review,row=>{check(row.status==='submission-unresolved'&&same(row.authorization,attempt.authorization),'The saved original request changed.');row.outcome=copy(observed);row.status=['executed','refunded','expired'].includes(observed.status)?observed.status:'submission-unresolved';});
     current(ticket,c.signal);sourceMatches(lease,chosen);
     if(['executed','refunded','expired'].includes(observed.status)){phase='activity';return {...snapshot(),busy:false};}
     check(observed.resubmissionSafe===true&&['unknown','pending'].includes(observed.status),'The original transaction may already exist. Check its status.');
     check(chosen.deadline>now(),'The permission expired. Check the existing request.');
    }
    if(!resume||typeof service.resume!=='function'){
     const capability=await service.capabilities(chosen,{signal:c.signal});current(ticket,c.signal);sourceMatches(lease,chosen);
     check(capability?.execute===true&&capability.available===true&&capability.privacy===chosen.privacy,'Execution is unavailable for this route.');
    }
    check(chosen.deadline>now(),'The permission expired. Check the existing request.');
    await persist(retained=>{const row=retained.attempts.find(row=>row.id===id);check(resume?row?.status==='submission-unresolved'&&row.outcome?.resubmissionSafe===true&&same(row.review,attempt.review)&&same(row.authorization,attempt.authorization):row?.status==='authorized'&&same(row,attempt),'The saved request changed.');row.status='submission-unresolved';},ticket,c.signal);
    current(ticket,c.signal);sourceMatches(lease,chosen);
   }
   const received=await (dispatch?(resume&&typeof service.resume==='function'?service.resume:service.submit):service.reconcile)(copy(attempt),{signal:c.signal});
   const outcome=checkOutcome(received,attempt);
   await recordAttempt(key,id,attempt.review,row=>{
    check(same(row.authorization,attempt.authorization),'The saved authorization changed.');
    if(['executed','refunded','expired'].includes(row.status)){check(same(row.outcome,outcome),'Settlement observations conflict.');return;}
    row.outcome=copy(outcome);row.status=['executed','refunded','expired'].includes(outcome.status)?outcome.status:row.authorization?'submission-unresolved':'approval-unresolved';
   });
   service.outcomeRetained?.(copy(outcome),copy(attempt));
   current(ticket,c.signal);phase='activity';
  }catch(reason){if(ticket===generation)error=reason instanceof Error?reason.message:'Completion is unknown. Check status before trying again.';throw reason;}
  finally{if(ticket===generation){busy=false;controller=null;paint();}}
  return snapshot();
 }
 async function recoverOutcome(id,operation){
  check(!busy&&typeof service.recover==='function','Original recovery is unavailable.');const original=copy(state.attempts.find(row=>row.id===id));check(original?.authorization&&!['executed','refunded','expired'].includes(original.status),'Check the original unresolved request first.');
  const chosen=reviewSelection(original.review),lease=source.capture();sourceMatches(lease,chosen);const key=owner,ticket=++generation,c=new AbortController();controller=c;busy=true;error='';paint();
  try{
   const observed=checkOutcome(await service.reconcile(copy(original),{signal:c.signal}),original);current(ticket,c.signal);sourceMatches(lease,chosen);
   await recordAttempt(key,id,original.review,row=>{check(same(row.authorization,original.authorization),'The original recovery authority changed.');row.outcome=copy(observed);row.status=['executed','refunded','expired'].includes(observed.status)?observed.status:'submission-unresolved';});
   current(ticket,c.signal);if(['executed','refunded','expired'].includes(observed.status)){phase='activity';return {...snapshot(),busy:false};}
   check(observed.recovery?.available===true&&observed.recovery.operation===operation,'The original request has no checked recovery operation.');
   await persist(retained=>{const row=retained.attempts.find(attempt=>attempt.id===id);check(same(row.authorization,original.authorization)&&same(row.outcome,observed),'The original recovery request changed.');row.recoveryRequested={operation,requestedAt:now()};},ticket,c.signal);
   const attempt=copy(state.attempts.find(row=>row.id===id)),outcome=checkOutcome(await service.recover(attempt,operation,{signal:c.signal}),attempt);
   await recordAttempt(key,id,original.review,row=>{check(same(row.authorization,original.authorization),'The original recovery authority changed.');row.outcome=copy(outcome);row.status=['executed','refunded','expired'].includes(outcome.status)?outcome.status:'submission-unresolved';});service.outcomeRetained?.(copy(outcome),copy(attempt));current(ticket,c.signal);phase='activity';
  }catch(reason){if(ticket===generation)error=reason instanceof Error?reason.message:'Original recovery is unknown. Check its status.';throw reason;}
  finally{if(ticket===generation){busy=false;controller=null;paint();}}
  return snapshot();
 }
 return Object.freeze({snapshot,select,restore,prepare,cancel,approve,recoverAuthorization,recover:recoverOutcome,dispatch:id=>outcomeOperation(id,true),resume:id=>outcomeOperation(id,true,true),reconcile:id=>outcomeOperation(id,false)});
}
