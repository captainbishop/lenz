import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const run=(args,env={})=>spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000});
const base=run(['--test','web/legacy-recovery.test.mjs']);assert.equal(base.status,0,base.stdout+base.stderr);
const browser=run(['web/legacy-recovery-browser.test.cjs']);assert.equal(browser.status,0,browser.stdout+browser.stderr);process.stdout.write(browser.stdout);
const source=await readFile(new URL('web/public/legacy-recovery.js',root),'utf8');
const mutations=[
 ['trusted-old-id',"typeof expectedOldId==='string'&&from.id===expectedOldId&&from.id!==to.id","from.id!==to.id"],
 ['old-link-signature','assert(await verifyValue(from.signingPublic,linkTerms(link),link.oldSignature),','assert(true,'],
 ['new-link-signature','assert(await verifyValue(to.signingPublic,linkTerms(link),link.newSignature),','assert(true,'],
 ['archive-signature','assert(await verifyValue(profile.signingPublic,await digest(archiveTerms(content)),content.signature),','assert(true,'],
 ['message-signature','assert(await verifyValue(incoming?peer.signingPublic:profile.signingPublic,[...packetHeader(p),p.ciphertext],p.signature),','assert(true,'],
 ['phrase-successor-binding','assert(identity.profile.id===content.successor.id,','assert(true,'],
 ['financial-payloads',"assert(keysAre(payload,['kind','text'])&&payload.kind==='chat'&&typeof payload.text==='string'&&payload.text.trim().length>0&&bytes(payload.text).length<=16002,",'assert(true,'],
 ['financial-fields',"assert(keysAre(input,['profile','contacts','messages']),",'assert(true,'],
 ['duplicate-messages','&&!ids.has(record.packet.id)',''],
 ['caller-snapshot','const captured=structuredClone(input),identity=structuredClone(activeIdentity);','const captured=input,identity=structuredClone(activeIdentity);'],
 ['encryption-key-pair','assert(hex(ownShared)===hex(peerShared),','assert(true,'],
 ['per-message-key','const raw=await historicalKey(identity,peer,packet);','const raw=await oldSharedSecret(identity,peer);'],
];
for(const [guard,from,to]of mutations){
 assert.equal(source.split(from).length,2,guard);
 let altered=source.replace(from,to);for(const name of ['evm-vendor/identity-recovery.js','identity-recovery.js','peer-crypto.js'])altered=altered.replaceAll("'./"+name+"'",JSON.stringify(new URL('web/public/'+name,root).href));
 const result=run(['--test','web/legacy-recovery.test.mjs'],{LENZ_LEGACY_MODULE:'data:text/javascript;base64,'+Buffer.from(altered).toString('base64')});
 assert.equal(result.status,1,guard+' escaped the tests');assert.match(result.stdout+result.stderr,/ERR_ASSERTION/,guard+' did not reach an assertion');console.log('DETECTED '+guard);
}
const sources={};for(const file of ['web/public/legacy-recovery.js','web/public/identity-recovery.js','web/public/evm-vendor/identity-recovery.js','web/public/peer-crypto.js','web/legacy-recovery.test.mjs','web/legacy-recovery-browser.test.cjs','web/verify-legacy-recovery.mjs'])sources[file]=createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');
const tests=Number(base.stdout.match(/tests (\d+)/)?.[1]);assert.equal(tests,9);
await writeFile(new URL('web/legacy-recovery-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests:tests,browserGroups:7,guardAlterations:mutations.map(m=>m[0]),sources,scope:'Existing-account chat archives and read-only recovery UI. Independent OpenSSL archive edits, later-message confidentiality, successor signatures and old-key financial authority checked. No funds restoration, active migration or external cryptographic audit.'},null,2)+'\n');
console.log(JSON.stringify({nodeTests:tests,browserGroups:7,guardAlterations:mutations.length}));
