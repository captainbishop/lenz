import test from 'node:test';import assert from 'node:assert/strict';
import {checkedPoolPrice,poolReceive} from '../web/public/pool-price.js';
import {QUOTE_POOL} from '../web/public/market-quote.js';
import {readPoolPrice} from './pool-price.mjs';
import {quoteMock} from './market-quote-fixtures.mjs';
const now=Date.now(),fixture=()=>({kind:'pool-price',marketId:QUOTE_POOL,source:'https://mainnet.base.org',sqrtPriceX96:(1n<<96n).toString(),sourceTime:now-1000,observedAt:now,blockNumber:'123',blockHash:'0x'+'aa'.repeat(32),executable:false});
test('latest-block pool read validates the real decoder and returns no executable quote',async()=>{const p=await readPoolPrice(quoteMock());assert.equal(p.marketId,QUOTE_POOL);assert.equal(p.executable,false);assert(Object.isFrozen(p));});
test('instant amounts use exact integers, token decimals and the pool fee in both directions',()=>{
 const price=checkedPoolPrice(fixture());assert.equal(poolReceive(price,'1','weth-to-usdc'),'999500000000');assert.equal(poolReceive(price,'1000000000000','usdc-to-weth'),'0.9995');
});
test('expired prices remain usable only as explicitly cached non-executable data',()=>{
 const p=fixture();p.sourceTime-=120000;p.observedAt-=120000;assert.throws(()=>checkedPoolPrice(p),/expired/);assert.equal(checkedPoolPrice(p,{cached:true}).executable,false);
});
test('wrong chain endpoint, pool, block and impossible timestamps are rejected',()=>{
 for(const change of [{source:'https://evil.example'},{marketId:'another-pool'},{blockHash:'0x1'},{blockNumber:'01'},{sourceTime:now+60000},{observedAt:now+60000},{executable:true}])assert.throws(()=>checkedPoolPrice({...fixture(),...change}));
});
test('malformed and extreme square-root prices cannot enter amount calculations',()=>{
 for(const sqrtPriceX96 of ['0','-1','1e20','4295128739','1461446703485210103287273052203988822378723970342','9'.repeat(80)])assert.throws(()=>checkedPoolPrice({...fixture(),sqrtPriceX96}));
});
test('invalid precision, signs, exponent inputs and directions cannot produce outputs',()=>{
 const p=checkedPoolPrice(fixture());for(const input of ['-1','1e3','0.0000001','NaN'])assert.throws(()=>poolReceive(p,input,'usdc-to-weth'));assert.throws(()=>poolReceive(p,'1','unknown'));
});
