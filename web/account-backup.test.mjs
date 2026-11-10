import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
const {AccountStore}=await import(process.env.LENZ_ACCOUNT_STORE||'./account-store.mjs');
const {createAccountRoute}=await import(process.env.LENZ_ACCOUNT_RELAY||'./account-relay.mjs');
const {accountKeys,unlockLocalBackup,ACCOUNT_REQUEST}=await import(process.env.LENZ_ACCOUNT_KEYS||'./public/account-keys.js');
const {createAccountBackup,openAccountBackup}=await import(process.env.LENZ_ACCOUNT_ARCHIVE||'./public/account-backup.js');
const {createBackupRunner}=await import(process.env.LENZ_ACCOUNT_SYNC||'./public/account-sync.js');
import {createIdentity,sealMessage,openMessage,signValue,digest} from './public/peer-crypto.js';
import {prepareDeliveryReceipt,acceptDeliveryReceipt,deliveryAcknowledged} from './public/delivery-receipts.js';
async function fixture(){const secret=crypto.getRandomValues(new Uint8Array(32)),m=await accountKeys(secret.buffer.slice(0),'Amina'),peer=await createIdentity('Bola'),packet=await sealMessage(peer,m.identity.profile,{kind:'chat',text:'Never readable by the backup host.'});const state={identity:m.identity,contacts:[peer.profile],messages:[{packet}],nearBox:{ciphertext:'financial-record'},pendingOrders:['retain'],accountSync:{accountId:m.accountId,authority:m.authority,backupKey:m.backupKey,deviceKey:m.deviceKey,phraseBox:m.phraseBox,revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};return {secret,m,peer,state};}
async function result(archive){return {archive,revision:archive.revision,digest:await digest(archive),savedAt:Date.now()};}
test('passkey material derives stable separate identities and keeps backup keys nonextractable',async()=>{
 const f=await fixture(),m=await accountKeys(f.secret.buffer.slice(0),'Renamed');assert.equal(f.m.identity.profile.id,m.identity.profile.id);assert.equal(f.m.accountId,m.accountId);assert.notEqual(m.accountId,m.identity.profile.id);assert.equal(await unlockLocalBackup(f.state.accountSync),m.phrase);
 for(const k of [m.identity.signingPrivate,m.identity.boxPrivate,m.authority.signingPrivate,m.backupKey,m.deviceKey])assert.equal(k.extractable,false);
 assert(!JSON.stringify(f.state.accountSync).includes(m.phrase));await assert.rejects(accountKeys(new ArrayBuffer(16)),/cannot unlock/);
});
test('encrypted account snapshots restore the same profile and chat while excluding financial state',async()=>{
 const f=await fixture(),archive=await createAccountBackup(f.state);assert(!JSON.stringify(archive).includes('Never readable'));assert(!JSON.stringify(archive).includes(f.m.identity.profile.id));const opened=await openAccountBackup(f.m,await result(archive));assert.equal(opened.recovered.identity.profile.id,f.state.identity.profile.id);assert.equal((await openMessage(opened.recovered.identity,f.peer.profile,opened.recovered.messages[0].packet)).text,'Never readable by the backup host.');assert(!('nearBox'in opened.recovered));assert(!('pendingOrders'in opened.recovered));
 const other=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer);await assert.rejects(openAccountBackup(other,await result(archive)),/another account/);
});

test('automatic same-ID backups preserve the exact prepared receipt',async()=>{
 const f=await fixture(),receipt=await prepareDeliveryReceipt(f.state,f.state.messages[0].packet.id);
 const opened=await openAccountBackup(f.m,await result(await createAccountBackup(f.state)));
 assert.deepEqual(await prepareDeliveryReceipt(opened.recovered,opened.recovered.messages[0].packet.id),receipt);
});
test('account ciphertext binds identity, revision, previous digest and authenticated contents',async()=>{
 const f=await fixture(),original=await createAccountBackup(f.state);
 for(const change of [a=>a.revision++,a=>a.previous='a'.repeat(64),a=>a.ciphertext=(a.ciphertext[0]==='0'?'1':'0')+a.ciphertext.slice(1)]){const a=structuredClone(original);change(a);await assert.rejects(openAccountBackup(f.m,await result(a)));}
 const bad=await result(original);bad.digest='0'.repeat(64);await assert.rejects(openAccountBackup(f.m,bad),/revision/);
});
test('automatic legacy backup preserves source keys and provides a consistent signed successor',async()=>{
 const f=await fixture(),old=await createIdentity('Existing account');f.state.identity=old;f.state.messages=[{packet:await sealMessage(f.peer,old.profile,{kind:'chat',text:'Legacy conversation.'})}];const before=structuredClone(f.state);
 const opened=await openAccountBackup(f.m,await result(await createAccountBackup(f.state)));assert.equal(opened.recovered.sourceProfile.id,old.profile.id);assert.equal(opened.recovered.identity.profile.id,f.m.identity.profile.id);assert.equal(opened.recovered.history[0].payload.text,'Legacy conversation.');assert.deepEqual(f.state,before);
});
test('durable service rejects wrong origin, missing signatures, nonce replay and stale revisions',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-account-')),store=new AccountStore(folder);let route,time=Date.now();const server=createServer((req,res)=>route(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://localhost:'+server.address().port;route=createAccountRoute({origin,store,now:()=>time});
 const post=async(path,value,source=origin)=>{const r=await fetch(origin+'/api/accounts/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:source},body:JSON.stringify(value)});return {status:r.status,value:await r.json()};};
 const f=await fixture(),archive=await createAccountBackup(f.state);
 async function request(op,archive=null,expected=0,previous=''){const challenge=await post('challenge',{accountId:f.m.accountId,operation:op});const nonce=challenge.value.nonce,terms=[ACCOUNT_REQUEST,origin,op,f.m.accountId,nonce,expected,previous,await digest(archive)];return {profile:f.m.authority.profile,nonce,expected,previous,archive,signature:await signValue(f.m.authority,terms)};}
 try{
  assert.equal((await post('challenge',{accountId:f.m.accountId,operation:'write'},'https://untrusted.example')).status,403);
  const unauth=await request('write',archive);unauth.signature='00'.repeat(64);assert.equal((await post('write',unauth)).status,400);assert.equal(store.get(f.m.accountId),null);
  const write=await request('write',archive);const saved=await post('write',write);assert.equal(saved.status,200);assert.equal(saved.value.revision,1);assert.equal((await post('write',write)).status,400);
  const retry=await post('write',await request('write',archive));assert.equal(retry.status,200);assert.equal(retry.value.revision,1);
  const stale=await createAccountBackup(f.state);assert.equal((await post('write',await request('write',stale))).status,409);
  const expired=await request('read');time+=60001;assert.equal((await post('read',expired)).status,400);
  const read=await post('read',await request('read'));assert.equal(read.status,200);assert.deepEqual(read.value.archive,archive);
  store.close();const reopened=new AccountStore(folder);assert.deepEqual(reopened.get(f.m.accountId).archive,archive);reopened.close();
  const raw=await readFile(join(folder,'accounts.sqlite'));assert(!raw.includes(Buffer.from('Never readable')));assert(!raw.includes(Buffer.from(f.m.phrase)));
 }finally{try{store.close();}catch{}await new Promise(r=>server.close(r));await rm(folder,{recursive:true,force:true});}
});
function memory(initial){let state=structuredClone(initial);return {read:async()=>structuredClone(state),update:async(fn)=>{const next=structuredClone(state),r=await fn(next);state=next;return r;}};}
test('automatic backup persists its encrypted candidate and retries a lost acknowledgement exactly',async()=>{
 const f=await fixture(),s=memory(f.state);let written,calls=0;
 const run=createBackupRunner({...s,request:async(sync,operation,pending)=>{calls++;if(!written){written=structuredClone(pending);throw Error('Lost response');}assert.deepEqual(pending,written);return result(pending.archive);}});
 await assert.rejects(run(),/Lost response/);assert.equal((await s.read()).accountSync.savedVersion,0);assert((await s.read()).accountSync.pending);await run();const sync=(await s.read()).accountSync;assert.equal(sync.savedVersion,1);assert.equal(sync.revision,1);assert.equal(sync.pending,null);assert.equal(calls,2);
});
test('edits made during upload stay pending and mismatched acknowledgements cannot claim backup',async()=>{
 const f=await fixture(),s=memory(f.state);let release,entered;const ready=new Promise(r=>entered=r);
 const run=createBackupRunner({...s,request:async(sync,op,p)=>{entered();await new Promise(r=>release=r);return result(p.archive);}});const pending=run();await ready;await s.update(state=>{state.accountSync.version++;});release();await pending;assert.equal((await s.read()).accountSync.status,'pending');assert.equal((await s.read()).accountSync.savedVersion,1);assert.equal((await s.read()).accountSync.version,2);
 const invalid=createBackupRunner({...s,request:async()=>({revision:2,digest:'a'.repeat(64),savedAt:Date.now()})});await assert.rejects(invalid(),/acknowledgement/);assert.equal((await s.read()).accountSync.savedVersion,1);
});
test('failed local candidate writes send nothing; server conflicts preserve unsynced data',async()=>{
 const f=await fixture(),s=memory(f.state);let requests=0;const failed=createBackupRunner({read:s.read,update:async()=>{throw Error('Storage full');},request:async()=>requests++});await assert.rejects(failed(),/Storage full/);assert.equal(requests,0);
 const conflict=createBackupRunner({...s,request:async()=>{throw Object.assign(Error('Newer backup'),{code:'CONFLICT'});}});await assert.rejects(conflict(),/Newer backup/);const state=await s.read();assert.equal(state.accountSync.status,'conflict');assert.equal(state.accountSync.savedVersion,0);assert.deepEqual(state.messages,f.state.messages);assert.deepEqual(state.pendingOrders,f.state.pendingOrders);
});
test('concurrent account backups merge verified chat messages without replacing local financial records',async()=>{
 const f=await fixture(),local=memory(f.state),remote=structuredClone(f.state);remote.messages.push({packet:await sealMessage(f.peer,remote.identity.profile,{kind:'chat',text:'From another device.'})});const newer=await result(await createAccountBackup(remote));
 await local.update(async state=>{state.messages.push({packet:await sealMessage(state.identity,f.peer.profile,{kind:'chat',text:'Only on this device.'})});state.accountSync.version++;});let writes=0;
 const run=createBackupRunner({...local,request:async(sync,op,pending)=>{if(op==='read')return newer;if(!writes++)throw Object.assign(Error('Newer backup'),{code:'CONFLICT'});assert.equal(pending.expected,1);return result(pending.archive);}});
 await run();let state=await local.read();assert.equal(state.messages.length,3);assert.equal(state.accountSync.status,'pending');assert.deepEqual(state.nearBox,f.state.nearBox);assert.deepEqual(state.pendingOrders,f.state.pendingOrders);await run();state=await local.read();assert.equal(state.accountSync.status,'saved');assert.equal(state.accountSync.revision,2);
});

test('an idle device merges a receipt for an existing message and preserves local receipts',async()=>{
 const f=await fixture(),local=memory(f.state),remote=structuredClone(f.state);
 const outgoing=await sealMessage(f.state.identity,f.peer.profile,{kind:'chat',text:'Receipt arrives on another device.'});
 await local.update(state=>state.messages.push({packet:outgoing}));remote.messages.push({packet:outgoing});
 const localReceipt=await local.update(state=>prepareDeliveryReceipt(state,state.messages[0].packet.id));
 const peer={identity:f.peer,contacts:[f.state.identity.profile],messages:[{packet:outgoing}]};
 await acceptDeliveryReceipt(remote,await prepareDeliveryReceipt(peer,outgoing.id));
 const newer=await result(await createAccountBackup(remote));
 await local.update(state=>{state.accountSync.savedVersion=state.accountSync.version;state.accountSync.status='saved';});
 const run=createBackupRunner({...local,request:async()=>newer});await run();const after=await local.read();
 assert.equal(await deliveryAcknowledged(after,after.messages[1]),true);
 assert.equal(after.messages[0].receiptToShare.id,localReceipt.id);
 assert.equal(after.accountSync.status,'pending');
 assert.deepEqual(after.nearBox,f.state.nearBox);
});

test('independently prepared receipts converge across two restored devices',async()=>{
 const f=await fixture(),one=memory(f.state),two=memory(f.state);
 const first=await one.update(state=>prepareDeliveryReceipt(state,state.messages[0].packet.id));
 const second=await two.update(state=>prepareDeliveryReceipt(state,state.messages[0].packet.id));
 assert.notEqual(first.id,second.id);
 let saved,writes=0;const request=async(sync,operation,pending)=>{
  if(operation==='read')return saved;
  if(pending.expected!==(saved?.revision??0))throw Object.assign(Error('Newer backup'),{code:'CONFLICT'});
  writes++;saved=await result(pending.archive);return saved;
 };
 const a=createBackupRunner({...one,request}),b=createBackupRunner({...two,request});
 for(let round=0;round<3;round++){await a();await b();}
 const settled=writes;await a();await b();assert.equal(writes,settled,'Repeated synchronization must not keep uploading competing receipts.');
 const left=await one.read(),right=await two.read();assert.equal(left.messages[0].receiptToShare.id,right.messages[0].receiptToShare.id);
 assert.equal(left.accountSync.status,'saved');assert.equal(right.accountSync.status,'saved');
});

test('equivalent received receipts converge despite different JSON field order',async()=>{
 const f=await fixture(),packet=await sealMessage(f.state.identity,f.peer.profile,{kind:'chat',text:'Same acknowledgement, different encoding.'});f.state.messages=[{packet}];
 const peer={identity:f.peer,contacts:[f.state.identity.profile],messages:[{packet}]},receipt=await prepareDeliveryReceipt(peer,packet.id),one=memory(f.state),two=memory(f.state);
 await one.update(state=>acceptDeliveryReceipt(state,receipt));await two.update(state=>acceptDeliveryReceipt(state,Object.fromEntries(Object.entries(receipt).reverse())));
 let saved,writes=0;const request=async(sync,operation,pending)=>{
  if(operation==='read')return saved;
  if(pending.expected!==(saved?.revision??0))throw Object.assign(Error('Newer backup'),{code:'CONFLICT'});
  writes++;saved=await result(pending.archive);return saved;
 };
 const a=createBackupRunner({...one,request}),b=createBackupRunner({...two,request});
 for(let round=0;round<5;round++){await a();await b();}
 assert.equal(writes,1,'Equivalent acknowledgements must not create further backup revisions.');
 for(const device of [one,two]){const state=await device.read();assert.equal(state.accountSync.status,'saved');assert.equal(await deliveryAcknowledged(state,state.messages[0]),true);}
});
test('invalid or mixed-history conflicts retain the pending archive and original financial records',async()=>{
 for(const mode of ['tampered','legacy','rollback']){
  const f=await fixture(),s=memory(f.state),remote=structuredClone(f.state);
  if(mode==='legacy'){remote.identity=await createIdentity('Old device');remote.messages=[];}
  const newer=await result(await createAccountBackup(remote));if(mode==='tampered')newer.archive.ciphertext='00'+newer.archive.ciphertext.slice(2);
  if(mode==='rollback')await s.update(state=>{state.accountSync.revision=2;state.accountSync.digest=newer.digest;});
  const run=createBackupRunner({...s,request:async(sync,op)=>{if(op==='read')return newer;throw Object.assign(Error('Newer backup'),{code:'CONFLICT'});}});
  await assert.rejects(run());const after=await s.read();assert.equal(after.accountSync.status,'conflict');assert(after.accountSync.pending);assert.equal(after.accountSync.savedVersion,0);assert.deepEqual(after.messages,f.state.messages);assert.deepEqual(after.nearBox,f.state.nearBox);
 }
});
test('idle signed-in devices retrieve newer chats and profile edits without backup ping-pong',async()=>{
 const f=await fixture(),local=memory(f.state),remote=memory(f.state);let stored,writes=0;
 const request=async(sync,op,p)=>{if(op==='read')return stored;writes++;assert.equal(p.expected,stored?.revision??0);stored=await result(p.archive);return stored;};
 const a=createBackupRunner({...local,request}),b=createBackupRunner({...remote,request});await a();
 await remote.update(state=>{state.accountSync.revision=stored.revision;state.accountSync.digest=stored.digest;state.accountSync.savedVersion=state.accountSync.version;state.accountSync.status='saved';});
 await local.update(async state=>{state.identity.profile.name='Amina at home';state.messages.push({packet:await sealMessage(f.peer,state.identity.profile,{kind:'chat',text:'Across devices.'})});state.accountSync.version++;});await a();await b();const after=await remote.read();assert.equal(after.identity.profile.name,'Amina at home');assert.equal(after.messages.length,2);assert.equal(after.accountSync.status,'saved');assert.deepEqual(after.nearBox,f.state.nearBox);
 await b();await a();assert.equal(writes,2);
});
test('storage quotas preserve the acknowledged backup and allow exact retries',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-account-quota-')),f=await fixture(),archive=await createAccountBackup(f.state),size=Buffer.byteLength(JSON.stringify(archive));let store;
 try{store=new AccountStore(folder,{maxAccounts:1,maxBytes:size});const saved=store.put(f.m.accountId,0,'',archive);
  assert.throws(()=>store.put('f'.repeat(64),0,'',archive),/storage is full/);
  const large={...archive,revision:2,previous:saved.digest,ciphertext:archive.ciphertext+'00'};assert.throws(()=>store.put(f.m.accountId,1,saved.digest,large),/storage is full/);
  assert.deepEqual(store.get(f.m.accountId).archive,archive);assert.equal(store.put(f.m.accountId,0,'',archive).digest,saved.digest);
 }finally{store?.close();await rm(folder,{recursive:true,force:true});}
});
