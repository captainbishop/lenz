import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeCall,encodeView,encodeTokenLookup,encodeTokenDeployment,decodeTokenAddress,nearImplicitAddress,decodeViewResult,decodeSubmitResult,MAX_ENGINE_BYTES} from './engine-codec.mjs';
const addr='0x'+'12'.repeat(20), sender='0x'+'34'.repeat(20);
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const submit=(status,gas=21000n,logs=Buffer.alloc(4))=>Buffer.concat([Buffer.from([7]),status,u64(gas),logs]);

test('call and view encode fixed-width addresses and big-endian ETH value with little-endian Borsh lengths',()=>{
  const call=encodeCall({contract:addr,value:256n,input:Buffer.from('aabbcc','hex')});
  assert.equal(call.toString('hex'),'00'+'12'.repeat(20)+'00'.repeat(30)+'0100'+'03000000aabbcc');
  assert.equal(encodeView({sender,contract:addr,value:256n,input:Buffer.from('aabbcc','hex')}).toString('hex'),'34'.repeat(20)+call.toString('hex').slice(2));
  assert.equal(encodeCall({contract:addr}).length,57);
  const max=encodeCall({contract:addr,value:(1n<<256n)-1n});assert.equal(max.subarray(21,53).toString('hex'),'ff'.repeat(32));
});
test('calldata, addresses, unsafe numeric amounts and uint256 overflows are rejected',()=>{
  for(const value of [-1n,1n<<256n,1,Number.MAX_SAFE_INTEGER,'1'])assert.throws(()=>encodeCall({contract:addr,value}));
  for(const contract of ['0x1','12'.repeat(20),'0x'+'gg'.repeat(20)])assert.throws(()=>encodeCall({contract}));
  assert.throws(()=>encodeCall({contract:addr,input:'aabb'}));
  assert.throws(()=>encodeCall({contract:addr,input:new Uint8Array(32769)}));
});
test('NEAR caller derivation and token mapping methods use the pinned Engine interface',()=>{
  assert.equal(nearImplicitAddress('alice.near'),'0x10315b5be6b5369e2188c8d7b18ec932c936a21e');
  assert.equal(encodeTokenLookup('token.testnet').toString('hex'),'0d000000746f6b656e2e746573746e6574');
  assert.deepEqual(encodeTokenDeployment('token.testnet'),Buffer.concat([Buffer.from([1]),encodeTokenLookup('token.testnet')]));
  assert.equal(decodeTokenAddress(Buffer.from('12'.repeat(20),'hex')),addr);
  for(const id of ['A.testnet','a..testnet','-a.testnet','a','x'.repeat(65),'a@b.testnet'])assert.throws(()=>nearImplicitAddress(id));
  assert.throws(()=>decodeTokenAddress(Buffer.alloc(21)));
});
test('all twenty upstream status variants decode; only Succeed is an EVM success',()=>{
  // Aurora's pinned 42-byte serialization regression fixture; functional ABI data.
  const upstream=Buffer.from('140000000000000000010000000002030405060708090a0b0c0d000e0f101112050000006572726f7213','hex');
  assert.equal(createHash('sha256').update(upstream).digest('hex'),'0a36ee02aa5476ae84f77683903a9f8121c3b1ab42830e9685264ca4490a4851');
  const variants=['0000000000','0100000000','02','03','04','05','06','07','08','09','0a','0b','0c','0d00','0e','0f','10','11','12050000006572726f72','13'].map(x=>Buffer.from(x,'hex'));
  assert.deepEqual(Buffer.concat([u32(20),...variants]),upstream);
  for(const [tag,status]of variants.entries()){
    const view=decodeViewResult(status),execution=decodeSubmitResult(submit(status));
    assert.equal(view.succeeded,tag===0);assert.equal(execution.succeeded,tag===0);assert.equal(execution.status,view.status);assert.equal(execution.gasUsed,21000n);
  }
  assert.equal(decodeViewResult(variants[18]).error,'error');assert.equal(decodeViewResult(variants[13]).opcode,0);
});
test('submit output, full-width gas and event topics/data preserve exact bytes',()=>{
  const status=Buffer.from('0002000000cafe','hex'),log=Buffer.concat([u32(1),Buffer.from(addr.slice(2),'hex'),u32(2),Buffer.alloc(32,0x11),Buffer.alloc(32,0x22),u32(3),Buffer.from('abcdef','hex')]);
  const bytes=submit(status,(1n<<64n)-1n,log),result=decodeSubmitResult(bytes);
  assert.equal(result.output,'0xcafe');assert.equal(result.gasUsed,18446744073709551615n);
  assert.deepEqual(result.logs,[{address:addr,topics:['0x'+'11'.repeat(32),'0x'+'22'.repeat(32)],data:'0xabcdef'}]);
  for(let n=0;n<bytes.length;n++)assert.throws(()=>decodeSubmitResult(bytes.subarray(0,n)));
});
test('wrong versions, unknown statuses, oversized vectors, trailing bytes and invalid UTF-8 fail closed',()=>{
  const ok=submit(Buffer.from('0000000000','hex'));
  assert.throws(()=>decodeSubmitResult(Buffer.from([6,...ok.subarray(1)])));
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from([20]))));
  assert.throws(()=>decodeSubmitResult(Buffer.concat([ok,Buffer.from([0])])));
  assert.throws(()=>decodeSubmitResult(new Uint8Array(MAX_ENGINE_BYTES+1)));
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from('00ffffffff','hex'))));
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from('0000000000','hex'),0n,u32(129))));
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from('0000000000','hex'),0n,Buffer.concat([u32(129),Buffer.alloc(129*28)]))),/vector limit/);
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from('0000000000','hex'),0n,Buffer.concat([u32(1),Buffer.alloc(20),u32(5)]))));
  assert.throws(()=>decodeSubmitResult(submit(Buffer.from('0000000000','hex'),0n,Buffer.concat([u32(1),Buffer.alloc(20),u32(5),Buffer.alloc(5*32),u32(0)]))),/vector limit/);
  assert.throws(()=>decodeViewResult(Buffer.from('1201000000ff','hex')));
  assert.throws(()=>decodeSubmitResult(Buffer.from('0000000000','hex')));
  assert.throws(()=>decodeViewResult(ok));
});
