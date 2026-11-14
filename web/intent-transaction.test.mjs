import test from 'node:test';
import assert from 'node:assert/strict';
import {intentTransaction} from './public/intent-action-ui.js';
test('a native shielded transaction is identified as Zcash without a NEAR explorer link',()=>{
 const reference='a'.repeat(64),result=intentTransaction({network:'testnet',verifier:'native-canonical-wallet-effects/v1',transaction:reference},{chainId:'zcash:testnet'});
 assert.deepEqual(result,{label:'Zcash testnet transaction',reference});
});
test('known NEAR and Aurora receipt evidence keeps its pinned NEAR testnet explorer',()=>{
 const reference='43v4STy5F2KAarr24YWCHeUKC3SGxWN1TQXVko2PMLDQ';
 for(const [chainId,verifier]of [['near:testnet','verifier.testnet'],['evm:1313161555','Aurora original factory']])assert.deepEqual(intentTransaction({network:'testnet',verifier,transaction:reference},{chainId}),{label:'View on NEAR testnet',reference,href:'https://testnet.nearblocks.io/txns/'+reference});
});
test('unknown chain evidence has no invented explorer and malformed references stay undisplayed',()=>{
 assert.deepEqual(intentTransaction({network:'testnet',verifier:'future',transaction:'transaction-one'},{chainId:'unknown'}),{label:'Transaction ID',reference:'transaction-one'});
 for(const transaction of ['','https://attacker.example','bad\nreference','a'.repeat(129)])assert.equal(intentTransaction({network:'testnet',verifier:'future',transaction},{chainId:'unknown'}),null);
});
