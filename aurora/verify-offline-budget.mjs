import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sourcePath=join(import.meta.dirname,'contracts/OfflineBudget.sol'),source=await readFile(sourcePath,'utf8'),dir=await mkdtemp(join(tmpdir(),'lenz-budget-guards-'));
const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});assert(!r.error,String(r.error));return {code:r.status,output:r.stdout+r.stderr};};
const normal=run(['--test','web/offline-budget.test.mjs','aurora/offline-budget.test.mjs','aurora/offline-budget-browser.test.mjs']);assert.equal(normal.code,0,normal.output);
const mutations=[
 ['debit-cap','debit > p.maxDebit','false','signed orders still'],
 ['fee-cap','o.fee > p.maxFee','false','signed orders still'],
 ['price-floor','o.minOutput < floor','false','smallest price floor'],
 ['signer-binding','recover(digest, signature) != p.signer','false','tampered signature'],
 ['nonce','o.nonce != b.nonce','false','tampered signature'],
 ['minimum-output','afterOutput - beforeOutput < o.minOutput','false','venue failure'],
 ['revocation','b.owner == address(0) || b.revoked ||','b.owner == address(0) ||','changed code and callback'],
 ['isolated-caller','try b.executor.run{value: o.amount}(p.target, data) {} catch { revert ExecutionFailed(); }','(bool ok,) = p.target.call{value: o.amount}(data); if (!ok) revert ExecutionFailed();','different budgets'],
 ['helper-manager','if (msg.sender != manager) revert Unauthorized();','if (false) revert Unauthorized();','native output'],
 ['deployment-safety','if (block.chainid != 31337) revert Unavailable();','if (false) revert Unavailable();','local rehearsal cannot'],
];
const detected=[];
for(const [name,needle,replacement,pattern]of mutations){assert(source.includes(needle),name+' target missing');const file=join(dir,name+'.sol');await writeFile(file,source.replace(needle,replacement));const r=run(['--test','--test-name-pattern='+pattern,'aurora/offline-budget.test.mjs'],{...process.env,LENZ_BUDGET_CONTRACT_SOURCE:file});assert.notEqual(r.code,0,name+' survived');assert.match(r.output,/AssertionError|ERR_ASSERTION/);detected.push(name);console.log('Detected '+name);}
assert.equal(await readFile(sourcePath,'utf8'),source);
const sources={};for(const file of ['aurora/contracts/OfflineBudget.sol','aurora/offline-budget-fixture.mjs','aurora/offline-budget.test.mjs','aurora/offline-budget-browser.test.mjs','aurora/verify-offline-budget.mjs','web/public/offline-budget.js','web/public/evm-vendor/offline-budget.js','web/offline-budget.test.mjs','web/build-offline-budget.mjs','web/offline-budget-build.json','web/public/chat-sw.js'])sources[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
await writeFile(join(import.meta.dirname,'offline-budget-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),tests:Number(normal.output.match(/tests (\d+)/)[1]),guardAlterations:detected,sources,scope:'Local chain31337 contract execution, ephemeral browser offline signing/encryption/cache and in-process ciphertext handoff. Synthetic venue; no real funds, external chain, deployed provider adapter, mesh handoff, private settlement, general position support or product recovery.'},null,2)+'\n');console.log(normal.output.trim());
