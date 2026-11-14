import test from 'node:test';
import assert from 'node:assert/strict';
import { createLendingIntentService } from './public/intent-lending-route.js';
import { createLendingOwnedAccount } from './public/intent-lending-account.js';
import { accountKeys } from './public/account-keys.js';
import { createBackupRunner } from './public/account-sync.js';
import { openAccountBackup } from './public/account-backup.js';
import { digest } from './public/peer-crypto.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';

const factory = '0x'+'1'.repeat(40), address = '0x'+'2'.repeat(40), hash = '0x'+'1'.repeat(64), blockHash='0x'+'2'.repeat(64);
const config={...LENDING_TESTNET,lendingFactory:factory};
const route={chainId:config.chain,factory,pool:config.pool,link:config.link,usdc:config.usdc,aLink:config.aLink,variableDebt:config.variableDebt,poolCodeHash:hash,linkCodeHash:hash,usdcCodeHash:hash,aLinkCodeHash:hash,variableDebtCodeHash:hash};
async function fixture() {
  let clock=1_800_000_000_000, connected=true, latest=null, onBackup=null, nonce='0', blockNumber='100';
  const material=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer,'Lending route');
  const state={identity:material.identity,contacts:[],messages:[],accountSync:{accountId:material.accountId,authority:material.authority,backupKey:material.backupKey,deviceKey:material.deviceKey,phraseBox:material.phraseBox,revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};
  const read=async()=>structuredClone(state),update=async(operation,{markBackup=true,signal}={})=>{
    const next=structuredClone(state),before=JSON.stringify(next.lendingOwnedAccount),result=await operation(next);signal?.throwIfAborted();
    if(markBackup&&before!==JSON.stringify(next.lendingOwnedAccount)){next.accountSync.version++;next.accountSync.status='pending';}
    for(const key of Object.keys(state))delete state[key];Object.assign(state,next);return result;
  };
  const backup=createBackupRunner({read,update,request:async(sync,operation,pending)=>{
    if(operation==='read')return latest??{revision:sync.revision,digest:sync.digest};
    latest={archive:pending.archive,revision:pending.expected+1,digest:await digest(pending.archive),savedAt:clock};onBackup?.();return latest;
  }});
  const observeAccount=async input=>({chainId:config.chain,ownerAddress:input.ownerAddress,factory,account:address,route,deployed:true,nonce,blockNumber,blockHash,accountCodeHash:hash});
  const account=createLendingOwnedAccount(material.identity.profile.id,{read,update,backupState:backup,config,observeAccount,now:()=>clock});
  await account.connect();
  const requests=[];
  let respond=(operation,body)=>operation==='prepare'?{review:body.review,available:true,execute:true}:{intentId:body.review.id,artifactId:body.signed.digest,status:'pending',verified:false};
  const fetchImpl=async(url,options)=>{const operation=url.split('/').at(-1),body=JSON.parse(options.body);requests.push({operation,body});return Response.json(await respond(operation,body));};
  const make=()=>createLendingIntentService({account,config,fetchImpl,now:()=>clock,online:()=>connected});
  const terms={action:0,nonce:'0',deadline:String(clock/1000+300),amount:'5000000',recipient:address,minResult:'5000000',maxDebt:'6000000',minHealthFactor:'2000000000000000000',maxBorrowRateRay:'1000000000000000000000000000'};
  return {make,account,requests,terms,material,latest:()=>latest,setClock:value=>{clock=value;},onBackup:value=>{onBackup=value;},setObservation:changes=>{nonce=changes.nonce;blockNumber=changes.blockNumber;},setOnline:value=>{connected=value;},respond:value=>{respond=value;}};
}

test('an approved lending permission survives offline loss and submits unchanged after the review display expires',async()=>{
  const f=await fixture(),service=f.make(),review=await service.prepare({kind:'Order',terms:f.terms}),signed=await service.approve(review);
  f.setOnline(false);
  await assert.rejects(service.submit(review.id),/Reconnect/);
  assert.equal(f.requests.filter(row=>row.operation==='submit').length,0);
  const recovered=await openAccountBackup(f.material,f.latest());
  assert.equal(recovered.intentRecovery.lendingAccount.permissions[0].signed.digest,signed.digest);
  f.setClock(1_800_000_120_000);f.setOnline(true);
  const pending=await f.make().submit(review.id);
  assert.equal(pending.status,'pending');
  assert.deepEqual(f.requests.at(-1).body.signed,signed);
  assert.equal((await f.account.pendingOrders())[0].status,'submission-unresolved');
});

test('expired unsigned reviews cannot sign and expired signed permission cannot dispatch',async()=>{
  const f=await fixture(),service=f.make(),review=await service.prepare({kind:'Order',terms:f.terms});
  f.setClock(1_800_000_060_000);await assert.rejects(service.approve(review),/Review the original/);
  assert.equal((await f.account.pendingOrders()).length,0);
  f.setClock(1_800_000_000_000);await service.approve(review);
  f.setClock(1_800_000_300_000);await assert.rejects(service.submit(review.id),/permission expired/);
  await assert.rejects(f.account.beginOrderDispatch(review.id),/permission expired/);
  assert.equal((await f.account.pendingOrders())[0].status,'signed');
  assert.equal(f.requests.filter(row=>row.operation==='submit').length,0);
});

test('server substitution before approval never creates a signature',async()=>{
  const f=await fixture(),service=f.make(),review=await service.prepare({kind:'Order',terms:f.terms});
  f.respond((operation,body)=>({review:{...body.review,terms:{...body.review.terms,recipient:'0x'+'8'.repeat(40)}},available:true,execute:true}));
  await assert.rejects(service.approve(review),/review identity/);
  assert.equal((await f.account.pendingOrders()).length,0);
});

test('a late lending response after account disconnect cannot populate the active view',async()=>{
  const f=await fixture(),service=f.make(),review=await service.prepare({kind:'Order',terms:f.terms});await service.approve(review);
  f.respond(async(operation,body)=>{f.account.disconnect();return {intentId:body.review.id,artifactId:body.signed.digest,status:'pending',verified:false};});
  await assert.rejects(service.submit(review.id),/connection changed/);
  await f.account.connect();
  assert.equal((await f.account.pendingOrders())[0].status,'submission-unresolved');
});

test('a review expiring during recovery retains unsigned authority and can explicitly cancel its original nonce before fresh Repay', async () => {
  const f = await fixture(), service = f.make(), repayTerms = { ...f.terms, action: 1, minHealthFactor: '0', maxBorrowRateRay: '0' }, review = await service.prepare({ kind: 'Order', terms: repayTerms });
  f.onBackup(() => f.setClock(1_800_000_061_000));
  await assert.rejects(service.approve(review), /Review the original/);
  f.onBackup(null);
  const row = (await f.account.pendingOrders())[0]; assert.equal(row.id, review.id); assert.equal(row.status, 'approval-unresolved'); assert.equal(row.signed, null); assert.equal(f.requests.filter(row => row.operation === 'submit').length, 0);
  const cancellation = await service.prepareCancellation(review.id);
  assert.equal(cancellation.kind, 'Cancel'); assert.equal(cancellation.cancels, review.id); assert.equal(cancellation.terms.nonce, '0'); assert.equal(cancellation.createdAt, 1_800_000_061_000);
  const signed = await service.approve(cancellation); assert.equal((await f.account.pendingOrders()).find(row => row.id === review.id).signed, null);
  await service.submit(cancellation.id); assert.equal(f.requests.at(-1).body.review.kind, 'Cancel'); assert.equal(f.requests.at(-1).body.signed.digest, signed.digest);
  const restored = await openAccountBackup(f.material, f.latest()), rows = restored.intentRecovery.lendingAccount.permissions;
  assert.equal(rows.find(row => row.id === review.id).signed, null); assert.equal(rows.find(row => row.id === cancellation.id).review.cancels, review.id);
  f.setObservation({ nonce: '1', blockNumber: '101' }); await f.account.refreshAccount();
  await assert.rejects(service.prepareCancellation(review.id), /nonce.*advanced|nonce.*changed/);
  const next = await service.prepare({ kind: 'Order', terms: { ...repayTerms, nonce: '1', deadline: '1800000361' } }); await service.approve(next);
  assert.equal((await f.account.pendingOrders()).length, 3); assert.equal((await f.account.pendingOrders()).find(row => row.id === review.id).signed, null);
});
