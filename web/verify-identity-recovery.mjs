import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
const run=(args,env={})=>spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000});
const base=run(['--test','web/identity-recovery.test.mjs']);assert.equal(base.status,0,base.stdout+base.stderr);
const browser=run(['web/identity-recovery-browser.test.cjs']);assert.equal(browser.status,0,browser.stdout+browser.stderr);
const source=await readFile(new URL('web/public/identity-recovery.js',root),'utf8');
const mutations=[
 ['derivation-domain',"const DOMAIN='lenz/identity-recovery/v1'","const DOMAIN='lenz/identity-recovery/v2'"],
 ['separate-keys',"keyPair(root,'encryption'","keyPair(root,'signing'"],
 ['identity-binding','assert(profile.id===identity.profile.id,','assert(true,'],
 ['financial-fields',"assert(keysAre(input,['profile','contacts','messages']),","assert(true,"],
 ['financial-messages',"assert(keysAre(payload,['kind','text'])&&payload.kind==='chat'&&typeof payload.text==='string'&&payload.text.trim().length>0&&bytes(payload.text).length<=16002,","assert(true,"],
 ['duplicate-messages',"&&!ids.has(record.packet.id)",""],
 ['caller-snapshot','const snapshot=structuredClone(input),entropy=entropyOf(phrase);','const snapshot=input,entropy=entropyOf(phrase);'],
 ['archived-receipt-verification','if(Object.hasOwn(record,receiptField))await validateDeliveryReceipt({identity,contacts:snapshot.contacts},record,record[receiptField]);',''],
 ['strict-v1-schema','validateChatSnapshot(identity,input,archive.type===ARCHIVE)','validateChatSnapshot(identity,input,true)'],
];
for(const [guard,from,to]of mutations){
 assert.equal(source.split(from).length,2,guard);
 const altered=source.replace(from,to).replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_,q,name)=>JSON.stringify(new URL(name,new URL('web/public/identity-recovery.js',root)).href));
 const result=run(['--test','web/identity-recovery.test.mjs'],{LENZ_RECOVERY_MODULE:'data:text/javascript;base64,'+Buffer.from(altered).toString('base64')});
 assert.equal(result.status,1,guard+' escaped the tests');assert.match(result.stdout+result.stderr,/ERR_ASSERTION/,guard+' did not reach an assertion');console.log('DETECTED '+guard);
}
const sources={};for(const file of ['web/public/identity-recovery.js','web/public/delivery-receipts.js','web/public/evm-vendor/identity-recovery.js','web/public/peer-crypto.js','web/identity-recovery.test.mjs','web/identity-recovery-browser.test.cjs','web/build-identity-recovery.mjs','web/identity-recovery-build.json','web/verify-identity-recovery.mjs'])sources[file]=createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');
const tests=Number(base.stdout.match(/tests (\d+)/)?.[1]);assert.equal(tests,10);
await writeFile(process.env.LENZ_RECOVERY_REPORT_DIR?join(process.env.LENZ_RECOVERY_REPORT_DIR,'identity-recovery-verification.json'):new URL('web/identity-recovery-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests:tests,browserGroups:1,guardAlterations:mutations.map(m=>m[0]),sources,scope:'Identity derivation and encrypted v1/v2 chat-only archive staging; independent HKDF/OpenSSL comparison, two offline browser restores, verified delivery receipts and rejection of monetary records. No financial restore, platform portability or external audit.'},null,2)+'\n');
console.log(JSON.stringify({nodeTests:tests,browserGroups:1,guardAlterations:mutations.length}));
