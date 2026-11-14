import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedNativeFetch} from './public/hosted-native-fetch.js';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
const lock=operation=>Promise.resolve().then(operation);

test('native transport polls a stable job until its original visible result without repeated signing requests',async()=>{
 const storage=memory(),calls=[],job='a'.repeat(64),fetcher=async(url,options)=>{calls.push({url,options});return url.startsWith('/api/intent-zcash/')?Response.json({lenzHostedJob:job,state:'pending'},{status:202}):Response.json(calls.length===2?{lenzHostedJob:job,state:'pending'}:{lenzHostedJob:job,state:'complete',status:200,body:{artifactId:'original'}});};
 const request=createHostedNativeFetch({hosted:true,storage,fetcher,lock,pollMs:1});
 const result=await request('/api/intent-zcash/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"review":{"id":"original"}}'});
 assert.deepEqual(await result.json(),{artifactId:'original'});assert.equal(calls.filter(row=>row.url.includes('/authorize')).length,1);assert.equal(calls[0].options.body,'{"review":{"id":"original"}}');assert.equal(calls[1].options.credentials,'same-origin');assert.equal(Object.keys(JSON.parse([...storage.values.values()][0])).length,1);
});

test('an interrupted response retains its persistent identifier for browser restart and uncertainty does not clear it',async()=>{
 const storage=memory(),ids=[],fetcher=async(url,options)=>{ids.push(options.headers.get('x-lenz-hosted-request-id'));throw Error('Connection interrupted');};
 const body={method:'POST',body:'{"review":{"id":"original"}}'};
 await assert.rejects(createHostedNativeFetch({hosted:true,storage,fetcher,lock})('/api/intent-zcash/authorize',body),/interrupted/);
 await assert.rejects(createHostedNativeFetch({hosted:true,storage,fetcher,lock})('/api/intent-zcash/authorize',body),/interrupted/);assert.equal(ids[0],ids[1]);
 const uncertain=createHostedNativeFetch({hosted:true,storage,lock,fetcher:async()=>Response.json({lenzHostedJob:'b'.repeat(64),state:'unknown',error:'Keep original'},{status:202})});
 assert.equal((await uncertain('/api/intent-zcash/authorize',body)).status,502);assert.equal(Object.keys(JSON.parse([...storage.values.values()][0])).length,1);
});

test('transport storage failure discloses no request and ordinary local API behavior stays unchanged',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({local:true});};
 const broken=createHostedNativeFetch({hosted:true,fetcher,lock,storage:{getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');}}});
 await assert.rejects(broken('/api/intent-zcash/submit',{method:'POST',body:'{}'}),/Storage unavailable/);assert.equal(calls,0);
 const local=createHostedNativeFetch({hosted:false,fetcher,storage:undefined});assert.deepEqual(await(await local('/api/intent-zcash/submit',{method:'POST',body:'{}'})).json(),{local:true});assert.equal(calls,1);
});

test('only successful explicit reconciliation retires its transport ID; authority and failed checks retain theirs',async()=>{
 const storage=memory(),ids=[],fetcher=async(url,options)=>{ids.push(options.headers.get('x-lenz-hosted-request-id'));return Response.json({lenzHostedJob:'c'.repeat(64),state:'complete',status:200,body:{status:'pending'}},{status:202});};
 const request=()=>createHostedNativeFetch({hosted:true,storage,fetcher,lock,pollMs:1});
 const options={method:'POST',body:'{"review":{"id":"original"}}'};
 await request()('/api/intent-zcash/reconcile',options);await request()('/api/intent-zcash/reconcile',options);assert.notEqual(ids[0],ids[1]);
 await request()('/api/intent-zcash/submit',options);await request()('/api/intent-zcash/submit',options);assert.equal(ids[2],ids[3]);
 const failedIds=[],failed=()=>createHostedNativeFetch({hosted:true,storage,lock,fetcher:async(url,options)=>{failedIds.push(options.headers.get('x-lenz-hosted-request-id'));return Response.json({lenzHostedJob:'d'.repeat(64),state:'complete',status:503,body:{error:'Original check interrupted'}},{status:202});}});
 await failed()('/api/intent-zcash/reconcile',options);await failed()('/api/intent-zcash/reconcile',options);assert.equal(failedIds[0],failedIds[1]);
});
