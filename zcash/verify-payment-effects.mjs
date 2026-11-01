// Verify saved browser/native evidence without wallet, network or signing access.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateEffects } from './payment-effects.mjs';
const root=new URL('../',import.meta.url),read=async file=>JSON.parse(await readFile(new URL(file,root)));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function verify(native,live,fixture,prior) {
  assert(native.walletsUnchanged&&native.journalUnchanged&&live.ok&&fixture.ok);
  assert.deepEqual(live.errors,[]);assert.deepEqual(fixture.errors,[]);
  assert.equal(live.checks.length,7);assert.equal(fixture.checks.length,10);
  assert.equal(live.effectChecks.length,1);assert.equal(live.networkChecks.length,1);
  assert.equal(live.networkChecks[0].status,'expired');
  const effects=live.effectChecks[0],{checkedAt,...terms}=effects;
  assert.deepEqual(terms,native.verified);
  validateEffects(terms,{value:1000000,summary:{fee:'10000',change:'88980000',address:terms.recipient}});
  for(const action of ['review','review-effects','review-check','review-discard'])assert.equal(live.requests.filter(x=>x.url.endsWith('/'+action)).length,1);
  for(const request of live.requests){
    assert(['review','review-status','review-effects','review-check','review-discard'].some(a=>request.url.endsWith('/'+a)));
    assert.equal(request.body.wallet,'a');
    if(request.body.id)assert.equal(request.body.id,native.requestId);
  }
  assert.equal(native.rejected.length,4);
  for(const wallet of ['a','b']){
    // The companion reports camelCase; native list-tx uses these snake_case fields.
    const old={balance:prior.wallets[wallet].balance.balance,transactions:prior.wallets[wallet].transactions.transactions.map(tx=>({mined_height:tx.minedHeight,txid:tx.txid}))};
    assert.deepEqual(native.walletEvidence[wallet].balance,old.balance);
    assert.equal(native.walletEvidence[wallet].beforeSha256,sha(JSON.stringify(old)));
    assert.equal(native.walletEvidence[wallet].afterSha256,native.walletEvidence[wallet].beforeSha256);
  }
  return ['Native and browser outputs match exact reviewed values; ownership does not override expired status',
    'Only one unsigned preparation, output check, expiry read and discard were requested; no signing or broadcast route',
    'Both native account balances and history hashes match the earlier pre-feature evidence'];
}
const native=await read('zcash/payment-effects-native-results.json'),live=await read('web/zcash-effects-live-results.json'),fixture=await read('web/zcash-effects-browser-results.json'),prior=await read('zcash/payment-review-native-after.json');
const checks=verify(native,live,fixture,prior),rejected=[];
for(const [name,alter]of[
  ['false change ownership',x=>{x.native.verified.changeOwned=false;}],
  ['different request',x=>{x.native.requestId='wrong';}],
  ['unexpected send',x=>{x.live.requests.push({url:'/api/zcash/send',body:{wallet:'a'}});}],
  ['changed history',x=>{x.native.walletEvidence.a.afterSha256='0'.repeat(64);}]
]){
  const changed=structuredClone({native,live});alter(changed);assert.throws(()=>verify(changed.native,changed.live,fixture,prior));rejected.push(name);
}
const hashes={...native.sourceHashes};
for(const[file,expected]of Object.entries(hashes))assert.equal(sha(await readFile(new URL(file,root))),expected,'Native evidence source changed: '+file);
for(const file of ['zcash/verify-payment-effects.mjs','zcash/payment-effects-native-results.json','web/zcash-effects-live-results.json','web/zcash-effects-browser-results.json','zcash/payment-review.mjs','web/zcash-relay.mjs','web/public/zcash-lab.html','web/public/zcash-lab.js','web/public/zcash-lab.css'])hashes[file]=sha(await readFile(new URL(file,root)));
await writeFile(new URL('zcash/payment-effects-verification.json',root),JSON.stringify({checkedAt:new Date().toISOString(),checks,rejectedAlterations:rejected,actualBrowser:live.checks.length,fixtureBrowser:fixture.checks.length,sourceHashes:hashes,
  scope:'Saved-evidence and source verification; no native command or financial action. Cryptographic output verification is separate from expiry, input availability, witnesses, signing and recovery.'},null,2)+'\n');
console.log(`PASS ${checks.length} saved-evidence checks; ${rejected.length} altered records rejected; native balances/history unchanged.`);
