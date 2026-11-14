import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

test('ordinary app serves an isolated loopback origin and rejects unavailable financial actions',async()=>{
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const origin='http://127.0.0.1:'+port,storage=await mkdtemp(join(tmpdir(),'lenz-server-integration-'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LENZ_')&&!key.startsWith('NEARAI_')));
 Object.assign(env,{LENZ_PORT:String(port),LENZ_ACCOUNT_ORIGIN:origin,LENZ_ACCOUNT_DATA:join(storage,'accounts')});
 const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('./',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
 const stopped=new Promise(resolve=>child.once('exit',resolve));
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('The isolated ordinary app did not start. '+output)),30000);
   const inspect=()=>{if(output.includes(origin)){clearTimeout(timer);resolve();}};
   child.stdout.on('data',inspect);child.once('exit',()=>{clearTimeout(timer);reject(Error('The isolated ordinary app stopped before serving its configured origin. '+output));});inspect();
  });
  const wallet=await fetch(origin+'/money.html',{signal:AbortSignal.timeout(20000)});assert.equal(wallet.status,200);assert.match(await wallet.text(),/money\.js/);assert.equal(wallet.headers.get('x-content-type-options'),'nosniff');
  const request=async(path,body={},headers={})=>fetch(origin+path,{method:'POST',signal:AbortSignal.timeout(20000),headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  for(const path of ['/api/intent-aurora-swap/config','/api/intent-aurora-funds/config','/api/intents/lending/config','/api/intent-zcash/config']){
   const response=await request(path);assert.notEqual(response.status,404,path+' is mounted');assert.equal(response.headers.get('cache-control'),'no-store');
   const result=await response.json();assert.equal(result.available===true,false,'Unconfigured services cannot advertise financial availability');assert.equal(/keyFile|stateDir|C:\\Users/.test(JSON.stringify(result)),false);
   assert.equal((await request(path,{}, {Origin:'https://untrusted.example'})).status,403);
  }
  assert.equal((await request('/api/intent-aurora-swap/submit',{secret:'rejected'})).status,400);
   const rejectedHost=await new Promise((resolve,reject)=>{const request=http.get(origin+'/money.html',{headers:{Host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
   assert.equal(rejectedHost,403);
 }finally{
  child.kill('SIGTERM');await stopped;assert.equal(dirname(storage),resolve(tmpdir()));await rm(storage,{recursive:true,force:true});
 }
});
