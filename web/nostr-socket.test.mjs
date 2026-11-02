import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from './nostr-tools/node_modules/ws/wrapper.mjs';
import { testRelay } from './nostr-tools/test-relay.mjs';
import { openRelay } from './public/nostr-socket.js';
import { generateSecretKey, finalizeEvent } from './public/nostr-vendor/nostr.js';

const event=()=>finalizeEvent({kind:1059,created_at:Math.floor(Date.now()/1000),tags:[['p','a'.repeat(64)]],content:'opaque test'},generateSecretKey());
test('real WebSocket stores only matching OK, propagates refusal and ignores forged IDs',async()=>{
  const server=await testRelay();let relay;
  try{
    relay=await openRelay(server.origin,{allowed:async()=>true,WebSocketImpl:WebSocket,timeout:100});
    assert.equal(await relay.publish(event()),true);
    server.controls.refuse=true;await assert.rejects(relay.publish(event()),/refused/);
    server.controls.refuse=false;server.controls.wrongAck=true;await assert.rejects(relay.publish(event()),/timed out/);
  }finally{relay?.close();await server.close();}
});
test('opt-out before connection opens no socket and abort closes pending work',async()=>{
  const server=await testRelay();let relay;
  try{
    await assert.rejects(openRelay(server.origin,{allowed:async()=>false,WebSocketImpl:WebSocket}),/off/);
    assert.equal(server.connections.size,0);
    const controller=new AbortController();
    relay=await openRelay(server.origin,{allowed:async()=>true,signal:controller.signal,WebSocketImpl:WebSocket});
    server.controls.wrongAck=true;const pending=relay.publish(event());controller.abort();await assert.rejects(pending,/closed|off/);
  }finally{relay?.close();await server.close();}
});
test('cancellation during the initial consent check opens no socket',async()=>{
  const server=await testRelay();let relay,opened=0;
  const controller=new AbortController();
  class ObservedSocket extends WebSocket {constructor(...args){super(...args);opened++;}}
  try{
    await assert.rejects(openRelay(server.origin,{
      allowed:async()=>{controller.abort();return true;},
      signal:controller.signal,WebSocketImpl:ObservedSocket,
    }).then(value=>{relay=value;return value;}),/off/);
    assert.equal(opened,0);
  }finally{relay?.close();await server.close();}
});
test('oversized replies and disconnect fail bounded exchanges',async()=>{
  const server=await testRelay();let relay;
  try{
    relay=await openRelay(server.origin,{allowed:async()=>true,WebSocketImpl:WebSocket,timeout:100});
    server.controls.extra='x'.repeat(35000);
    await assert.rejects(relay.read({kinds:[1059],'#p':['a'.repeat(64)],since:0,until:9999999999,limit:128}),/Oversized/);
    relay.close();server.controls.extra=null;server.controls.drop=true;
    relay=await openRelay(server.origin,{allowed:async()=>true,WebSocketImpl:WebSocket,timeout:100});
    await assert.rejects(relay.publish(event()),/closed/);
  }finally{relay?.close();await server.close();}
});
