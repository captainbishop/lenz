import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {buildVercelPreview} from './build-vercel.mjs';

test('Vercel package keeps public app files, browser security and API failure separate from local state',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-vercel-test-')),source=join(folder,'source'),destination=join(folder,'package');
 try{
  await mkdir(source);
  for(const file of ['index.html','account.html','chat.html','money.html','sw.js','chat-sw.js'])await writeFile(join(source,file),file.endsWith('.html')?'<!doctype html><title>Lenz</title>':'// public app');
  await writeFile(join(source,'carrier-config.json'),JSON.stringify({version:1,carriers:[]}));
  await writeFile(join(source,'nostr-config.json'),JSON.stringify({version:1,relays:[]}));
  await writeFile(join(folder,'.env'),'PRIVATE_TEST_MARKER');
  const result=await buildVercelPreview({source,destination});
  assert.equal(result.files,8);
  const config=JSON.parse(await readFile(join(destination,'vercel.json'),'utf8'));
  assert.equal(config.outputDirectory,'public');
  assert(config.headers.some(r=>r.source==='/(.*)'&&r.headers.some(h=>h.key==='X-Content-Type-Options'&&h.value==='nosniff')));
  for(const pathname of ['/account.html','/money.html','/chat.html']){
   const route=config.headers.find(r=>r.source===pathname);
   const csp=route.headers.find(h=>h.key==='Content-Security-Policy').value;
   assert.match(csp,/script-src 'self'/);
   assert.match(csp,/frame-ancestors 'none'/);
  }
  assert.deepEqual(config.rewrites,[{source:'/api/:path*',destination:'/api/unavailable'}]);
  assert.match(await readFile(join(destination,'api/unavailable.js'),'utf8'),/not configured/);
  for(const worker of ['/sw.js','/chat-sw.js'])assert(config.headers.some(r=>r.source===worker&&r.headers.some(h=>h.key==='Cache-Control'&&h.value.includes('must-revalidate'))));
  assert(config.headers.some(r=>r.source==='/carrier-config.json'&&r.headers.some(h=>h.key==='Cache-Control'&&h.value==='no-store')));
  assert.equal(await readFile(join(destination,'public/chat.html'),'utf8'),'<!doctype html><title>Lenz</title>');
  await assert.rejects(access(join(destination,'public/.env')));
  const handler=createRequire(import.meta.url)(join(destination,'api/unavailable.js'));
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   for(const method of ['GET','POST','HEAD']){
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/accounts/write',{method});
    assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
    if(method==='HEAD')assert.equal(await response.text(),'');else assert.equal((await response.json()).code,'BACKEND_UNAVAILABLE');
   }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(buildVercelPreview({source,destination}),/already exists/);
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
});

test('destination junctions and Windows case variants cannot write a package into public assets',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-vercel-output-')),source=join(folder,'public'),alias=join(folder,'alias');
 try{
  await mkdir(source);await symlink(source,alias,'junction');
  await assert.rejects(buildVercelPreview({source,destination:join(alias,'package')}),/outside the public/);
  if(process.platform==='win32')await assert.rejects(buildVercelPreview({source,destination:join(source.toUpperCase(),'package')}),/outside the public/);
  await assert.rejects(access(join(source,'package')));
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
});

test('missing assets and private or linked public entries fail before output is created',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-vercel-reject-')),source=join(folder,'public'),destination=join(folder,'package');
 try{
  await mkdir(source);
  await assert.rejects(buildVercelPreview({source,destination}),/missing/);await assert.rejects(access(destination));
  await writeFile(join(source,'.env'),'PRIVATE_TEST_MARKER');
  await assert.rejects(buildVercelPreview({source,destination}),/Private or linked/);await assert.rejects(access(destination));
  await rm(join(source,'.env'));
  await mkdir(join(folder,'outside'));await writeFile(join(folder,'outside','exposed.json'),'PRIVATE_TEST_MARKER');
  await symlink(join(folder,'outside'),join(source,'linked'),'junction');
  await assert.rejects(buildVercelPreview({source,destination}),/Private or linked/);await assert.rejects(access(destination));
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
});
