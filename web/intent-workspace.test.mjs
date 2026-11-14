import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntentWorkspace} from './public/intent-workspace.js';
import {readFile} from 'node:fs/promises';
import {zcashTestSelection,checkZcashSelection,checkZcashReview,checkZcashAuthorization,checkZcashOutcome} from './public/intent-zcash-plan.js';

test('native dispatch restores the exact route and request ID from its retained signed review',async()=>{
 const f=fixture(),owner='native-zcash:a:'+'1'.repeat(64),chosen=zcashTestSelection(owner,'utest1'+'q'.repeat(70),'0.01',{requestId:'11111111-1111-4111-8111-111111111111',deadline:20000});
 const native={id:'22222222-2222-4222-8222-222222222222',wallet:'a',recipient:'b',network:'testnet',pool:'ironwood',address:chosen.destination.accountId,amount:'1000000',fee:'10000',change:'1000000',totalDebit:'1010000',txid:'2'.repeat(64),unsignedSha256:'3'.repeat(64),memoBinding:'4'.repeat(64),binding:'5'.repeat(64),expiryHeight:500,memos:'empty'};
 const review={...chosen,id:chosen.requestId,reviewedAt:1000,authorityId:native.txid+':'+native.unsignedSha256,native,fees:[{amount:native.fee,asset:chosen.source.asset}],authorization:{custody:'local-native',label:'Approve & sign native payment'},privacyDisclosure:'Native shielded testnet payment.',recoveryDisclosure:'Retain the same local native artifact.'};
 const authorization={intentId:review.id,artifactId:'6'.repeat(64),signedSha256:'6'.repeat(64),paymentBinding:native.binding,txid:native.txid,custody:'local-native'};
 f.setSource({chainId:chosen.source.chainId,accountId:owner});
 f.service.capabilities=async selection=>{checkZcashSelection(selection);assert.deepEqual(selection,chosen);return {available:true,execute:true,privacy:'private'};};
 f.service.prepare=async()=>{f.calls.push('native-prepare');return structuredClone(review);};f.service.validateReview=checkZcashReview;f.service.authorityId=review=>review.authorityId;
 f.service.authorize=async()=>{f.calls.push('native-authorize');return structuredClone(authorization);};f.service.validateAuthorization=checkZcashAuthorization;
 f.service.submit=async attempt=>{f.calls.push('native-submit');assert.deepEqual(attempt.review,review);assert.deepEqual(attempt.authorization,authorization);return {intentId:review.id,artifactId:authorization.artifactId,status:'pending',verified:false,resubmissionSafe:false,nativeState:'submitted'};};f.service.validateOutcome=checkZcashOutcome;
 const workspace=f.workspace();await workspace.select(chosen);await workspace.prepare();await workspace.approve();await workspace.cancel();
 const reopened=f.workspace();await reopened.restore(chosen.source);assert.equal(reopened.snapshot().attempts[0].status,'authorized');await reopened.dispatch(review.id);
 assert.equal(reopened.snapshot().attempts[0].status,'submission-unresolved');assert.deepEqual(reopened.snapshot().attempts[0].authorization,authorization);assert.deepEqual(f.calls,['native-prepare','native-authorize','native-submit']);
});

test('checking an expired original keeps native authorization and prevents another submission after restart',async()=>{
 const f=fixture(),owner='native-zcash:a:'+'1'.repeat(64),chosen=zcashTestSelection(owner,'utest1'+'q'.repeat(70),'0.01',{requestId:'11111111-1111-4111-8111-111111111111',deadline:20000});
 const native={id:'22222222-2222-4222-8222-222222222222',wallet:'a',recipient:'b',network:'testnet',pool:'ironwood',address:chosen.destination.accountId,amount:'1000000',fee:'10000',change:'1000000',totalDebit:'1010000',txid:'2'.repeat(64),unsignedSha256:'3'.repeat(64),memoBinding:'4'.repeat(64),binding:'5'.repeat(64),expiryHeight:500,memos:'empty'};
 const review={...chosen,id:chosen.requestId,reviewedAt:1000,authorityId:native.txid+':'+native.unsignedSha256,native,fees:[{amount:native.fee,asset:chosen.source.asset}],authorization:{custody:'local-native',label:'Approve & sign native payment'},privacyDisclosure:'Native shielded testnet payment.',recoveryDisclosure:'Retain the same local native artifact.'};
 const authorization={intentId:review.id,artifactId:'6'.repeat(64),signedSha256:'6'.repeat(64),paymentBinding:native.binding,txid:native.txid,custody:'local-native'};
 const result={intentId:review.id,artifactId:authorization.artifactId,status:'expired',verified:true,resubmissionSafe:false,nativeState:'expired',evidence:{network:'testnet',verifier:'native-canonical-expiry/v1',pool:'ironwood',transaction:native.txid,signedSha256:authorization.signedSha256,unsignedSha256:native.unsignedSha256,expiryHeight:500,sourceHeight:510,recipientHeight:510,sourceCanonicalHash:'c'.repeat(64),recipientCanonicalHash:'d'.repeat(64),paymentAbsent:true,inputUnspent:true,description:'Payment expired unused. This payment sent no funds.'}};
 f.setSource({chainId:chosen.source.chainId,accountId:owner});f.service.prepare=async()=>structuredClone(review);f.service.validateReview=checkZcashReview;f.service.authorityId=value=>value.authorityId;f.service.authorize=async()=>structuredClone(authorization);f.service.validateAuthorization=checkZcashAuthorization;f.service.reconcile=async()=>structuredClone(result);f.service.validateOutcome=checkZcashOutcome;
 const workspace=f.workspace();await workspace.select(chosen);await workspace.prepare();await workspace.approve();f.setTime(30000);await workspace.reconcile(review.id);
 assert.equal(workspace.snapshot().attempts[0].status,'expired');assert.deepEqual(workspace.snapshot().attempts[0].authorization,authorization);assert.equal(workspace.snapshot().attempts[0].outcome.evidence.inputAmount,undefined);
 const reopened=f.workspace();await reopened.restore(chosen.source);assert.equal(reopened.snapshot().attempts[0].status,'expired');await assert.rejects(()=>reopened.dispatch(review.id),/existing request/);await assert.rejects(()=>reopened.resume(review.id));assert(!f.calls.includes('submit'));
});

test('an interrupted approval recovers its original artifact without signing or submitting again',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.authorize=async()=>{f.calls.push('authorize');throw Error('Lost signing response');};
 await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/Lost signing response/);
 f.service.recoverAuthorization=async attempt=>{f.calls.push('recover');return {intentId:attempt.id,artifactId:'original-signed-artifact',payload:'original signed bytes'};};
 f.setTime(30000);await workspace.recoverAuthorization('intent-one');
 assert.equal(workspace.snapshot().attempts[0].status,'authorized');assert.equal(workspace.snapshot().attempts[0].authorization.artifactId,'original-signed-artifact');
 assert.deepEqual(f.calls,['prepare','authorize','recover']);await assert.rejects(workspace.dispatch('intent-one'),/expired/);
 await assert.rejects(workspace.recoverAuthorization('intent-one'),/cannot be recovered/);
});
test('approval recovery rejects a foreign artifact and a changed source without replacing the unresolved request',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.authorize=async()=>{throw Error('Lost reply');};
 await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/Lost reply/);
 f.service.recoverAuthorization=async()=>({intentId:'another-intent',artifactId:'foreign-artifact'});
 await assert.rejects(workspace.recoverAuthorization('intent-one'),/another request/);assert.equal(workspace.snapshot().attempts[0].status,'approval-unresolved');
 let recovered=0;f.service.recoverAuthorization=async()=>{recovered++;};f.setSource({chainId:'test:source',accountId:'mallory'});
 await assert.rejects(workspace.recoverAuthorization('intent-one'),/original wallet/);assert.equal(recovered,0);
});

const selection=()=>({action:'swap',source:{chainId:'test:source',asset:'test:eth',accountId:'alice',amount:'100'},destination:{chainId:'test:target',asset:'test:token',accountId:'alice',minAmount:'90'},deadline:20000,privacy:'private'});
test('a missing approval artifact remains fenced after an unknown expiry check without calling the wallet',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.requiresExclusiveSource=true;f.service.supportsUnsignedExpiry=true;f.service.authorize=async()=>{throw Error('Original response lost');};await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve());
 f.service.reconcile=async attempt=>({intentId:attempt.id,status:'unknown',verified:false,permissionExpired:true});await workspace.reconcile('intent-one');assert.equal(workspace.snapshot().attempts[0].status,'approval-unresolved');assert.equal(workspace.snapshot().attempts[0].authorization,null);assert.deepEqual(f.calls,['prepare']);
 const prepare=f.service.prepare;f.service.prepare=async chosen=>({...await prepare(chosen),id:'intent-two'});f.service.authorityId=()=> 'fixture-chain:alice:nonce-2';await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/existing request for these funds/);assert(!f.calls.includes('submit'));
});
function fixture(create=createIntentWorkspace){
 let retained={draft:null,review:null,attempts:[]},calls=[],current={chainId:'test:source',accountId:'alice'},time=1000;
 const store={async read(){return structuredClone(retained);},async update(owner,operation){const next=structuredClone(retained),result=await operation(next);retained=next;return structuredClone(result);}};
 const source={capture(){const identity=structuredClone(current);return {identity,assertCurrent(){assert.deepEqual(current,identity,'Source account changed');}};}};
 const service={async capabilities(){return {available:true,execute:true,privacy:'private',reason:''};},async prepare(chosen){calls.push('prepare');return {id:'intent-one',routeId:'test-route',...structuredClone(chosen),fees:[],evidence:{scope:'Fixture only'},authorization:{standard:'ERC191',payload:'exact fixture authorization',verifyingContract:'test-contract',nonce:'1'},sourceRevision:'fixture-block',configHash:'fixture-config'};},validateReview(review){return structuredClone(review);},async authorize(review){calls.push('authorize');return {intentId:review.id,artifactId:'signed-intent-one',payload:'fixture signed payload'};},validateAuthorization(authorization){return structuredClone(authorization);},async submit(attempt){calls.push('submit');return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'pending'};},async reconcile(attempt){calls.push('reconcile');return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'executed',evidence:{transaction:'fixture transaction',outputAmount:'90',scope:'Fixture only'}};},validateOutcome(outcome){return structuredClone(outcome);}};
 service.authorityId=()=> 'fixture-chain:alice:nonce-1';
 return {store,source,service,calls,setSource:value=>current=value,setTime:value=>time=value,workspace:()=>create({store,source,service,now:()=>time})};
}

test('choosing an outcome preserves its funds and destination through preparation and cancellation',async()=>{
 const f=fixture(),workspace=f.workspace(),chosen=selection();await workspace.select(chosen);chosen.destination.accountId='mallory';
 await workspace.prepare();assert.equal(workspace.snapshot().review.destination.accountId,'alice');
 await workspace.cancel();assert.deepEqual(workspace.snapshot().draft,selection());assert.equal(workspace.snapshot().review,null);
 const reopened=f.workspace();await reopened.restore(selection().source);assert.deepEqual(reopened.snapshot().draft,selection());assert.equal(reopened.snapshot().review,null);
});

test('another intent cannot reuse the same unresolved source authority',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.authorityId=()=> 'fixture-chain:alice:nonce-1';
 await workspace.select(selection());await workspace.prepare();await workspace.approve();
 const prepare=f.service.prepare;f.service.prepare=async chosen=>({...await prepare(chosen),id:'intent-two'});
 await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/source authorit/);
 assert.equal(workspace.snapshot().attempts.length,1);
});

test('approved terms and the exact signed request survive restart before dispatch',async()=>{
 const f=fixture(),workspace=f.workspace();await workspace.select(selection());await workspace.prepare();await workspace.approve();
 assert.equal(workspace.snapshot().attempts[0].status,'authorized');
 const reopened=f.workspace();await reopened.restore(selection().source);assert.equal(reopened.snapshot().attempts[0].authorization.artifactId,'signed-intent-one');
 await reopened.dispatch('intent-one');assert.equal(reopened.snapshot().attempts[0].status,'submission-unresolved');
 f.service.reconcile=async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'executed',verified:true,evidence:{transaction:'fixture transaction',outputAmount:'90',scope:'Fixture only'}});
 await reopened.reconcile('intent-one');assert.equal(reopened.snapshot().attempts[0].status,'executed');
 assert.equal(reopened.snapshot().attempts[0].outcome.evidence.outputAmount,'90');
 await assert.rejects(reopened.dispatch('intent-one'),/Check the existing request/);
});

test('a route cannot replace the requested action while preserving its amounts',async()=>{
 const f=fixture(),workspace=f.workspace(),prepare=f.service.prepare;
 f.service.prepare=async chosen=>({...await prepare(chosen),action:'pay'});
 await workspace.select(selection());await assert.rejects(workspace.prepare(),/changed the reviewed action/);
 assert.equal(workspace.snapshot().review,null);
});

test('an account change invalidates an existing review before wallet approval',async()=>{
 const f=fixture(),workspace=f.workspace();await workspace.select(selection());await workspace.prepare();
 f.setSource({chainId:'test:source',accountId:'mallory'});await assert.rejects(workspace.approve(),/original wallet/);
 assert.equal(workspace.snapshot().attempts.length,0);assert(!f.calls.includes('authorize'));
});

test('unavailable private execution never opens a wallet approval',async()=>{
 const f=fixture(),workspace=f.workspace();await workspace.select(selection());await workspace.prepare();
 f.service.capabilities=async()=>({available:true,execute:false,privacy:'private',reason:'Testnet route is not verified.'});
 await assert.rejects(workspace.approve(),/not verified/);assert(!f.calls.includes('authorize'));assert.equal(workspace.snapshot().attempts.length,0);
});

test('closing during wallet approval retains a late signature under its original request',async()=>{
 const f=fixture(),workspace=f.workspace();let finish,started;const prompted=new Promise(resolve=>started=resolve);
 f.service.authorize=async review=>{started();return new Promise(resolve=>finish=()=>resolve({intentId:review.id,artifactId:'late-signed-intent',payload:'fixture signed payload'}));};
 await workspace.select(selection());await workspace.prepare();const approval=workspace.approve();await prompted;await workspace.cancel();finish();
 await assert.rejects(approval,/changed|aborted/);const reopened=f.workspace();await reopened.restore(selection().source);
 assert.equal(reopened.snapshot().review,null);assert.equal(reopened.snapshot().attempts[0].status,'authorized');assert.equal(reopened.snapshot().attempts[0].authorization.artifactId,'late-signed-intent');
 assert(!f.calls.includes('submit'));
});

test('a missing wallet response preserves an unresolved approval and blocks replacement',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.authorize=async()=>{throw Error('Wallet response lost');};
 await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/response lost/);
 const reopened=f.workspace();await reopened.restore(selection().source);assert.equal(reopened.snapshot().attempts[0].status,'approval-unresolved');
 await assert.rejects(reopened.approve(),/existing request/);assert.equal(reopened.snapshot().attempts.length,1);
});

test('a missing submission response requires reconciliation of the same signed artifact',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.submit=async()=>{throw Error('Network response lost');};
 await workspace.select(selection());await workspace.prepare();await workspace.approve();await assert.rejects(workspace.dispatch('intent-one'),/response lost/);
 const reopened=f.workspace();await reopened.restore(selection().source);assert.equal(reopened.snapshot().attempts[0].status,'submission-unresolved');
 await assert.rejects(reopened.dispatch('intent-one'),/existing request/);
 f.service.reconcile=async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'pending'});
 await reopened.reconcile('intent-one');assert.equal(reopened.snapshot().attempts[0].authorization.artifactId,'signed-intent-one');
});

test('provider observations cannot mark a request executed or refunded',async()=>{
 const f=fixture(),workspace=f.workspace();await workspace.select(selection());await workspace.prepare();await workspace.approve();await workspace.dispatch('intent-one');
 await assert.rejects(workspace.reconcile('intent-one'),/independently verified/);assert.equal(workspace.snapshot().attempts[0].status,'submission-unresolved');
 f.service.reconcile=async()=>({intentId:'intent-one',artifactId:'another-signature',status:'executed',verified:true,evidence:{transaction:'wrong fixture'}});
 await assert.rejects(workspace.reconcile('intent-one'),/another request/);assert.equal(workspace.snapshot().attempts[0].status,'submission-unresolved');
});

test('a failed journal write prevents financial dispatch',async()=>{
 const f=fixture(),workspace=f.workspace();await workspace.select(selection());await workspace.prepare();await workspace.approve();
 f.store.update=async()=>{throw Error('Storage quota exceeded');};await assert.rejects(workspace.dispatch('intent-one'),/Storage quota/);
 assert(!f.calls.includes('submit'));assert.equal(workspace.snapshot().attempts[0].status,'authorized');
});

test('a known wallet decline permits a fresh approval of the same unchanged review',async()=>{
 const f=fixture(),workspace=f.workspace(),authorize=f.service.authorize;
 f.service.authorize=async()=>{throw Object.assign(Error('User declined'),{code:4001});};
 await workspace.select(selection());await workspace.prepare();await assert.rejects(workspace.approve(),/declined/);
 assert.equal(workspace.snapshot().attempts[0].status,'declined');
 f.service.authorize=authorize;await workspace.approve();assert.equal(workspace.snapshot().attempts.length,1);assert.equal(workspace.snapshot().attempts[0].status,'authorized');
});

test('resuming keeps the original signed request and rechecks its safe status before submission',async()=>{
 const f=fixture(),workspace=f.workspace();f.service.supportsOriginalResume=true;
 await workspace.select(selection());await workspace.prepare();await workspace.approve();await workspace.dispatch('intent-one');
 f.service.reconcile=async attempt=>{f.calls.push('status');return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:true};};
 await workspace.reconcile('intent-one');const original=workspace.snapshot().attempts[0];
 const reopened=f.workspace();await reopened.restore(selection().source);await reopened.resume('intent-one');
 const resumed=reopened.snapshot().attempts;assert.equal(resumed.length,1);assert.deepEqual(resumed[0].authorization,original.authorization);assert.deepEqual(resumed[0].review,original.review);assert.equal(f.calls.filter(call=>call==='authorize').length,1);assert.equal(f.calls.filter(call=>call==='status').length,2);assert.equal(f.calls.filter(call=>call==='submit').length,2);
});
async function resumable(create=createIntentWorkspace){
 const f=fixture(create),workspace=f.workspace();f.service.supportsOriginalResume=true;await workspace.select(selection());await workspace.prepare();await workspace.approve();await workspace.dispatch('intent-one');
 f.service.reconcile=async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:true});await workspace.reconcile('intent-one');return {...f,workspace};
}
async function rejectsFreshUnsafe(create=createIntentWorkspace){
 const f=await resumable(create);f.service.reconcile=async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:false});
 await assert.rejects(f.workspace.resume('intent-one'),/original transaction/);assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.workspace.snapshot().attempts[0].outcome.resubmissionSafe,false);
}
test('a cached safe result cannot override a fresh report that the original transaction may exist',()=>rejectsFreshUnsafe());
test('an explicit original resume uses the retained authority even while new sponsorship is fenced',async()=>{
 const f=await resumable(),original=f.workspace.snapshot().attempts[0];let resumed=null;
 f.service.capabilities=async()=>({available:false,execute:false,privacy:'private'});
 f.service.resume=async attempt=>{resumed=attempt;return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'pending'};};
 await f.workspace.resume('intent-one');assert.deepEqual(resumed.authorization,original.authorization);assert.deepEqual(resumed.review,original.review);assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.calls.filter(call=>call==='authorize').length,1);
});
test('resume requires the route declaration and the original source through the fresh check',async()=>{
 const f=await resumable();f.service.supportsOriginalResume=false;await assert.rejects(f.workspace.resume('intent-one'),/before resuming/);assert.equal(f.calls.filter(call=>call==='submit').length,1);
 f.service.supportsOriginalResume=true;f.service.reconcile=async attempt=>{f.setSource({chainId:'test:source',accountId:'mallory'});return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:true};};await assert.rejects(f.workspace.resume('intent-one'),/original wallet|Source account/);assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.workspace.snapshot().attempts.length,1);
});
test('resume refuses an expired original permission and a failed history write',async()=>{
 const f=await resumable();f.service.reconcile=async attempt=>{f.setTime(20001);return {intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:true};};await assert.rejects(f.workspace.resume('intent-one'),/permission expired/);assert.equal(f.calls.filter(call=>call==='submit').length,1);
 f.setTime(1000);f.service.reconcile=async attempt=>({intentId:attempt.id,artifactId:attempt.authorization.artifactId,status:'unknown',resubmissionSafe:true});f.store.update=async()=>{throw Error('History cannot be saved');};await assert.rejects(f.workspace.resume('intent-one'),/History cannot/);assert.equal(f.calls.filter(call=>call==='submit').length,1);
});
test('fresh safety regression fails when reconciliation is replaced with the cached result',async()=>{
 const source=await readFile(new URL('./public/intent-workspace.js',import.meta.url),'utf8'),guard='const observed=checkOutcome(await service.reconcile(copy(attempt),{signal:c.signal}),attempt);';assert(source.includes(guard));
 const mutant=source.replace(guard,'const observed=checkOutcome(copy(attempt.outcome),attempt);'),{createIntentWorkspace:mutated}=await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'));
 await assert.rejects(()=>rejectsFreshUnsafe(mutated),assert.AssertionError);
});
