import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createDegenRoute} from './degen-relay.mjs';
import {candleFixture,pool,token} from '../integrations/degen-fixtures.mjs';
const request={provider:'geckoterminal',kind:'candles',network:'base',pool,address:token,interval:'5m'};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function post(route,input=request){
 const req=Readable.from([Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:'/api/degen/read',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'}});
 const res=new EventEmitter();let result;
 res.writeHead=(status,headers)=>{result={status,headers};};res.end=body=>{result.body=JSON.parse(body);};
 return {done:route(req,res),close:()=>res.emit('close'),result:()=>result};
}
test('a saved chart is returned before its slow revalidation finishes',async()=>{
 const now=Date.now(),saved={version:1,request,observedAt:now-65000,candles:candleFixture('5m',now-65000),executable:false};let release;
 const route=createDegenRoute({history:{get:()=>saved,put(){}},candles:async()=>new Promise(resolve=>{release=()=>resolve({...saved,observedAt:now});})});
 const response=post(route);await turn();
 try{assert.equal(response.result()?.status,200,'saved candles should reach the browser immediately');assert.equal(response.result().body.stale,true);assert.equal(response.result().body.observedAt,saved.observedAt);}finally{release?.();await response.done;}
});
test('leaving a queued pair cancels its read before it spends provider capacity',async()=>{
 const starts=[];let release;
 const route=createDegenRoute({candles:async(r,{signal}={})=>{starts.push(r.pool);if(r.pool===pool)return new Promise(resolve=>{release=()=>resolve({request:r,candles:[],executable:false});});return {request:r,candles:[],executable:false};}});
 const first=post(route);await turn();const left=post(route,{...request,pool:'left-pair'});await turn();left.close();
 try{assert.deepEqual(starts,[pool],'a queued pair must not start alongside the first request');}finally{release?.();await Promise.all([first.done,left.done]);}
});

test('one viewer leaving keeps a shared read alive for the remaining viewer',async()=>{
 let release,upstreamSignal,calls=0;
 const route=createDegenRoute({candles:async(r,{signal})=>{calls++;upstreamSignal=signal;return new Promise(resolve=>{release=()=>resolve({request:r,candles:[],executable:false});});}});
 const first=post(route);await turn();const second=post(route);await turn();first.close();
 try{assert.equal(upstreamSignal.aborted,false);assert.equal(calls,1);}finally{release();await Promise.all([first.done,second.done]);}
 assert.equal(first.result(),undefined);assert.equal(second.result().status,200);
});

test('leaving the last viewer aborts an active upstream read and sends no late response',async()=>{
 let upstreamSignal;
 const route=createDegenRoute({candles:async(r,{signal})=>{upstreamSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const response=post(route);await turn();response.close();await response.done;
 assert.equal(upstreamSignal.aborted,true);assert.equal(response.result(),undefined);
});
