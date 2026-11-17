import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePublicAssets} from './prepare-public-assets.mjs';

const abcHash='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
async function fixture(files={'vendor/snarkjs.js':abcHash}){
 const root=await mkdtemp(join(tmpdir(),'lenz-public-assets-')),publicRoot=join(root,'public'),manifestPath=join(root,'manifest.json');
 await mkdir(publicRoot);
 await writeFile(manifestPath,JSON.stringify({schema:'lenz/git-public-assets/v1',origin:'https://lenz-prototype.vercel.app',files}));
 return {root,publicRoot,manifestPath};
}

test('a clean checkout receives the exact manifest-pinned public bytes',async()=>{
 const options=await fixture();
 const result=await preparePublicAssets({...options,fetchImpl:async(url,request)=>{
  assert.equal(url,'https://lenz-prototype.vercel.app/vendor/snarkjs.js');
  assert.equal(request.redirect,'error');
  assert.equal(request.credentials,'omit');
  return new Response('abc');
 }});
 assert.equal(await readFile(join(options.publicRoot,'vendor/snarkjs.js'),'utf8'),'abc');
 assert.equal(result.downloaded,1);
});

test('already verified assets work without contacting the prototype',async()=>{
 const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));await writeFile(join(options.publicRoot,'vendor/snarkjs.js'),'abc');
 const result=await preparePublicAssets({...options,fetchImpl:async()=>{throw Error('Unexpected network request');}});
 assert.equal(await readFile(join(options.publicRoot,'vendor/snarkjs.js'),'utf8'),'abc');
 assert.equal(result.skipped,1);
});

test('unapproved origins, paths and manifest fields reject before any download or write',async t=>{
 const valid={schema:'lenz/git-public-assets/v1',origin:'https://lenz-prototype.vercel.app',files:{'vendor/snarkjs.js':abcHash}};
 const variants=[
  {...valid,origin:'http://lenz-prototype.vercel.app'},
  {...valid,origin:'https://lenz-prototype.vercel.app.evil.example'},
  {...valid,origin:'https://user:password@lenz-prototype.vercel.app'},
  {...valid,origin:'https://lenz-prototype.vercel.app/'},
  {...valid,schema:'other'},
  {...valid,extra:true},
  {...valid,files:{}},
  {...valid,files:{'vendor/snarkjs.js':abcHash,'../unapproved.js':abcHash}},
  {...valid,files:{'assets/..':abcHash}},
  {...valid,files:{'assets/step.wasm?token=private':abcHash}},
  {...valid,files:{'vendor/.env':abcHash}},
  {...valid,files:{'config.js':'invalid-digest'}},
 ];
 for(const [index,manifest]of variants.entries())await t.test('invalid manifest '+index,async()=>{
  const options=await fixture();await writeFile(options.manifestPath,JSON.stringify(manifest));let requests=0;
  await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>{requests++;return new Response('abc');}}),/Invalid public asset manifest/);
  assert.equal(requests,0);
  await assert.rejects(access(join(options.publicRoot,'vendor/snarkjs.js')),/ENOENT/);
 });
});

test('failed integrity checks preserve the previous asset',async()=>{
 const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));const file=join(options.publicRoot,'vendor/snarkjs.js');await writeFile(file,'previous');
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>new Response('changed')}),/Pinned public asset changed/);
 assert.equal(await readFile(file,'utf8'),'previous');
});

test('declared and streamed oversized downloads preserve the previous asset',async t=>{
 for(const [label,response]of [
  ['declared',new Response('abc',{headers:{'content-length':'5'}})],
  ['streamed',new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('abc'));controller.enqueue(new TextEncoder().encode('de'));controller.close();}}))],
 ])await t.test(label,async()=>{
  const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));const file=join(options.publicRoot,'vendor/snarkjs.js');await writeFile(file,'old');
  await assert.rejects(preparePublicAssets({...options,maxAssetBytes:4,fetchImpl:async()=>response}),/Public asset too large/);
  assert.equal(await readFile(file,'utf8'),'old');
 });
});

test('a redirected response cannot replace local public bytes',async()=>{
 const options=await fixture(),response=new Response('abc');Object.defineProperty(response,'redirected',{value:true});
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>response}),/Public asset redirect rejected/);
 await assert.rejects(access(join(options.publicRoot,'vendor/snarkjs.js')),/ENOENT/);
});

test('the download deadline also covers a stalled response body',async()=>{
 const options=await fixture();
 await assert.rejects(preparePublicAssets({...options,timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),/Public asset download timed out/);
 await assert.rejects(access(join(options.publicRoot,'vendor/snarkjs.js')),/ENOENT/);
});

test('the total size limit includes all prepared assets',async()=>{
 const options=await fixture({'config.js':abcHash,'capsule.js':abcHash});
 await assert.rejects(preparePublicAssets({...options,maxTotalBytes:4,fetchImpl:async()=>new Response('abc')}),/Public asset too large/);
 assert.equal(await readFile(join(options.publicRoot,'config.js'),'utf8'),'abc');
 await assert.rejects(access(join(options.publicRoot,'capsule.js')),/ENOENT/);
});

test('an oversized existing file is rejected without reading or replacing it',async()=>{
 const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));const file=join(options.publicRoot,'vendor/snarkjs.js');await writeFile(file,'12345');
 await assert.rejects(preparePublicAssets({...options,maxAssetBytes:4,fetchImpl:async()=>new Response('abc')}),/Public asset too large/);
 assert.equal(await readFile(file,'utf8'),'12345');
});

test('valid existing assets still consume the total size budget',async()=>{
 const options=await fixture({'config.js':abcHash,'capsule.js':abcHash});await writeFile(join(options.publicRoot,'config.js'),'abc');
 await assert.rejects(preparePublicAssets({...options,maxTotalBytes:4,fetchImpl:async()=>new Response('abc')}),/Public asset too large/);
 assert.equal(await readFile(join(options.publicRoot,'config.js'),'utf8'),'abc');
 await assert.rejects(access(join(options.publicRoot,'capsule.js')),/ENOENT/);
});

test('a linked directory cannot make a valid outside file satisfy setup',async()=>{
 const options=await fixture(),outside=join(options.root,'outside');await mkdir(outside);await writeFile(join(outside,'snarkjs.js'),'abc');await symlink(outside,join(options.publicRoot,'vendor'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>{throw Error('Unexpected network request');}}),/Unsafe public asset path/);
 assert.equal(await readFile(join(outside,'snarkjs.js'),'utf8'),'abc');
});

test('a linked asset is rejected before the valid-file skip',async t=>{
 const options=await fixture(),outside=join(options.root,'outside.js');await writeFile(outside,'abc');await mkdir(join(options.publicRoot,'vendor'));
 try{await symlink(outside,join(options.publicRoot,'vendor/snarkjs.js'),'file');}catch(error){if(error.code==='EPERM'){t.skip('File symlink creation is unavailable on this host.');return;}throw error;}
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>{throw Error('Unexpected network request');}}),/Unsafe public asset path/);
 assert.equal(await readFile(outside,'utf8'),'abc');
});

test('oversized manifest input fails before contacting the prototype',async()=>{
 const options=await fixture();await writeFile(options.manifestPath,(await readFile(options.manifestPath,'utf8'))+' '.repeat(9000));
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>{throw Error('Unexpected network request');}}),/Invalid public asset manifest/);
 await assert.rejects(access(join(options.publicRoot,'vendor/snarkjs.js')),/ENOENT/);
});

test('verified replacement leaves only the intended public asset',async()=>{
 const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));await writeFile(join(options.publicRoot,'vendor/snarkjs.js'),'old');
 await preparePublicAssets({...options,fetchImpl:async()=>new Response('abc')});
 assert.equal(await readFile(join(options.publicRoot,'vendor/snarkjs.js'),'utf8'),'abc');
 assert.deepEqual(await readdir(join(options.publicRoot,'vendor')),['snarkjs.js']);
});

test('HTTP errors preserve the previous file without exposing their body',async()=>{
 const options=await fixture();await mkdir(join(options.publicRoot,'vendor'));const file=join(options.publicRoot,'vendor/snarkjs.js');await writeFile(file,'old');
 await assert.rejects(preparePublicAssets({...options,fetchImpl:async()=>new Response('private-error-details',{status:503})}),error=>error.message==='Public asset download failed: vendor/snarkjs.js');
 assert.equal(await readFile(file,'utf8'),'old');assert.deepEqual(await readdir(join(options.publicRoot,'vendor')),['snarkjs.js']);
});

test('the deadline covers a request that never supplies headers',async()=>{
 const options=await fixture();await assert.rejects(preparePublicAssets({...options,timeoutMs:20,fetchImpl:async()=>new Promise(()=>{})}),/Public asset download timed out/);
 await assert.rejects(access(join(options.publicRoot,'vendor/snarkjs.js')),/ENOENT/);
});

test('limits can be lowered but cannot disable the production bounds',async t=>{
 for(const limits of [{timeoutMs:0},{timeoutMs:120001},{maxAssetBytes:67108865},{maxTotalBytes:67108865}])await t.test(JSON.stringify(limits),async()=>{
  const options=await fixture();await assert.rejects(preparePublicAssets({...options,...limits,fetchImpl:async()=>{throw Error('Unexpected network request');}}),/Invalid public asset download limits/);
 });
});
