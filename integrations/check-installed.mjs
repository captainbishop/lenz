// Package/load checks only. The supplied salt is a fixture, never an execution nonce.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { emptyAuthenticationPayload } from './intents-auth-payload.mjs';
const json=async url=>JSON.parse(await readFile(url,'utf8'));
async function packages(directory){
  const root=new URL(directory,import.meta.url),manifest=await json(new URL('package.json',root));
  const lockBytes=await readFile(new URL('package-lock.json',root)),lock=JSON.parse(lockBytes);
  const installed={};
  for(const [name,wanted] of Object.entries({...manifest.dependencies,...manifest.devDependencies})){
    const actual=await json(new URL('node_modules/'+name+'/package.json',root));
    assert.equal(actual.version,wanted,name);assert.equal(lock.packages['node_modules/'+name].version,wanted,name+' lock');installed[name]=actual.version;
  }
  return {installed,lockSha256:createHash('sha256').update(lockBytes).digest('hex')};
}
const aurora=await packages('../aurora/'),intents=await packages('./'),oneclick=await packages('./quote-verifier/');
const payload=emptyAuthenticationPayload({signerId:'a'.repeat(64),salt:new Uint8Array([1,2,3,4])});
assert.equal(payload.verifying_contract,'intents.near');assert.deepEqual(payload.intents,[]);
const {verifyQuoteSignature}=await import('./quote-verifier/index.mjs');assert.equal(typeof verifyQuoteSignature,'function');assert.equal(verifyQuoteSignature({}),false);
const report={checkedAt:new Date().toISOString(),node:process.version,aurora,intents,oneclick,checks:['Installed versions match manifests and lockfiles','Authentication builder creates an unsigned empty fixture payload','1Click verifier loads and rejects an empty response'],partnerKeyPresentInThisProcess:!!process.env.LENZ_INTENTS_API_KEY,scope:'Local package checks only; no network, account creation, signing or transaction. Aurora execution and Intents routes need separate integration evidence.'};
await writeFile(new URL('./installation-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
