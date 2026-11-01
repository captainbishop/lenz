import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeEngineQuery,EngineViewError,isMissingToken} from './engine-query.mjs';
const block={hash:'fixture-block',height:123};
const response=value=>({block_hash:block.hash,block_height:block.height,...value});

test('query bytes retain exact values and the selected block',()=>{
  assert.deepEqual(decodeEngineQuery(response({result:[0,128,255]}),block),Buffer.from([0,128,255]));
  for(const change of [{block_hash:'other'},{block_height:124}])assert.throws(()=>decodeEngineQuery({...response({result:[]}),...change},block),/different block/);
});
test('only the observed Engine contract error identifies a missing token mapping',()=>{
  const message='wasm execution failed with error: HostError(GuestPanic { panic_msg: "ERR_NEP141_NOT_FOUND" })';
  assert.throws(()=>decodeEngineQuery(response({error:message,logs:[]}),block),error=>isMissingToken(error));
  assert(!isMissingToken(new Error(message)));
  assert(!isMissingToken(new EngineViewError('network timeout')));
  assert(!isMissingToken(new EngineViewError('prefix '+message)));
});
test('ambiguous errors, invalid bytes and oversized results fail closed',()=>{
  for(const value of [{error:'failed',result:[]},{error:null},{error:''},{error:'x'.repeat(1025)},
    {result:[-1]},{result:[256]},{result:[0.5]},{result:['0']},{result:'AA=='},{result:Array(65537).fill(0)},{}]){
    assert.throws(()=>decodeEngineQuery(response(value),block));
  }
});
