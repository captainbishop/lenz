import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketIndicesReader} from './market-indices.mjs';
import {marketIndex} from '../web/public/market-indices.js';
test('indices retain independently dated observations when a provider field becomes invalid',async()=>{
 let now=1000000000,failed=false,calls=0;const reader=createMarketIndicesReader({clock:()=>now,fetcher:async url=>{calls++;const time=new Date(now).toISOString();return new Response(JSON.stringify({status:{error_code:0},data:url.includes('fear-and')?{value:failed?150:32,update_time:time,value_classification:'Fear'}:url.includes('cmc20')?{value:154.77,value_24h_percentage_change:-0.37,last_update:time}:{altcoin_index:39,snapshot_time:time}}));}});
 const first=await reader();assert.equal(first.fearGreed.value,32);assert.equal(first.fearGreed.classification,'Fear');await reader();assert.equal(calls,2);
 now+=400000;failed=true;const next=await reader();assert.equal(next.fearGreed.observedAt,1000000000);assert.equal(next.altcoinSeason.observedAt,now);
 assert.throws(()=>marketIndex('cmc20',{status:{error_code:0},data:{value:true,last_update:new Date(now).toISOString()}},now));
});
