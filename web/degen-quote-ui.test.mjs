import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDegenQuote} from './public/degen-quote-ui.js';
test('malformed discovery addresses cannot interrupt optional quote mounting',()=>{
 const row={chain:{id:'eip155:8453'},pool:'0x'+'22'.repeat(20),address:'0x'+'11'.repeat(20)};
 for(const field of ['pool','address'])for(const value of ['0x'+'00'.repeat(20),'not-an-address']){const cleanup=mountDegenQuote({}, {...row,[field]:value});assert.equal(typeof cleanup,'function');assert.doesNotThrow(cleanup);}
});
