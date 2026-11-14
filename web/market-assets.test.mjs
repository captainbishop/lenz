import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMarketAssets,checkedMarketAssets} from './public/market-assets.js';
test('asset context uses exact provider identity and retains only finite seven-day samples',()=>{
 const now=Date.now(),base={id:'bitcoin',symbol:'btc',name:'Bitcoin',current_price:75000,market_cap:1500000000000,total_volume:9000000000,circulating_supply:20000000,price_change_percentage_24h:-2,last_updated:new Date(now).toISOString(),sparkline_in_7d:{price:Array(168).fill(76000)}};
 const value=normalizeMarketAssets([base,{...base,id:'fake-bitcoin'}],now);assert.equal(value.assets.length,1);assert.equal(value.assets[0].key,'BTC');assert.equal(value.assets[0].history.length,168);
 assert.equal(normalizeMarketAssets([{...base,symbol:'eth'}],now).assets.length,0);
 assert.equal(normalizeMarketAssets([{...base,sparkline_in_7d:{price:[1,2,null]}}],now).assets[0].history.length,0);
 assert.throws(()=>checkedMarketAssets({...value,assets:[{...value.assets[0],key:'FAKE'}]}));
});
