import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHyperLending,checkedHyperLending} from '../web/public/lending-markets.js';
import {createHyperLendingReader} from './lending-markets.mjs';
const reserves=()=>[[0,{borrowYearlyRate:'0.05',supplyYearlyRate:'0.03',balance:'123.45',utilization:'0.7',oraclePx:'1.0',ltv:'0.0',totalSupplied:'500',totalBorrowed:'350'}]];
const meta=()=>({tokens:[{index:150,name:'HYPE'},{index:0,name:'USDC'}]});
test('lending rates bind to token index, retain token units and do not grant execution authority',()=>{
 const snapshot=normalizeHyperLending(reserves(),meta());assert.equal(snapshot.rows[0].symbol,'USDC');assert.equal(snapshot.rows[0].supplyAPR,3);assert.equal(snapshot.rows[0].availableLiquidity,'123.45');assert.equal(snapshot.rows[0].executable,false);assert.equal(checkedHyperLending(snapshot).rows.length,1);
});
test('ambiguous token identities and malformed or excessive rates cannot become lending figures',()=>{
 assert.throws(()=>normalizeHyperLending(reserves(),{tokens:[...meta().tokens,{index:0,name:'FAKE'}]}));
 for(const field of ['borrowYearlyRate','balance','oraclePx']){const r=reserves();r[0][1][field]='NaN';assert.throws(()=>normalizeHyperLending(r,meta()));}
 const r=reserves();r[0][1].ltv='1.01';assert.throws(()=>normalizeHyperLending(r,meta()));
 const snapshot=normalizeHyperLending(reserves(),meta());snapshot.rows[0].executable=true;assert.throws(()=>checkedHyperLending(snapshot));
});
test('public lending reads coalesce and preserve original timestamps after source failure',async()=>{
 let now=Date.now(),failed=false,calls=0;const read=createHyperLendingReader({clock:()=>now,fetcher:async(url,o)=>{calls++;assert.equal(url,'https://api.hyperliquid-testnet.xyz/info');assert.equal(o.redirect,'error');if(failed)throw Error();return Response.json(JSON.parse(o.body).type==='spotMeta'?meta():reserves());}});
 const [a,b]=await Promise.all([read(),read()]);assert.deepEqual(a,b);assert.equal(calls,2);now+=61000;failed=true;const stale=await read();assert.equal(stale.stale,true);assert.equal(stale.observedAt,a.observedAt);assert.equal((await read()).stale,true);
});
