import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createTornadoArtifactRoute} from './tornado-artifact-http.mjs';

async function request(route,url,method='GET'){
 let status,headers,body='';
 const handled=await route({url,method},{writeHead(code,value){status=code;headers=value;},end(value){body=value?.toString()??'';}});
 return {handled,status,headers,body};
}
test('only the three exact public artifact names can be read',async()=>{
 const route=createTornadoArtifactRoute({artifactDir:'not-opened'}),base='/api/intent-testnet/private-pool/artifacts/';
 for(const name of ['state.json','deployer.json','compiled-verifier.json','subdir/withdraw.json','withdraw.json?file=state.json','%2e%2e%2fstate.json']){
  const result=await request(route,base+name);
  if(name==='withdraw.json?file=state.json')assert.equal(result.status,503);else assert.equal(result.status,404);
  assert(!result.body.includes('not-opened'));
 }
 assert.equal((await request(route,'/api/intent-near/config')).handled,false);
});
test('missing configuration and forbidden methods never return artifact bytes',async()=>{
 const route=createTornadoArtifactRoute(),url='/api/intent-testnet/private-pool/artifacts/withdraw.json';
 assert.equal((await request(route,url)).status,503);assert.equal((await request(route,url,'POST')).status,405);
});
test('altered artifact bytes are rejected without exposing their contents or path',async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'lenz-public-artifact-'));
 try{
  await writeFile(resolve(directory,'withdraw.json'),'private-corrupt-content');
  const result=await request(createTornadoArtifactRoute({artifactDir:directory}),'/api/intent-testnet/private-pool/artifacts/withdraw.json');
  assert.equal(result.status,503);assert(!result.body.includes('private-corrupt-content'));assert(!result.body.includes(directory));assert.equal(result.headers['Cache-Control'],'no-store');
 }finally{await rm(directory,{recursive:true,force:true});}
});
