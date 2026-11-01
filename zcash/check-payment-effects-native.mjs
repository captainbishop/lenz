// Explicit read-only checks on an existing unsigned PCZT. No prepare/sign/send.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectNativeEffects } from './payment-effects.mjs';
import { readNativeWallet } from './companion.mjs';
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const directory=new URL('./.testnet/payment-review/',import.meta.url);
const bytes=await readFile(new URL('current.json',directory)),record=JSON.parse(bytes);
assert(['ready','discarded'].includes(record.state));assert(['a','b'].includes(record.wallet));assert(/^[0-9a-f-]{36}$/.test(record.id));
const file=fileURLToPath(new URL(record.id+'.pczt',directory)),before=sha(await readFile(file));assert.equal(before,record.sha256);
const executable=fileURLToPath(new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe',import.meta.url));
async function snapshot() {
  const wallets={};
  for(const wallet of ['a','b']){
    const args=['wallet','-w',fileURLToPath(new URL('./.testnet/'+wallet,import.meta.url))];
    const read=async command=>JSON.parse((await execute(executable,[...args,command,'--json'],{windowsHide:true,timeout:30000,maxBuffer:1024*1024})).stdout);
    wallets[wallet]={balance:await read('balance'),transactions:await read('list-tx')};
  }
  return wallets;
}
// Validate the native binary, then bracket every cryptographic inspection with snapshots.
await readNativeWallet('balance',record.wallet);
const walletBefore=await snapshot(),verified=await inspectNativeEffects(record.wallet,file,record);
const rejected=[];
for(const [name,changed]of[
  ['wrong amount',{...record,value:record.value+1}],
  ['wrong fee',{...record,summary:{...record.summary,fee:'9999'}}],
  ['wrong recipient',{...record,summary:{...record.summary,address:'not-an-address'}}],
  ['other wallet viewing key',{...record,wallet:record.wallet==='a'?'b':'a'}]
]){await assert.rejects(()=>inspectNativeEffects(changed.wallet,file,changed));rejected.push(name);}
const walletAfter=await snapshot();assert.deepEqual(walletAfter,walletBefore);
assert.equal(sha(await readFile(file)),before);assert.equal(sha(await readFile(new URL('current.json',directory))),sha(bytes));
const sourceHashes={};for(const name of ['zcash/payment-effects.mjs','zcash/check-payment-effects-native.mjs','zcash/review-inspector/src/main.rs','zcash/review-inspector/src/effects.rs','zcash/review-inspector/Cargo.lock','zcash/review-inspector/Cargo.toml'])sourceHashes[name]=sha(await readFile(new URL('../'+name,import.meta.url)));
const walletEvidence=Object.fromEntries(['a','b'].map(wallet=>[wallet,{balance:walletAfter[wallet].balance,
  beforeSha256:sha(JSON.stringify(walletBefore[wallet])),afterSha256:sha(JSON.stringify(walletAfter[wallet]))}]));
const report={checkedAt:new Date().toISOString(),requestId:record.id,pcztSha256:before,verified,rejected,walletsUnchanged:true,journalUnchanged:true,walletEvidence,sourceHashes,
  scope:'Read-only cryptographic inspection of an existing unsigned PCZT with pinned native tools. Four rejected term/account controls; no seed access, signing, proving, synchronization, funding or broadcast. Local viewing keys and PCZT contents are not included.'};
await writeFile(new URL('./payment-effects-native-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('PASS native output/change verification; four rejected controls; wallet histories, balances, PCZT and journal unchanged.');
