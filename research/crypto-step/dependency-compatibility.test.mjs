import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import underscore from 'underscore';
import jsonpath from 'jsonpath';
import WebSocket,{WebSocketServer} from 'ws';
import filelist from 'filelist';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';

test('filelist retains glob selection and exclusions with the patched matcher',()=>{
  const root=mkdtempSync(join(tmpdir(),'lenz-glob-'));
  try{
    mkdirSync(join(root,'nested'));
    for(const path of ['a.sol','b.txt','nested/c.sol'])writeFileSync(join(root,path),'fixture');
    const base=root.replaceAll('\\','/'),list=new filelist.FileList();
    list.include(base+'/**/*.sol');list.exclude(base+'/nested/*');
    assert.deepEqual(list.toArray().map(path=>path.replaceAll('\\','/')),[base+'/a.sol']);
  }finally{assert.equal(dirname(root),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
});

test('patched utility handles deep values and the JSONPath caller retains results',()=>{
  let a=1,b=1;for(let n=0;n<12000;n++){a=[a];b=[b];}
  assert.deepEqual(underscore.flatten(a),[1]);assert.equal(underscore.isEqual(a,b),true);
  assert.equal(underscore.isEqual(a,[2]),false);
  assert.deepEqual(jsonpath.query({rows:[{value:2},{value:7}]},'$.rows[*].value'),[2,7]);
});

test('patched WebSocket preserves typed-array slices on a real loopback connection',{timeout:5000},async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024});let client;
  try{
    server.on('connection',peer=>{peer.on('error',()=>{});peer.on('message',data=>peer.send(data));});
    await once(server,'listening');client=new WebSocket(`ws://127.0.0.1:${server.address().port}`);await once(client,'open');
    const response=once(client,'message');client.send(new DataView(Uint8Array.from([99,1,2,88]).buffer,1,2));
    const [data]=await response;assert.deepEqual(data,Buffer.from([1,2]));
  }finally{client?.terminate();for(const peer of server.clients)peer.terminate();await new Promise(resolve=>server.close(resolve));}
});

test('patched WebSocket rejects a fragmented message beyond its configured bound',{timeout:5000},async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024,maxFragments:4});let client,error,messages=0;
  try{
    server.on('connection',peer=>{peer.on('error',e=>{error=e;});peer.on('message',()=>messages++);});
    await once(server,'listening');client=new WebSocket(`ws://127.0.0.1:${server.address().port}`);await once(client,'open');
    const closed=once(client,'close');for(let n=0;n<6;n++)client.send('x',{fin:n===5});
    const [code]=await closed;assert.equal(code,1008);assert.equal(error?.code,'WS_ERR_TOO_MANY_BUFFERED_PARTS');assert.equal(messages,0);
  }finally{client?.terminate();for(const peer of server.clients)peer.terminate();await new Promise(resolve=>server.close(resolve));}
});
