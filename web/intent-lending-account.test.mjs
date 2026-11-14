import test from 'node:test';
import assert from 'node:assert/strict';
import {createLendingOwnedAccount,snapshotLendingAccountRecovery,restoreLendingAccountRecovery,validateLendingAccountRecovery,buildLendingPermissionReview} from './public/intent-lending-account.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {accountKeys} from './public/account-keys.js';
import {createBackupRunner} from './public/account-sync.js';
import {createAccountBackup,openAccountBackup} from './public/account-backup.js';
import {digest} from './public/peer-crypto.js';
import {createIdentity} from './public/peer-crypto.js';
import {RECOVERED_CHAT} from './public/chat-access.js';
import {Wallet,TypedDataEncoder,verifyTypedData} from '../aurora/node_modules/ethers/lib.esm/index.js';

const factory='0x1111111111111111111111111111111111111111',accountAddress='0x4444444444444444444444444444444444444444';
const hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32);
const config={...LENDING_TESTNET,lendingFactory:factory};
const route={chainId:config.chain,factory,pool:config.pool,link:config.link,usdc:config.usdc,aLink:config.aLink,variableDebt:config.variableDebt,poolCodeHash:hash,linkCodeHash:hash,usdcCodeHash:hash,aLinkCodeHash:hash,variableDebtCodeHash:hash};
const orderTerms={action:0,nonce:'0',deadline:'2000',amount:'5000000',recipient:accountAddress,minResult:'5000000',maxDebt:'6000000',minHealthFactor:'4000000000000000000',maxBorrowRateRay:'1000000000000000000000000000'};
async function fixture({deployed=true}={}){
 const material=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer,'Lending owner');
 const state={identity:material.identity,contacts:[],messages:[],accountSync:{accountId:material.accountId,authority:material.authority,backupKey:material.backupKey,deviceKey:material.deviceKey,phraseBox:material.phraseBox,revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};
 const read=async()=>structuredClone(state),update=async(operation,{markBackup=true,signal}={})=>{
  const next=structuredClone(state),before=JSON.stringify(next.lendingOwnedAccount),result=await operation(next);signal?.throwIfAborted();
  if(markBackup&&before!==JSON.stringify(next.lendingOwnedAccount)){next.accountSync.version++;next.accountSync.status='pending';}
  for(const key of Object.keys(state))delete state[key];Object.assign(state,next);return result;
 };
 let latest=null,observation={deployed,nonce:'0',blockNumber:'100',blockHash,accountCodeHash:deployed?hash:null};
 const observeAccount=async input=>({chainId:config.chain,ownerAddress:input.ownerAddress,factory,account:accountAddress,route,...observation});
 const backup=createBackupRunner({read,update,request:async(sync,operation,pending)=>{
  if(operation==='read')return latest??{revision:sync.revision,digest:sync.digest};
  latest={archive:pending.archive,revision:pending.expected+1,digest:await digest(pending.archive),savedAt:Date.now()};return latest;
 }});
 const account=createLendingOwnedAccount(state.identity.profile.id,{read,update,backupState:backup,config,observeAccount,now:()=>1000000});
 return {state,material,read,update,backup,account,observeAccount,latest:()=>latest,setObservation:changes=>Object.assign(observation,changes)};
}

test('the encrypted archive restores the original lending owner, deployed contract and route under a new device key',async()=>{
 const f=await fixture(),identity=await f.account.connect();
 await f.account.capture().requireRecovery({latest:true,forSupply:true});
 const opened=await openAccountBackup(f.material,f.latest()),snapshot=opened.intentRecovery.lendingAccount;
 assert.equal(snapshot.ownerAddress,new Wallet(snapshot.privateKey).address.toLowerCase());
 assert.equal(snapshot.account,accountAddress);assert.deepEqual(snapshot.route,route);
 assert.equal(f.state.lendingOwnedAccount.key.extractable,false);
 assert(!JSON.stringify(f.state.lendingOwnedAccount).includes(snapshot.privateKey));assert(!JSON.stringify(f.latest().archive).includes(snapshot.privateKey));
 const restored={identity:structuredClone(opened.recovered.identity),contacts:[],messages:[]};restored.identity.access=RECOVERED_CHAT;
 await restoreLendingAccountRecovery(restored,snapshot);
 const recovered=createLendingOwnedAccount(restored.identity.profile.id,{read:async()=>structuredClone(restored),update:fn=>fn(restored),config,now:()=>1000000});
 assert.deepEqual(await recovered.connect(),identity);assert.notEqual(restored.lendingOwnedAccount.key,f.state.lendingOwnedAccount.key);
 f.account.dispose();recovered.dispose();f.backup.stop();
});

test('Order, Cancel and Transfer sign only their exact typed terms and retain original dispatch through archive recovery',async()=>{
 const f=await fixture(),identity=await f.account.connect();
 const order=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});
 const signed=await f.account.capture().signOrder(order);
 const domain={name:'LenzLendingAccount',version:'1',chainId:11155111,verifyingContract:accountAddress};
 const types={Order:[{name:'action',type:'uint8'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'amount',type:'uint256'},{name:'recipient',type:'address'},{name:'minResult',type:'uint256'},{name:'maxDebt',type:'uint256'},{name:'minHealthFactor',type:'uint256'},{name:'maxBorrowRateRay',type:'uint256'}]};
 assert.equal(signed.digest,TypedDataEncoder.hash(domain,types,orderTerms));
 assert.equal(verifyTypedData(domain,types,orderTerms,signed.signature).toLowerCase(),identity.ownerAddress);
 assert.deepEqual(await f.account.beginOrderDispatch(order.id),signed);
 await assert.rejects(()=>f.account.beginOrderDispatch(order.id),/original.*status|already/);
 const cancel=buildLendingPermissionReview(identity,{kind:'Cancel',terms:{nonce:'0',deadline:'2000'},cancels:order.id},{now:1000000,config});
 const cancelSigned=await f.account.capture().signCancel(cancel);
 assert.notEqual(cancelSigned.digest,signed.digest);
 const opened=await openAccountBackup(f.material,f.latest()),restored={identity:structuredClone(opened.recovered.identity),contacts:[],messages:[]};restored.identity.access=RECOVERED_CHAT;
 await restoreLendingAccountRecovery(restored,opened.intentRecovery.lendingAccount);
 const recovered=createLendingOwnedAccount(restored.identity.profile.id,{read:async()=>structuredClone(restored),update:fn=>fn(restored),config,now:()=>1000000});await recovered.connect();
 assert.deepEqual(await recovered.originalOrder(order.id),signed);assert.deepEqual(await recovered.originalOrder(cancel.id),cancelSigned);
 const rows=(await snapshotLendingAccountRecovery(restored)).permissions;assert.equal(rows.find(row=>row.id===order.id).status,'submission-unresolved');
 assert(!JSON.stringify(f.latest().archive).includes(signed.signature));
 f.setObservation({nonce:'1',blockNumber:'101',blockHash:'0x'+'33'.repeat(32)});const next=await f.account.refreshAccount();
 const transfer=buildLendingPermissionReview(next,{kind:'Transfer',terms:{asset:1,nonce:'1',deadline:'2000',amount:'1000000',recipient:'0x5555555555555555555555555555555555555555'}},{now:1000000,config});
 const transferSigned=await f.account.capture().signTransfer(transfer);assert.notEqual(transferSigned.digest,signed.digest);
 f.account.dispose();recovered.dispose();f.backup.stop();
});

test('only the exact reviewed owner, chain, account, action and bounded terms can enter signing',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});
 for(const [field,value] of [['chainId','eip155:1'],['ownerAddress','0x3333333333333333333333333333333333333333'],['account','0x3333333333333333333333333333333333333333'],['id','ff'.repeat(32)],['expiresAt',1060001]])await assert.rejects(()=>f.account.capture().signOrder({...review,[field]:value}));
 for(const [field,value] of Object.entries({action:2,nonce:'1',deadline:'2001',amount:'5000001',recipient:'0x3333333333333333333333333333333333333333',minResult:'4000000',maxDebt:'7000000',minHealthFactor:'2000000000000000000',maxBorrowRateRay:'999999999999999999999999999'}))await assert.rejects(()=>f.account.capture().signOrder({...review,terms:{...review.terms,[field]:value}}));
 for(const terms of [{...orderTerms,nonce:0},{...orderTerms,amount:'01'},{...orderTerms,amount:'0'},{...orderTerms,action:3},{...orderTerms,minResult:'1'},{...orderTerms,minHealthFactor:'999999999999999999'},{...orderTerms,deadline:'1000'},{...orderTerms,deadline:'4601'}])assert.throws(()=>buildLendingPermissionReview(identity,{kind:'Order',terms},{now:1000000,config}));
 assert.throws(()=>buildLendingPermissionReview(identity,{kind:'Order',terms:{...orderTerms,action:1,maxBorrowRateRay:'1'}},{now:1000000,config}));
 assert.throws(()=>buildLendingPermissionReview(identity,{kind:'Transfer',terms:{asset:2,nonce:'0',deadline:'2000',amount:'1',recipient:identity.account}},{now:1000000,config}));
 await assert.rejects(()=>f.account.capture().signTransfer(review),/another.*action/);
 assert.equal((await snapshotLendingAccountRecovery(f.state)).permissions.length,0);
 f.account.dispose();f.backup.stop();
});

test('recovery rejects altered owner keys, route/account metadata, signature bodies and encrypted address substitution',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});await f.account.capture().signOrder(review);
 const original=await snapshotLendingAccountRecovery(f.state);
 for(const mutate of [s=>{s.privateKey=Wallet.createRandom().privateKey.toLowerCase();},s=>{s.chainId='eip155:1';},s=>{s.owner='aa'.repeat(32);},s=>{s.route.pool='0x3333333333333333333333333333333333333333';},s=>{s.account='0x3333333333333333333333333333333333333333';},s=>{s.permissions[0].signed.signature='0x'+'00'.repeat(65);},s=>{s.permissions[0].signed.signature=Wallet.createRandom().signingKey.sign(s.permissions[0].signed.digest).serialized.toLowerCase();},s=>{s.permissions[0].signed.digest='0x'+'77'.repeat(32);},s=>{s.permissions[0].review.terms.amount='1';},s=>{s.permissions[0].status='approval-unresolved';}]){
  const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateLendingAccountRecovery(changed,f.state.identity));
 }
 const box=structuredClone(f.state.lendingOwnedAccount);f.state.lendingOwnedAccount.account='0x3333333333333333333333333333333333333333';await assert.rejects(()=>snapshotLendingAccountRecovery(f.state));f.state.lendingOwnedAccount=box;
 assert.deepEqual(await snapshotLendingAccountRecovery(f.state),original);f.account.dispose();f.backup.stop();
});

test('archive merging preserves later nonce observations and dispatch fences while rejecting competing same-nonce permissions',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config}),signed=await f.account.capture().signOrder(review),older=await snapshotLendingAccountRecovery(f.state);
 await f.account.beginOrderDispatch(review.id);f.setObservation({nonce:'1',blockNumber:'101',blockHash:'0x'+'33'.repeat(32)});await f.account.refreshAccount();
 await restoreLendingAccountRecovery(f.state,older);const merged=await snapshotLendingAccountRecovery(f.state);
 assert.equal(merged.observation.nonce,'1');assert.equal(merged.permissions[0].status,'submission-unresolved');assert.deepEqual(merged.permissions[0].signed,signed);
 const changed=buildLendingPermissionReview(identity,{kind:'Order',terms:{...orderTerms,amount:'4000000',minResult:'4000000'}},{now:1000000,config});
 const competing=structuredClone(older),oracle=new Wallet(older.privateKey),domain={name:'LenzLendingAccount',version:'1',chainId:11155111,verifyingContract:accountAddress};
 const types={Order:[{name:'action',type:'uint8'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'amount',type:'uint256'},{name:'recipient',type:'address'},{name:'minResult',type:'uint256'},{name:'maxDebt',type:'uint256'},{name:'minHealthFactor',type:'uint256'},{name:'maxBorrowRateRay',type:'uint256'}]};
 competing.permissions=[{id:changed.id,review:changed,status:'signed',signed:{type:'lenz/lending-signed-permission/v1',reviewId:changed.id,digest:TypedDataEncoder.hash(domain,types,changed.terms),signature:(await oracle.signTypedData(domain,types,changed.terms)).toLowerCase(),createdAt:1000000}}];
 const before=structuredClone(f.state);await assert.rejects(()=>restoreLendingAccountRecovery(f.state,competing),/same nonce/);assert.deepEqual(f.state,before);
 const badSignature=structuredClone(older);badSignature.permissions[0].signed.createdAt++;await assert.rejects(()=>restoreLendingAccountRecovery(f.state,badSignature),/signature conflicts/);assert.deepEqual(f.state,before);
 f.account.dispose();f.backup.stop();
});

test('a predicted account, missing factory and chat-only recovery cannot authorize private Supply or silently replace the owner',async()=>{
 const f=await fixture({deployed:false});await f.account.connect();await assert.rejects(()=>f.account.capture().requireRecovery({latest:true,forSupply:true}),/Deploy and verify/);assert.equal(f.latest(),null);
 const predicted=await snapshotLendingAccountRecovery(f.state);f.setObservation({deployed:true,accountCodeHash:hash,blockNumber:'101',blockHash:'0x'+'33'.repeat(32)});await f.account.refreshAccount();await f.account.capture().requireRecovery({latest:true,forSupply:true});
 await restoreLendingAccountRecovery(f.state,predicted);assert.equal((await snapshotLendingAccountRecovery(f.state)).observation.deployed,true);
 const empty=await fixture(),unavailable=createLendingOwnedAccount(empty.state.identity.profile.id,{read:empty.read,update:empty.update});await assert.rejects(()=>unavailable.connect(),/deployment is unavailable/);assert(!empty.state.lendingOwnedAccount);
 empty.state.identity.access=RECOVERED_CHAT;await assert.rejects(()=>empty.account.connect(),/Recover the original lending owner/);assert(!empty.state.lendingOwnedAccount);
 f.account.dispose();f.backup.stop();empty.account.dispose();empty.backup.stop();unavailable.dispose();
});

test('missing or unacknowledged archive coverage leaves the original unsigned permission fenced',async()=>{
 for(const kind of ['missing','wrong-ack']){
  const f=await fixture(),identity=await f.account.connect();let writes=0;
  const backup=createBackupRunner({read:f.read,update:f.update,capture:state=>{if(kind==='missing')delete state.lendingOwnedAccount;return createAccountBackup(state);},request:async()=>{writes++;return {revision:1,digest:'00'.repeat(32),savedAt:Date.now()};}});
  const source=createLendingOwnedAccount(identity.lenzIdentity,{read:f.read,update:f.update,backupState:backup,config,observeAccount:f.observeAccount,now:()=>1000000});await source.connect();
  const review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});await assert.rejects(()=>source.capture().signOrder(review),kind==='missing'?/did not preserve the original lending/:/acknowledgement does not match/);
  const snapshot=await snapshotLendingAccountRecovery(f.state);assert.equal(snapshot.permissions[0].status,'approval-unresolved');assert.equal(snapshot.permissions[0].signed,null);assert.equal(writes,kind==='missing'?0:1);assert.equal(f.state.accountSync.savedVersion,0);
  source.dispose();f.account.dispose();backup.stop();f.backup.stop();
 }
});

test('changed accounts, stale finalized evidence and cancellation-reference substitution preserve pending authority',async()=>{
 const f=await fixture(),identity=await f.account.connect(),review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});await f.account.capture().signOrder(review);const before=await snapshotLendingAccountRecovery(f.state);
 for(const observation of [{ownerAddress:'0x3333333333333333333333333333333333333333'},{account:'0x3333333333333333333333333333333333333333'},{nonce:'1'},{blockNumber:'99'},{accountCodeHash:'0x'+'88'.repeat(32)},{route:{...route,poolCodeHash:'0x'+'88'.repeat(32)}}]){
  const broken=createLendingOwnedAccount(identity.lenzIdentity,{read:f.read,update:f.update,config,observeAccount:async input=>({...await f.observeAccount(input),...observation}),now:()=>1000000});await broken.connect();await assert.rejects(()=>broken.refreshAccount());assert.deepEqual(await snapshotLendingAccountRecovery(f.state),before);broken.dispose();
 }
 const changed=buildLendingPermissionReview(identity,{kind:'Order',terms:{...orderTerms,amount:'4000000',minResult:'4000000'}},{now:1000000,config});await assert.rejects(()=>f.account.capture().signOrder(changed),/same nonce/);
 const cancel=buildLendingPermissionReview(identity,{kind:'Cancel',terms:{nonce:'0',deadline:'2000'},cancels:'aa'.repeat(32)},{now:1000000,config});await assert.rejects(()=>f.account.capture().signCancel(cancel),/cancellation authority/);
 assert.deepEqual(await snapshotLendingAccountRecovery(f.state),before);const lease=f.account.capture();f.account.disconnect();assert.throws(()=>lease.assertCurrent());await assert.rejects(()=>lease.signOrder(review));f.account.dispose();f.backup.stop();
});

test('legacy chat migration retains the blockchain owner and rejects migration of any pending lending permission',async()=>{
 const f=await fixture();f.state.identity=await createIdentity('Legacy lending owner');
 const account=createLendingOwnedAccount(f.state.identity.profile.id,{read:f.read,update:f.update,config,observeAccount:f.observeAccount,now:()=>1000000,backupState:f.backup}),identity=await account.connect();
 const archive=await createAccountBackup(f.state),opened=await openAccountBackup(f.material,{archive,revision:archive.revision,digest:await digest(archive),savedAt:Date.now()});
 assert.notEqual(opened.intentRecovery.lendingAccount.owner,identity.lenzIdentity);assert.equal(opened.intentRecovery.lendingAccount.ownerAddress,identity.ownerAddress);assert.equal(opened.intentRecovery.lendingAccount.account,identity.account);
 const review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});await assert.rejects(()=>account.capture().signOrder(review),/original recoverable Lenz ID/);
 const pending=await snapshotLendingAccountRecovery(f.state);assert.equal(pending.permissions[0].status,'approval-unresolved');assert.equal(pending.permissions[0].signed,null);
 account.dispose();f.account.dispose();f.backup.stop();
});

test('an unverified saved coverage record cannot unlock signing and interruption preserves the original unsigned review',async()=>{
 for(const kind of ['no-coverage','abort','disconnect']){
  const f=await fixture(),identity=await f.account.connect(),controller=new AbortController();let source;
  const backupState=async()=>{if(kind!=='no-coverage')await f.backup();if(kind==='abort')controller.abort(Error('Lending approval aborted.'));if(kind==='disconnect')source.disconnect();};
  source=createLendingOwnedAccount(identity.lenzIdentity,{read:f.read,update:f.update,backupState,config,observeAccount:f.observeAccount,now:()=>1000000});await source.connect();
  const review=buildLendingPermissionReview(identity,{kind:'Order',terms:orderTerms},{now:1000000,config});await assert.rejects(()=>source.capture().signOrder(review,{signal:controller.signal}),/not backed up|aborted|connection changed/);
  const rows=(await snapshotLendingAccountRecovery(f.state)).permissions;assert.equal(rows.length,1);assert.equal(rows[0].status,'approval-unresolved');assert.equal(rows[0].signed,null);assert.equal(rows[0].review.id,review.id);
  source.dispose();f.account.dispose();f.backup.stop();
 }
});

test('disconnect cancels account creation before observation, queued work and delayed encryption commits',async()=>{
 for(const timing of ['decode','queued-update','commit']){
  const f=await fixture();let observations=0,release,reached;const waiting=new Promise(resolve=>{reached=resolve;}),delay=new Promise(resolve=>{release=resolve;});
  const update=async(operation,{signal}={})=>{
   if(timing==='queued-update'){reached();await delay;}
   const staged=structuredClone(f.state),result=await operation(staged);
   if(timing==='commit'){reached();await delay;}
   signal?.throwIfAborted();for(const key of Object.keys(f.state))delete f.state[key];Object.assign(f.state,staged);return result;
  };
  const source=createLendingOwnedAccount(f.state.identity.profile.id,{read:f.read,update,config,observeAccount:async input=>{observations++;return f.observeAccount(input);},now:()=>1000000});
  const pending=source.connect();
  if(timing==='decode')source.disconnect();else{await waiting;source.disconnect();release();}
  await assert.rejects(()=>pending,/connection changed|aborted/);assert(!f.state.lendingOwnedAccount);assert.equal(observations,timing==='commit'?1:0);
  source.dispose();f.account.dispose();f.backup.stop();
 }
});
