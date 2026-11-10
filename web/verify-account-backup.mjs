import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=new URL('../',import.meta.url),run=(env={})=>spawnSync(process.execPath,['--test','web/account-backup.test.mjs'],{cwd:root,env:{...process.env,...env},windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
const files=['web/public/account-keys.js','web/public/account-backup.js','web/public/account-sync.js','web/public/chat-store.js','web/public/identity-recovery.js','web/public/delivery-receipts.js','web/public/legacy-recovery.js','web/public/peer-crypto.js','web/public/chat-access.js','web/public/chat-restore.js','web/public/recovery-service.js','web/public/evm-vendor/identity-recovery.js','web/account-store.mjs','web/account-relay.mjs','web/account-backup.test.mjs','web/verify-account-backup.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL(f,root))).digest('hex')]))),sources=await hashes();
const base=run();assert.equal(base.status,0,base.stdout+base.stderr);
const alterations=[
 ['separate-account-authority','public/account-keys.js','KEYS',"derive('backup-authorization')","derive('chat-identity')"],
 ['passkey-secret-length','public/account-keys.js','KEYS',"secret instanceof ArrayBuffer&&secret.byteLength===32",'secret instanceof ArrayBuffer'],
 ['encrypted-revision-binding','public/account-backup.js','ARCHIVE','bytes([a.type,a.accountId,a.revision,a.previous])','bytes([a.type,a.accountId])'],
 ['returned-archive-digest','public/account-backup.js','ARCHIVE','&&result.digest===await digest(a)',''],
 ['request-origin','account-relay.mjs','RELAY','||req.headers.origin!==origin',''],
 ['request-signature','account-relay.mjs','RELAY','assert(await verifyValue(profile.signingPublic,terms,value.signature),','assert(true,'],
 ['single-use-nonce','account-relay.mjs','RELAY','nonces.delete(value.nonce);',''],
 ['revision-compare-and-swap','account-store.mjs','STORE',"if((old?.revision??0)!==expected||(old?.digest??'')!==previous)",'if(false)'],
 ['durable-retry-candidate','public/account-sync.js','SYNC','else current.accountSync.pending=pending;','else current.accountSync.pending=null;'],
 ['acknowledgement-binding','public/account-sync.js','SYNC',"assert(result.revision===pending.expected+1&&result.digest===await digest(pending.archive)&&Number.isSafeInteger(result.savedAt),",'assert(true,'],
 ['idle-device-sync','public/account-sync.js','SYNC','if(s.savedVersion===s.version&&!s.pending){await reconcileBackup(s,{request,metadata});return;}','if(s.savedVersion===s.version&&!s.pending)return;'],
 ['pending-newer-edits','public/account-sync.js','SYNC','c.savedVersion=pending.version;','c.savedVersion=c.version;'],
 ['receipt-convergence','public/account-sync.js','SYNC','if(remoteReceipt&&(!localReceipt||receiptOrder(remoteReceipt)<=receiptOrder(localReceipt)))','if(false)'],
 ['receipt-change-detection','public/account-sync.js','SYNC','r=>[r.packet,r.receiptToShare??null,r.receivedReceipt??null]','r=>[r.packet]'],
 ];
for(const [guard,file,key,from,to]of alterations){
 const url=new URL('web/'+file,root),source=(await readFile(url,'utf8')).replaceAll('\r\n','\n');assert.equal(source.split(from).length,2,guard);
 const changed=source.replace(from,to).replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_,q,name)=>JSON.stringify(new URL(name,url).href));
 const result=run({['LENZ_ACCOUNT_'+key]:'data:text/javascript;base64,'+Buffer.from(changed).toString('base64')});assert.equal(result.status,1,guard+' survived');assert.match(result.stdout+result.stderr,/ERR_ASSERTION/,guard+' failed without an assertion');console.log('DETECTED '+guard);
}
assert.deepEqual(await hashes(),sources,'Sources changed during verification');const tests=Number(base.stdout.match(/tests (\d+)/)?.[1]);assert.equal(tests,16);
if(process.env.LENZ_ACCOUNT_REPORT_DIR)await mkdir(process.env.LENZ_ACCOUNT_REPORT_DIR,{recursive:true});
await writeFile(process.env.LENZ_ACCOUNT_REPORT_DIR?join(process.env.LENZ_ACCOUNT_REPORT_DIR,'account-backup-verification.json'):new URL('web/account-backup-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests:tests,guardAlterations:alterations.map(a=>a[0]),sources,scope:'Passkey-derived encryption and authorization, local HTTP/SQLite persistence, replay/revision checks, lost acknowledgements and convergent chat/receipt merge. Application key custody and recovery policy; no external audit, physical-device passkey sync or funds recovery.'},null,2)+'\n');console.log(JSON.stringify({nodeTests:tests,guardAlterations:alterations.length}));
