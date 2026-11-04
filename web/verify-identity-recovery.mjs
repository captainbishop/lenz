import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
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
];
for(const [guard,from,to]of mutations){
 assert.equal(source.split(from).length,2,guard);
 const altered=source.replace(from,to).replaceAll("'./evm-vendor/identity-recovery.js'",JSON.stringify(new URL('web/public/evm-vendor/identity-recovery.js',root).href)).replaceAll("'./peer-crypto.js'",JSON.stringify(new URL('web/public/peer-crypto.js',root).href));
 const result=run(['--test','web/identity-recovery.test.mjs'],{LENZ_RECOVERY_MODULE:'data:text/javascript;base64,'+Buffer.from(altered).toString('base64')});
 assert.equal(result.status,1,guard+' escaped the tests');assert.match(result.stdout+result.stderr,/ERR_ASSERTION/,guard+' did not reach an assertion');console.log('DETECTED '+guard);
}
const sources={};for(const file of ['web/public/identity-recovery.js','web/public/evm-vendor/identity-recovery.js','web/public/peer-crypto.js','web/identity-recovery.test.mjs','web/identity-recovery-browser.test.cjs','web/build-identity-recovery.mjs','web/identity-recovery-build.json','web/verify-identity-recovery.mjs'])sources[file]=createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');
const tests=Number(base.stdout.match(/tests (\d+)/)?.[1]);assert.equal(tests,7);
await writeFile(new URL('web/identity-recovery-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),nodeTests:tests,browserGroups:1,guardAlterations:mutations.map(m=>m[0]),sources,scope:'New-identity derivation and encrypted chat-only archive staging; independent HKDF/OpenSSL comparison, two offline browser restores, rejection of monetary records. No active onboarding, migration, financial restore, platform portability or external audit.'},null,2)+'\n');
console.log(JSON.stringify({nodeTests:tests,browserGroups:1,guardAlterations:mutations.length}));
