import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EngineJournal} from './engine-journal.mjs';
import {fixture,operation} from './engine-submission-fixtures.mjs';
test('actual HTTP redirect, streamed overflow and interrupted bodies cannot confirm or replace a submission',async()=>{
  let mode='redirect',followed=0,sends=0;
  const server=createServer(async(req,res)=>{
    if(req.url==='/destination'){followed++;res.end('{}');return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);
    if(body.method==='status'){res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{chain_id:'testnet'}}));return;}
    assert.equal(body.method,'send_tx');sends++;
    if(mode==='redirect'){res.writeHead(302,{location:'/destination'});res.end();return;}
    if(mode==='overflow'){res.writeHead(200);res.end(' '.repeat(256*1024+1));return;}
    if(mode==='stall'){res.writeHead(200);res.write('{');return;}
    if(mode==='identity'){res.end(JSON.stringify({jsonrpc:'2.0',id:2,result:{final_execution_status:'NONE'}}));return;}
    if(mode==='expired'){res.end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'InvalidTxError',data:{Expired:{}}}}));return;}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const local='http://127.0.0.1:'+server.address().port;
    for(const [kind,state]of [['redirect','unavailable'],['overflow','unverified'],['stall','unavailable'],['identity','unverified'],['expired','unavailable']]){
      mode=kind;const directory=mkdtempSync(join(tmpdir(),'lenz-engine-rpc-')),j=new EngineJournal(directory),f=fixture();
      try{
        j.record(operation,f.reference,f.signedTxBase64);
        const result=await j.send(operation,{timeoutMs:250,fetchImpl:(_url,options)=>fetch(local,options)});
        assert.equal(result.outcome.state,state,kind);assert.equal(result.attempts,1);assert.equal(result.txHash,f.reference.txHash);
      }finally{j.close();rmSync(directory,{recursive:true,force:true});}
    }
    assert.equal(followed,0);assert.equal(sends,5);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
