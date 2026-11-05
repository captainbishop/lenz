import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const tests=['web/receiving-instructions.test.mjs','web/evm-wallet.test.mjs','web/evm-transfer.test.mjs','web/account-backup.test.mjs','web/chat-restore.test.mjs','web/identity-recovery.test.mjs','web/legacy-recovery.test.mjs'];
const sources=[...tests,'web/public/receiving-instructions.js','web/public/payment-recipient.js','web/public/receiving-link-ui.js','web/public/evm-wallet.js','web/public/evm-wallet-ui.js','web/public/evm-transfer.js','web/public/evm-transfer-ui.js','web/public/evm-transfer-service.js','web/public/evm-transfer-store.js','web/public/evm-networks.js','web/public/evm-markets.js','web/public/peer-crypto.js','web/public/chat-access.js','web/public/evm-vendor/offline-budget.js','web/public/money.css','web/public/chat-sw.js','web/verify-receiving-links.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const run=files=>spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const before=await hashes(),result=run(tests);assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/^# fail 0$/m);
const passed=Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]);assert.equal(passed,69);
const cases=[
 {name:'wallet ownership',file:'web/public/receiving-instructions.js',from:"assert(address(recoverAddress(TypedDataEncoder.hash(d.domain,d.types,d.message),signature))===terms.address,'Receiving wallet ownership could not be verified.');",to:'return;',failure:'each signed receiving field rejects substitution even if the other signature is refreshed'},
 {name:'Lenz signature',file:'web/public/receiving-instructions.js',from:"assert(await verifyValue(t.profile.signingPublic,[RECEIVING_DOMAIN,t,input.walletSignature],input.signature),'Receiving instructions changed or were not signed by the recipient.');",to:'// verification removed',failure:'each signed receiving field rejects substitution even if the other signature is refreshed'},
 {name:'receiving expiry',file:'web/public/receiving-instructions.js',from:'&&now<value.expiresAt',to:'',failure:'missing signatures, extra fields, wrong person, stale and future links are rejected'},
 {name:'destination network',file:'web/public/payment-recipient.js',from:"assert(recipient.chainId===terms.chainId,'Receiving network differs. A cross-chain payment route is not connected yet.');",to:'// network guard removed',failure:'network, asset, address and expiry guards run before transfer preparation'},
];
const mutations=[];
// Isolated copies only: the running preview never serves an altered guard.
const root=await mkdtemp(path.join(tmpdir(),'lenz-receiving-check-'));
function rewrite(source,file,replacements={}){return source.replace(/from (['"])(\.[^'"]+)\1/g,(_,quote,spec)=>{const absolute=path.resolve(path.dirname(file),spec);return 'from '+quote+(replacements[absolute]??pathToFileURL(absolute).href)+quote;});}
try{
 for(const [i,mutation]of cases.entries()){
  const source=await readFile(mutation.file,'utf8');assert.equal(source.split(mutation.from).length,2,'Guard must occur exactly once.');
  const modified=path.join(root,'mutation-'+i+'.mjs'),testFile=path.join(root,'test-'+i+'.mjs');
  await writeFile(modified,rewrite(source.replace(mutation.from,mutation.to),mutation.file));
  await writeFile(testFile,rewrite(await readFile(tests[0],'utf8'),tests[0],{[path.resolve(mutation.file)]:pathToFileURL(modified).href}));
  const checked=run([testFile]);assert.notEqual(checked.status,0,mutation.name+' was not detected');
  assert(checked.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.includes(mutation.failure)),checked.stdout+checked.stderr);
  mutations.push(mutation.name);
 }
}finally{assert(path.dirname(path.resolve(root))===path.resolve(tmpdir())&&path.basename(root).startsWith('lenz-receiving-check-'));await rm(root,{recursive:true,force:true});}
assert.deepEqual(await hashes(),before,'Sources changed during verification.');
await writeFile('web/receiving-links-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),runtime:process.version,passed,failed:0,detectedGuardChanges:mutations,scope:'Local signatures, synthetic wallet provider and transfer fixtures, account regressions. No live transaction, destination funding, confidential receiving, hosted lookup or physical-device verification.',sourceHashes:before},null,2)+'\n');
console.log(JSON.stringify({passed,failed:0,detectedGuardChanges:mutations}));
