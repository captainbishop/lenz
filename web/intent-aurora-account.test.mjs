import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuroraOwnedAccount,snapshotAuroraAccountRecovery,restoreAuroraAccountRecovery,buildAuroraTransferReview,validateAuroraAccountRecovery} from './public/intent-aurora-account.js';
import {digest} from './public/peer-crypto.js';
import {accountKeys} from './public/account-keys.js';
import {createBackupRunner,requireIntentActionBackup} from './public/account-sync.js';
import {restoreIntentActionRecovery} from './public/intent-action-store.js';
import {Transaction,Wallet} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {openAccountBackup,createAccountBackup} from './public/account-backup.js';
import {RECOVERED_CHAT} from './public/chat-access.js';

async function fixture(){
 const material=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer,'Aurora owner'),state={identity:material.identity,contacts:[],messages:[],accountSync:{accountId:material.accountId,authority:material.authority,backupKey:material.backupKey,deviceKey:material.deviceKey,phraseBox:material.phraseBox,revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};
 const read=async()=>structuredClone(state),update=async(operation,{markBackup=true,signal}={})=>{const next=structuredClone(state),before=JSON.stringify([next.auroraOwnedAccount,next.intentActionBox]),result=await operation(next);signal?.throwIfAborted();if(markBackup&&before!==JSON.stringify([next.auroraOwnedAccount,next.intentActionBox])){next.accountSync.version++;next.accountSync.status='pending';}for(const key of Object.keys(state))delete state[key];Object.assign(state,next);return result;};
 let latest=null;const backup=createBackupRunner({read,update,request:async(sync,operation,pending)=>{if(operation==='read')return latest??{revision:sync.revision,digest:sync.digest};latest={archive:pending.archive,revision:pending.expected+1,digest:await digest(pending.archive),savedAt:Date.now()};return latest;}});
 return {state,material,read,update,backup,latest:()=>latest,account:createAuroraOwnedAccount(state.identity.profile.id,{read,update,backupState:backup})};
}
test('a personal Aurora destination recovers the same spending address with a new encryption key',async()=>{
 const f=await fixture(),identity=await f.account.connect(),again=await f.account.connect();assert.deepEqual(again,identity);
 assert.equal(identity.chainId,'eip155:1313161555');assert.match(identity.accountId,/^0x[0-9a-f]{40}$/);assert.equal(identity.accountId,identity.address);
 const recovery=await snapshotAuroraAccountRecovery(f.state),restored={identity:structuredClone(f.state.identity),contacts:[],messages:[]};
 assert(!JSON.stringify(f.state.auroraOwnedAccount).includes(recovery.privateKey));assert.equal(f.state.auroraOwnedAccount.key.extractable,false);
 await restoreAuroraAccountRecovery(restored,recovery);const source=createAuroraOwnedAccount(restored.identity.profile.id,{read:async()=>structuredClone(restored),update:async operation=>operation(restored)});
 assert.deepEqual(await source.connect(),identity);assert.notEqual(restored.auroraOwnedAccount.key,f.state.auroraOwnedAccount.key);
 const other=await fixture();await assert.rejects(()=>restoreAuroraAccountRecovery(other.state,recovery),/another account/);
 f.account.dispose();source.dispose();other.account.dispose();
});
test('dispatch fences and the exact original signature survive encrypted archive recovery',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildAuroraTransferReview(identity,{recipient:'0x2222222222222222222222222222222222222222',amount:'500000',nonce:0,gasLimit:'90000',gasPrice:'70000000'}),signed=await f.account.capture().signTransfer(review);
 assert.deepEqual(await f.account.beginTransferDispatch(review.id),signed);await assert.rejects(()=>f.account.beginTransferDispatch(review.id),/original.*status|already/);
 const restored={identity:structuredClone(f.state.identity),contacts:[],messages:[]},opened=await openAccountBackup(f.material,f.latest());assert.equal(opened.intentRecovery.auroraAccount.transfers[0].status,'submission-unresolved');assert(!JSON.stringify(f.latest().archive).includes(signed.bytes));assert(!JSON.stringify(f.latest().archive).includes(opened.intentRecovery.auroraAccount.privateKey));
 restored.identity.access=RECOVERED_CHAT;await restoreAuroraAccountRecovery(restored,opened.intentRecovery.auroraAccount);const account=createAuroraOwnedAccount(restored.identity.profile.id,{read:async()=>structuredClone(restored),update:async fn=>fn(restored)});await account.connect();assert.deepEqual(await account.originalTransfer(review.id),signed);
 f.account.dispose();account.dispose();f.backup.stop();
});
test('wrong networks, tokens, gas and changed signed transactions cannot enter recovery or signing',async()=>{
 const f=await fixture(),identity=await f.account.connect(),input={recipient:'0x2222222222222222222222222222222222222222',amount:'1000000',nonce:3,gasLimit:'90000',gasPrice:'70000000'};
 assert.throws(()=>buildAuroraTransferReview({...identity,chainId:'eip155:11155111'},input));assert.throws(()=>buildAuroraTransferReview(identity,{...input,gasLimit:'200001'}));assert.throws(()=>buildAuroraTransferReview(identity,{...input,gasPrice:'1000000000000'}));
 const review=buildAuroraTransferReview(identity,input);for(const [field,value]of [['chainId','eip155:1'],['token','0xafa88fe18a46dda58e79d8f89abda51c13411590'],['recipient','0x3333333333333333333333333333333333333333'],['nonce',4]])await assert.rejects(()=>f.account.capture().signTransfer({...review,[field]:value}));
 const signed=await f.account.capture().signTransfer(review),recovery=await snapshotAuroraAccountRecovery(f.state),altered=structuredClone(recovery),oracle=Transaction.from(signed.bytes);oracle.signature=null;oracle.to='0xafa88fe18a46dda58e79d8f89abda51c13411590';const changed=await new Wallet(recovery.privateKey).signTransaction(oracle.toJSON());altered.transfers[0].signed.bytes=changed;altered.transfers[0].signed.transactionHash=Transaction.from(changed).hash;assert.throws(()=>validateAuroraAccountRecovery(altered,f.state.identity),/does not match/);
 const badKey=structuredClone(recovery);badKey.privateKey='0x'+'0'.repeat(64);assert.throws(()=>validateAuroraAccountRecovery(badKey,f.state.identity));
 const conflicting=structuredClone(recovery);conflicting.address='0x3333333333333333333333333333333333333333';await assert.rejects(()=>restoreAuroraAccountRecovery(f.state,conflicting));assert.deepEqual(await f.account.originalTransfer(review.id),signed);
 const lease=f.account.capture();f.account.disconnect();assert.throws(()=>lease.assertCurrent());f.account.dispose();f.backup.stop();
});
test('a missing source in the actual encrypted backup blocks signing and leaves the original review fenced',async()=>{
 const f=await fixture(),identity=await f.account.connect(),backup=createBackupRunner({read:f.read,update:f.update,capture:state=>{delete state.auroraOwnedAccount;return createAccountBackup(state);},request:async()=>{throw Error('No incomplete archive should be uploaded.');}}),account=createAuroraOwnedAccount(identity.lenzIdentity,{read:f.read,update:f.update,backupState:backup});await account.connect();
 const review=buildAuroraTransferReview(identity,{recipient:'0x2222222222222222222222222222222222222222',amount:'1000000',nonce:0,gasLimit:'90000',gasPrice:'70000000'});await assert.rejects(()=>account.capture().signTransfer(review),/did not preserve/);const recovery=await snapshotAuroraAccountRecovery(f.state);assert.equal(recovery.transfers[0].status,'approval-unresolved');assert.equal(recovery.transfers[0].signed,null);
 account.dispose();f.account.dispose();backup.stop();f.backup.stop();
});
test('the proof gate acknowledges the exact saved action and rejects a changed journal after backup',async()=>{
 const f=await fixture(),chosen={action:'swap',privacy:'private',source:{chainId:'test:backup-boundary',accountId:'original-source',asset:'owned-note',amount:'1000000'},destination:{chainId:'test:backup-boundary',accountId:'recoverable-destination',asset:'output',minAmount:'2000000'},deadline:Date.now()+300000},review={...chosen,id:'exact-reviewed-action'},owner=JSON.stringify([chosen.source.chainId,chosen.source.accountId]);
 await f.update(state=>restoreIntentActionRecovery(state,[{owner,journal:{draft:chosen,review,attempts:[]}}]));
 await requireIntentActionBackup(f.state.identity.profile.id,owner,review.id,{read:f.read,backup:f.backup});assert(f.state.accountSync.intentActionsBackup.version>0);
 await assert.rejects(()=>requireIntentActionBackup(f.state.identity.profile.id,owner,'another-action',{read:f.read,backup:f.backup}),/original reviewed action/);
 await assert.rejects(()=>requireIntentActionBackup(f.state.identity.profile.id,owner,review.id,{read:f.read,backup:async()=>{await f.backup();await f.update(state=>restoreIntentActionRecovery(state,[{owner,journal:{draft:chosen,review,attempts:[{id:review.id,authorityId:'owned-note-boundary',review,createdAt:Date.now(),status:'approval-unresolved',authorization:null,outcome:null}]}}]));}}),/changed|not backed up/);
 f.account.dispose();f.backup.stop();
});
test('next spend signs only the exact reviewed LTT transfer and keeps its original bytes recoverable',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildAuroraTransferReview(identity,{recipient:'0x2222222222222222222222222222222222222222',amount:'1000000',nonce:7,gasLimit:'90000',gasPrice:'1000000000'});
 const signed=await f.account.capture().signTransfer(review),transaction=Transaction.from(signed.bytes);
 assert.equal(transaction.from.toLowerCase(),identity.address);assert.equal(transaction.chainId,1313161555n);assert.equal(transaction.to.toLowerCase(),'0x68884014da20174e79f9e7b06466f3a7c6085b09');assert.equal(transaction.nonce,7);assert.equal(transaction.value,0n);assert.equal(transaction.gasLimit,90000n);assert.equal(transaction.gasPrice,1000000000n);
 assert.equal(transaction.data,'0xa9059cbb'+'0'.repeat(24)+'2'.repeat(40)+'0'.repeat(58)+'0f4240');assert.equal(transaction.hash,signed.transactionHash);
 const recovery=await snapshotAuroraAccountRecovery(f.state);assert.deepEqual(recovery.transfers[0].signed,signed);
 const restored={identity:structuredClone(f.state.identity),contacts:[],messages:[]};await restoreAuroraAccountRecovery(restored,recovery);
 const account=createAuroraOwnedAccount(restored.identity.profile.id,{read:async()=>structuredClone(restored),update:async fn=>fn(restored)});await account.connect();assert.deepEqual(await account.originalTransfer(review.id),signed);
 const changed=structuredClone(review);changed.recipient='0x3333333333333333333333333333333333333333';await assert.rejects(()=>account.capture().signTransfer(changed));
 f.account.dispose();account.dispose();
});
