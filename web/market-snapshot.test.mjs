import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {marketSnapshot,marketFreshness}=await import(process.env.LENZ_SNAPSHOT_MODULE?pathToFileURL(process.env.LENZ_SNAPSHOT_MODULE):new URL('./public/market-snapshot.js',import.meta.url));
const report=JSON.parse(await readFile(new URL('../integrations/market-discovery-live.json',import.meta.url))),now=Date.now();
const sample=()=>{const s=structuredClone(report.results.find(r=>r.provider==='uniswap').observation);s.observedAt=now;s.expiresAt=now+60000;return s;};
test('saved, stale and current receipt times cannot be confused',()=>{
 const s=marketSnapshot(sample(),{now});assert.equal(marketFreshness(s,{now}),'Recently read');assert.equal(marketFreshness(s,{now,saved:true}),'Saved data');assert.equal(marketFreshness(s,{now,online:false}),'Saved data');assert.equal(marketFreshness(s,{now:now+60000}),'Needs refresh');assert.equal(marketFreshness(s,{now:now-10000}),'Needs refresh');
});
test('snapshot rejects execution claims, network substitution and future receipt timestamps',()=>{
 for(const edit of [x=>x.executable=true,x=>x.chainId='near:mainnet',x=>x.rows[0].executable=true,x=>x.observedAt=now+60000,x=>x.expiresAt=now+3600000,x=>x.rows[0].assets[0].decimals=99]){const s=sample();edit(s);assert.throws(()=>marketSnapshot(s,{now}));}
});
test('market snapshots detach and freeze asset references and reject duplicate rows',()=>{
 const s=sample(),frozen=marketSnapshot(s,{now});s.rows[0].assets[0].symbol='altered';assert.notEqual(frozen.rows[0].assets[0].symbol,'altered');assert.throws(()=>frozen.rows[0].label='changed',TypeError);
 const duplicate=sample();duplicate.rows.push(duplicate.rows[0]);assert.throws(()=>marketSnapshot(duplicate,{now}),/Invalid market row/);
});
