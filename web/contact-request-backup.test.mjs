import test from 'node:test';
import assert from 'node:assert/strict';
import {accountKeys} from './public/account-keys.js';
const {createAccountBackup,openAccountBackup,accountChatSnapshot}=await import(process.env.LENZ_CONTACT_ACCOUNT_BACKUP_MODULE??'./public/account-backup.js');
import {createIdentity,sealMessage,openMessage,digest} from './public/peer-crypto.js';
import {receivePacket} from './public/receive-packet.js';
import {CONTACT_REQUEST,CONTACT_RESPONSE} from './public/contact-requests.js';
import {createChatRestorer,readRecoveredHistory} from './public/chat-restore.js';
import {createBackupRunner} from './public/account-sync.js';

async function fixture({legacy=false}={}){
 const material=await accountKeys(crypto.getRandomValues(new Uint8Array(32)).buffer,'Recipient'),sender=await createIdentity('New sender');
 const state={identity:legacy?await createIdentity('Device-only recipient'):material.identity,contacts:[],messages:[],accountSync:{accountId:material.accountId,authority:material.authority,backupKey:material.backupKey,deviceKey:material.deviceKey,phraseBox:material.phraseBox,revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};
 const packet=await sealMessage(sender,state.identity.profile,{kind:CONTACT_REQUEST,profile:sender.profile});
 await receivePacket(state,packet,false,null,{id:sender.profile.id,signingPublic:sender.profile.signingPublic,boxPublic:sender.profile.boxPublic});
 return {material,sender,state,packet};
}
const result=async archive=>({archive,revision:archive.revision,digest:await digest(archive),savedAt:Date.now()});

test('encrypted account backup restores a pending sender without accepting them',async()=>{
 const f=await fixture(),chat=await sealMessage(f.sender,f.state.identity.profile,{kind:'chat',text:'Waiting in message requests.'});await receivePacket(f.state,chat);
 const archive=await createAccountBackup(f.state),restored=(await openAccountBackup(f.material,await result(archive))).recovered;
 assert.equal(restored.contacts.length,0);assert.equal(restored.contactRequests[0].status,'pending');assert.equal(restored.contactRequests[0].peerId,f.sender.profile.id);
 assert.deepEqual(restored.messages.map(row=>row.packet),f.state.messages.map(row=>row.packet));
 assert.equal((await openMessage(restored.identity,restored.contactRequests[0].profile,restored.messages.find(row=>row.packet.id===chat.id).packet)).text,'Waiting in message requests.');
 assert(!JSON.stringify(archive).includes(f.sender.profile.name));assert(!JSON.stringify(archive).includes('Waiting in message requests.'));
});

test('backups retain a declined sender and its exact signed response',async()=>{
 const f=await fixture(),request=f.state.contactRequests[0],response=await sealMessage(f.state.identity,f.sender.profile,{kind:CONTACT_RESPONSE,requestId:request.requestId,decision:'declined'});
 request.status='declined';request.responseId=response.id;f.state.messages.push({packet:response,deliveryRequested:true});
 const restored=(await openAccountBackup(f.material,await result(await createAccountBackup(f.state)))).recovered;
 assert.equal(restored.contacts.length,0);assert.deepEqual(restored.contactRequests,f.state.contactRequests);assert.deepEqual(restored.messages.find(row=>row.packet.id===response.id),{packet:response,deliveryRequested:true});
 const repeat=await sealMessage(f.sender,restored.identity.profile,{kind:CONTACT_REQUEST,profile:f.sender.profile});
 assert.equal((await receivePacket(restored,repeat,false,null,{id:f.sender.profile.id,signingPublic:f.sender.profile.signingPublic,boxPublic:f.sender.profile.boxPublic})).ignored,true);
 assert.equal(restored.contacts.length,0);
});

test('a request cannot be restored as accepted without the original recipient decision',async()=>{
 const f=await fixture();f.state.contactRequests[0].status='accepted';f.state.contacts.push(f.sender.profile);
 await assert.rejects(createAccountBackup(f.state),/response|decision/);
});

test('account snapshots preserve explicit queued chat delivery and exclude unrelated financial records',async()=>{
 const f=await fixture();f.state.contacts.push(f.sender.profile);f.state.contactRequests=[];f.state.messages=[];
 const packet=await sealMessage(f.state.identity,f.sender.profile,{kind:'chat',text:'Original queued message.'});f.state.messages.push({packet,deliveryRequested:true});f.state.nearBox={ciphertext:'keep financial state local'};
 const restored=(await openAccountBackup(f.material,await result(await createAccountBackup(f.state)))).recovered;
 assert.deepEqual(restored.messages,[{packet,deliveryRequested:true}]);assert(!Object.hasOwn(restored,'nearBox'));
 const snapshot=await accountChatSnapshot(f.state);assert(!Object.hasOwn(snapshot,'nearBox'));
});

test('a successor restore retains declined identities without inheriting old pending request authority',async()=>{
 const f=await fixture({legacy:true}),request=f.state.contactRequests[0],response=await sealMessage(f.state.identity,f.sender.profile,{kind:CONTACT_RESPONSE,requestId:request.requestId,decision:'declined'});
 request.status='declined';request.responseId=response.id;f.state.messages.push({packet:response,deliveryRequested:true});
 const opened=await openAccountBackup(f.material,await result(await createAccountBackup(f.state)));assert.equal(opened.recovered.sourceProfile.id,f.state.identity.profile.id);assert.deepEqual(opened.recovered.declinedContactIds,[f.sender.profile.id]);
 let restored={identity:null,contacts:[],messages:[]};const stage=await createChatRestorer({read:async()=>structuredClone(restored),update:async operation=>{const next=structuredClone(restored),value=await operation(next);restored=next;return value;}})(f.material.phrase,new File([JSON.stringify(opened.chat)],'backup.json'));
 await stage.install();assert.notEqual(restored.identity.profile.id,f.state.identity.profile.id);assert.equal(restored.contacts.length,0);assert.equal(restored.contactRequests,undefined);assert.deepEqual(restored.declinedContactIds,[f.sender.profile.id]);
 const history=await readRecoveredHistory(restored);assert.equal(history.contactRequests[0].status,'declined');assert.equal(history.sourceProfile.id,f.state.identity.profile.id);
 const repeat=await sealMessage(f.sender,restored.identity.profile,{kind:CONTACT_REQUEST,profile:f.sender.profile});
 assert.equal((await receivePacket(restored,repeat,false,null,{id:f.sender.profile.id,signingPublic:f.sender.profile.signingPublic,boxPublic:f.sender.profile.boxPublic})).ignored,true);assert.equal(restored.contacts.length,0);
 restored.accountSync=f.state.accountSync;const later=await openAccountBackup(f.material,await result(await createAccountBackup(restored)));assert.deepEqual(later.recovered.declinedContactIds,[f.sender.profile.id]);
});

test('a signed decision cannot be backed up with the opposite status or an altered sender profile',async()=>{
 const f=await fixture(),request=f.state.contactRequests[0],response=await sealMessage(f.state.identity,f.sender.profile,{kind:CONTACT_RESPONSE,requestId:request.requestId,decision:'accepted'});
 request.status='declined';request.responseId=response.id;f.state.messages.push({packet:response,deliveryRequested:true});
 await assert.rejects(accountChatSnapshot(f.state),/signed response/);
 request.status='accepted';f.state.contacts.push(f.sender.profile);request.profile={...request.profile,name:'Impersonated name'};
 await assert.rejects(accountChatSnapshot(f.state),/profile was changed/);
});

test('a second signed-in device receives a decline and cannot resurrect its pending request',async()=>{
 const f=await fixture(),remote=structuredClone(f.state),request=remote.contactRequests[0],response=await sealMessage(remote.identity,f.sender.profile,{kind:CONTACT_RESPONSE,requestId:request.requestId,decision:'declined'});
 request.status='declined';request.responseId=response.id;remote.messages.push({packet:response,deliveryRequested:true});const newer=await result(await createAccountBackup(remote));
 let local=structuredClone(f.state);local.accountSync.version++;const runner=createBackupRunner({read:async()=>structuredClone(local),update:async operation=>{const next=structuredClone(local),value=await operation(next);local=next;return value;},request:async(sync,operation,pending)=>operation==='read'?newer:Promise.reject(Object.assign(Error('Newer backup'),{code:'CONFLICT'}))});
 await runner();assert.equal(local.contactRequests[0].status,'declined');assert.equal(local.contactRequests[0].responseId,response.id);assert.equal(local.contacts.length,0);
 const repeat=await sealMessage(f.sender,local.identity.profile,{kind:CONTACT_REQUEST,profile:f.sender.profile});
 assert.equal((await receivePacket(local,repeat,false,null,{id:f.sender.profile.id,signingPublic:f.sender.profile.signingPublic,boxPublic:f.sender.profile.boxPublic})).ignored,true);
});
