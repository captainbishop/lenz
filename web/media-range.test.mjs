import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaRange, cachedMediaResponse } from './public/media-range.js';

test('video byte ranges support bounded, open-ended and suffix requests',()=>{
  assert.deepEqual(mediaRange('bytes=2-4',10),{start:2,end:4});
  assert.deepEqual(mediaRange('bytes=4-',10),{start:4,end:9});
  assert.deepEqual(mediaRange('bytes=-3',10),{start:7,end:9});
  assert.deepEqual(mediaRange('bytes=5-99',10),{start:5,end:9});
  assert.deepEqual(mediaRange('bytes=-99',10),{start:0,end:9});
  for(const value of ['bytes=10-','bytes=8-2','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=9007199254740992-','other=0-1'])assert.equal(mediaRange(value,10),null,value);
});
test('offline cache serves exact partial bytes and rejects unsatisfiable ranges',async()=>{
  const source=()=>new Response(new Uint8Array([10,20,30,40,50]),{headers:{'Content-Type':'video/mp4'}});
  const request=range=>new Request('https://lenz.example/previews/chat-light.mp4',{headers:{Range:range}});
  const partial=await cachedMediaResponse(request('bytes=1-3'),source());
  assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),'bytes 1-3/5');assert.equal(partial.headers.get('Content-Length'),'3');
  assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())],[20,30,40]);
  const rejected=await cachedMediaResponse(request('bytes=5-'),source());assert.equal(rejected.status,416);assert.equal(rejected.headers.get('Content-Range'),'bytes */5');
  const full=source();assert.equal(await cachedMediaResponse(new Request('https://lenz.example/previews/chat-light.mp4'),full),full);
});
