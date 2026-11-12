import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const run=(args,env={})=>spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
const files=['web/public/chat-access.js','web/public/chat-restore.js','web/public/contact-recovery.js','web/public/near-protocol.js','web/public/near-payment-service.js','web/public/recovery-service.js','web/public/peer-crypto.js','web/public/chat-store.js','web/public/legacy-recovery.js','web/public/identity-recovery.js','web/chat-restore.test.mjs','web/verify-chat-restore.mjs'];
const hashFiles=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,root))).digest('hex')])));
const sources=await hashFiles(),base=run(['--test','web/chat-restore.test.mjs']);assert.equal(base.status,0,base.stdout+base.stderr);
const mutations=[
 ['restore-state-check','chat-restore.js','LENZ_CHAT_RESTORE_MODULE',"assert(empty(state),",'assert(true,'],
 ['restore-cancellation','chat-restore.js','LENZ_CHAT_RESTORE_MODULE',"cancel(){active=false;controller.abort(Error('Restore was cancelled.'));}", 'cancel(){}'],
 ['queued-cancellation','chat-restore.js','LENZ_CHAT_RESTORE_MODULE',"assert(active,'Restore was cancelled.');",''],
 ['restored-access-mode','chat-restore.js','LENZ_CHAT_RESTORE_MODULE','identity.access=RECOVERED_CHAT;',''],
 ['unknown-signing-domain','chat-access.js','LENZ_CHAT_ACCESS_MODULE',"if(!isRecoveredChat(identity)||(!archiveDigest&&(!Array.isArray(value)||!domains.includes(value[0]))))requirePaymentAccess(identity);",''],
 ['payment-access','chat-access.js','LENZ_CHAT_ACCESS_MODULE',"if(identity?.access!==undefined)throw Error(","if(false)throw Error("],
 ['trusted-contact','contact-recovery.js','LENZ_CONTACT_RECOVERY_MODULE',"const root=state.contacts.find(p=>p.id===input.from?.id);",'const root=input.from;'],
 ['competing-successor','contact-recovery.js','LENZ_CONTACT_RECOVERY_MODULE',"assert(!previous||previous.to.id===link.to.id,",'assert(true,'],
 ['own-contact','contact-recovery.js','LENZ_CONTACT_RECOVERY_MODULE',"assert(link.to.id!==state.identity.profile.id,",'assert(true,'],
 ['incoming-payment','near-protocol.js','LENZ_RESTORE_NEAR_MODULE',"  requirePaymentAccess(identity);",''],
 ['vault-write','near-protocol.js','LENZ_RESTORE_NEAR_MODULE',"export async function saveNearVault(state, vault) {\n  requirePaymentAccess(state.identity);",'export async function saveNearVault(state, vault) {'],
 ['vault-read','near-protocol.js','LENZ_RESTORE_NEAR_MODULE',"  if (!state.nearBox) return emptyNearVault(contract);\n  requirePaymentAccess(state.identity);",'  if (!state.nearBox) return emptyNearVault(contract);'],
 ['contact-payment','near-payment-service.js','LENZ_RESTORE_PAYMENT_MODULE',"assert(!isRecoveredContact(state,contactId),",'assert(true,'],
];
const detected=[];
for(const [guard,file,env,from,to]of mutations){
 const url=new URL('web/public/'+file,root),source=(await readFile(url,'utf8')).replaceAll('\r\n','\n');assert.equal(source.split(from).length,2,guard);
 const altered=source.replace(from,to).replace(/(['"])(\.\/[^'"]+)\1/g,(_,quote,name)=>JSON.stringify(new URL(name,url).href));
 const result=run(['--test','web/chat-restore.test.mjs'],{[env]:'data:text/javascript;base64,'+Buffer.from(altered).toString('base64')});
 assert.equal(result.status,1,guard+' escaped the tests');assert.match(result.stdout+result.stderr,/ERR_ASSERTION/,guard+' failed without an assertion');detected.push(guard);console.log('DETECTED '+guard);
}
assert.deepEqual(await hashFiles(),sources,'Sources changed during verification');
const tests=Number(base.stdout.match(/tests (\d+)/)?.[1]);assert.equal(tests,10);
await writeFile(new URL('web/chat-restore-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests:tests,guardAlterations:detected,sources,scope:'Chat-only installation, encrypted history, trusted contact updates and application payment guards. Guard removals are local tests, with overlapping signing/service/vault enforcement. No cryptographic revocation, financial reconciliation, live settlement or external audit.'},null,2)+'\n');
console.log(JSON.stringify({nodeTests:tests,guardAlterations:detected.length}));
