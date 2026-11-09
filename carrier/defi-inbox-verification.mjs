// Local transport and authorization evidence. Does not contact a blockchain.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../',import.meta.url));
const files = ['carrier/defi-inbox.mjs','carrier/defi-inbox.test.mjs','carrier/defi-inbox-verification.mjs',
  'carrier/server.mjs','carrier/store.mjs','web/public/defi-request.js','web/public/peer-crypto.js',
  'web/public/profile-display.js','web/public/chat-access.js','web/public/carrier-protocol.js','web/public/near-protocol.js',
  'web/public/rhea-protocol.js','web/public/near-deposit.js'];
const contents = Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(join(root,file),'utf8')])));
const run = directory => {
  const r=spawnSync(process.execPath,['--test','--test-reporter=tap','carrier/defi-inbox.test.mjs'],
    {cwd:directory,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  assert.equal(r.error,undefined); assert.doesNotMatch(r.stdout+r.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
  assert.match(r.stdout,/^# cancelled 0$/m); assert.match(r.stdout,/^# skipped 0$/m); return r;
};
const baseline=run(root);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);assert.match(baseline.stdout,/^# fail 0$/m);
const passed=Number(baseline.stdout.match(/^# tests (\d+)$/m)?.[1]);assert(passed>0);
console.log('DeFi inbox: '+passed+' tests passed');
const protocol='web/public/defi-request.js',inbox='carrier/defi-inbox.mjs';
const variants=[
  ['disclosure',protocol,'r.disclosure === PUBLIC_TESTNET_DISCLOSURE','true','missing, private-only'],
  ['executor',protocol,'r.sender === sender.id && r.executor === executor.id && r.sender !== r.executor','true','an authenticated carrier packet'],
  ['owner',protocol,'p.instruction.owner === compressed(sender.signingPublic)','true','changed owner, executor'],
  ['signature',protocol,'await verifyValue(sender.signingPublic, terms(r), r.signature)','true','outer authorization signature'],
  ['expiry',protocol,'r.expiresAt > now','true','request lifetime'],
  ['refund-payer',protocol,'d.payer === i.receiver_id','true','refund-return binds'],
  ['conflict-slot',protocol,'? r.operation.packet.instruction.input : r.operation.deposit.id','? r.id : r.operation.deposit.id','different signed authorizations'],
  ['capacity',inbox,'total.n < this.#limits.maxRequests','true','global, byte'],
  ['late-expiry',inbox,'storedAt < request.expiresAt && storedAt < e.expiresAt','true','expiry during verification'],
  ['receipt-state',protocol,"receipt.state === 'stored'",'true','storage receipts reject'],
  ['spending-authority',protocol,"[DEFI_REQUEST, 'input', r.operation.packet.instruction.owner, r.operation.kind,","[DEFI_REQUEST, 'input', r.sender, r.operation.kind,",'a second messaging identity'],
  ['legacy-conflicts',inbox,'[conflict,...legacy]','[conflict]','a second messaging identity'],
  ['input-snapshot',protocol,'const r = structuredClone(input), c = structuredClone(config);','const r = input, c = structuredClone(config);','validation snapshots'],
];
const mutations=[];
for (const [name,file,from,to,expected] of variants) {
  assert.equal(contents[file].split(from).length,2,'Mutation must match once: '+name);
  const directory=await mkdtemp(join(tmpdir(),'lenz-defi-mutation-'));
  try {
    for (const f of files) {const path=join(directory,f);await mkdir(dirname(path),{recursive:true});await writeFile(path,f===file?contents[f].replace(from,to):contents[f]);}
    const r=run(directory);assert.equal(r.status,1,name+' survived');
    const failed=[...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]);
    assert(failed.some(n=>n.startsWith(expected)),name+' did not fail its intended assertion: '+r.stdout);
    assert.match(r.stdout,/ERR_ASSERTION/);
    mutations.push({name,detected:true,failedTests:failed});console.log('Detected guard alteration: '+name);
  } finally {assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
}
const sha = value => createHash('sha256').update(value).digest('hex'), sourceFiles={};
for (const file of files) {sourceFiles[file]=sha(await readFile(join(root,file)));assert.equal(sourceFiles[file],sha(contents[file]),'Verification source changed: '+file);}
await writeFile(join(root,'carrier/defi-inbox-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),node:process.version,
  platform:process.platform,scope:'Disposable identities, synthetic reserve roots, real P-256/AES-GCM, local SQLite and two loopback HTTP carriers. No chain calls, funding, wallet changes or physical-device tests.',
  tests:{passed,failed:0,skipped:0},mutations,sourceFiles},null,2)+'\n');
