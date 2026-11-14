import test from 'node:test';
import assert from 'node:assert/strict';
import {accountKeys} from './public/account-keys.js';
import {restoreIntentActionRecovery} from './public/intent-action-store.js';
import {snapshotIntentRecovery,validateIntentRecovery,restoreIntentRecovery} from './public/intent-account-recovery.js';
import {createAccountBackup,openAccountBackup} from './public/account-backup.js';
import {digest} from './public/peer-crypto.js';
import {zcashTestSelection,ZCASH_INTENT_ASSET,zcashPaymentTerms} from './public/intent-zcash-plan.js';
import {RECOVERED_CHAT,requirePaymentAccess} from './public/chat-access.js';

async function fixture({expired=false}={}){
 const material=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer),state={identity:material.identity,contacts:[],messages:[]};
 const source='native-zcash:a:'+'1'.repeat(64),recipient='utest1'+'q'.repeat(70),chosen=zcashTestSelection(source,recipient,'0.01',{requestId:'11111111-1111-4111-8111-111111111111',deadline:1000});
 const native={id:'22222222-2222-4222-8222-222222222222',wallet:'a',network:'testnet',pool:'ironwood',recipient:'b',address:recipient,amount:'1000000',fee:'10000',change:'990000',totalDebit:'1010000',txid:'2'.repeat(64),unsignedSha256:'3'.repeat(64),memoBinding:'4'.repeat(64),expiryHeight:4000000,binding:'5'.repeat(64),memos:'empty'};
 const review={...chosen,id:chosen.requestId,reviewedAt:500,authorityId:native.txid+':'+native.unsignedSha256,native,fees:[{label:'Network fee',amount:native.fee,asset:ZCASH_INTENT_ASSET}],authorization:{custody:'local-native',label:'Approve & sign native payment'},privacyDisclosure:'Ironwood shielded testnet payment.',recoveryDisclosure:'The native wallet and signed artifact stay local. Browser backup cannot restore funds.'};
 native.binding=await digest(zcashPaymentTerms(review));
 const authorization={intentId:review.id,artifactId:'6'.repeat(64),signedSha256:'6'.repeat(64),paymentBinding:native.binding,txid:native.txid,custody:'local-native'},outcome={intentId:review.id,artifactId:authorization.artifactId,status:'unknown',verified:false,resubmissionSafe:false};
 if(expired)Object.assign(outcome,{status:'expired',verified:true,nativeState:'expired',evidence:{network:'testnet',verifier:'native-canonical-expiry/v1',pool:'ironwood',transaction:native.txid,signedSha256:authorization.signedSha256,unsignedSha256:native.unsignedSha256,expiryHeight:native.expiryHeight,sourceHeight:4000010,recipientHeight:4000010,sourceCanonicalHash:'c'.repeat(64),recipientCanonicalHash:'d'.repeat(64),paymentAbsent:true,inputUnspent:true}});
 const records=[{owner:JSON.stringify([chosen.source.chainId,source]),journal:{draft:chosen,review,attempts:[{id:review.id,authorityId:review.authorityId,review,createdAt:600,status:expired?'expired':'submission-unresolved',authorization,outcome}]}}];
 await restoreIntentActionRecovery(state,records);const m=material;state.accountSync={accountId:m.accountId,authority:m.authority,backupKey:m.backupKey,deviceKey:m.deviceKey,phraseBox:m.phraseBox,revision:0,digest:'',version:1,savedVersion:0};return {state,material,records};
}

test('native archive rejects changed source, request, authority, signed digest and settlement claims',async()=>{
 const f=await fixture(),original=await snapshotIntentRecovery(f.state);
 for(const mutate of [
  value=>{value.actions[0].journal.attempts[0].review.source.accountId='native-zcash:a:'+'9'.repeat(64);},
  value=>{value.actions[0].journal.attempts[0].review.requestId='33333333-3333-4333-8333-333333333333';},
  value=>{value.actions[0].journal.attempts[0].review.native.wallet='b';},
  value=>{value.actions[0].journal.attempts[0].review.native.id='44444444-4444-4444-8444-444444444444';},
  value=>{const record=value.actions[0];record.owner=JSON.stringify(['unknown:testnet',record.journal.draft.source.accountId]);for(const selection of [record.journal.draft,record.journal.review,...record.journal.attempts.map(attempt=>attempt.review)]){selection.source.chainId='unknown:testnet';selection.destination.chainId='unknown:testnet';}},
  value=>{value.actions[0].journal.attempts[0].authorityId='unrelated-original-authority';},
  value=>{value.actions[0].journal.attempts[0].authorization.signedSha256='7'.repeat(64);},
  value=>{value.actions[0].journal.attempts[0].authorization.paymentBinding='8'.repeat(64);},
  value=>{value.actions[0].journal.attempts[0].outcome.verified=true;},
  value=>{value.actions[0].journal.attempts[0].status='executed';}
 ]){const changed=structuredClone(original);mutate(changed);await assert.rejects(()=>validateIntentRecovery(changed,f.state.identity));}
});

test('encrypted Lenz archive retains the original unresolved native artifact without native custody',async()=>{
 const f=await fixture(),original=await snapshotIntentRecovery(f.state),archive=await createAccountBackup(f.state),opened=await openAccountBackup(f.material,{archive,revision:archive.revision,digest:await digest(archive),savedAt:Date.now()});
 assert(!JSON.stringify(archive).includes(f.records[0].journal.attempts[0].authorization.signedSha256));
 assert.deepEqual(opened.intentRecovery.actions,original.actions);assert.equal(opened.intentRecovery.nearSource,null);assert.deepEqual(Object.keys(opened.intentRecovery).sort(),['actions','nearSource','owner','type']);
 const restored={identity:structuredClone(opened.recovered.identity),contacts:[],messages:[]};restored.identity.access=RECOVERED_CHAT;await restoreIntentRecovery(restored,opened.intentRecovery);
 assert.deepEqual((await snapshotIntentRecovery(restored)).actions,original.actions);assert.equal(restored.zcashNativeWallet,undefined);assert.throws(()=>requirePaymentAccess(restored.identity),/Offline funds are not restored/);
});

test('encrypted recovery retains expired native authority and rejects changed expiry or balance-credit claims',async()=>{
 const f=await fixture({expired:true}),original=await snapshotIntentRecovery(f.state),archive=await createAccountBackup(f.state),opened=await openAccountBackup(f.material,{archive,revision:archive.revision,digest:await digest(archive),savedAt:Date.now()});
 assert.deepEqual(opened.intentRecovery.actions,original.actions);assert.equal(opened.intentRecovery.actions[0].journal.attempts[0].status,'expired');assert.equal(opened.intentRecovery.actions[0].journal.attempts[0].authorization.signedSha256,'6'.repeat(64));assert(!JSON.stringify(archive).includes('6'.repeat(64)));
 for(const change of [row=>{row.status='submission-unresolved';},row=>{row.outcome.evidence.sourceHeight=4000009;},row=>{row.outcome.evidence.inputUnspent=false;},row=>{row.outcome.evidence.signedSha256='8'.repeat(64);},row=>{row.outcome.evidence.inputAmount='1010000';},row=>{row.outcome.resubmissionSafe=true;}]){
  const value=structuredClone(original);change(value.actions[0].journal.attempts[0]);await assert.rejects(()=>validateIntentRecovery(value,f.state.identity));
 }
});
