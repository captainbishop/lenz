import {writeFile,mkdir,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const origin='https://lenz-prototype.vercel.app';
const allowedPaths=new Set(['config.js','capsule.js','assets/step.wasm','assets/step.zkey','vendor/ffjavascript-LICENSE.txt','vendor/ffjavascript-worker.js','vendor/ffjavascript.js','vendor/poseidon.js','vendor/poseidon_constants_opt.js','vendor/snarkjs-LICENSE.txt','vendor/snarkjs.js']);
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const maximumBytes=64*1024*1024,maximumTimeout=120000;
const samePath=(left,right)=>(process.platform==='win32'?left.toLowerCase():left)===(process.platform==='win32'?right.toLowerCase():right);
async function checkedDirectory(folder,{create=false}={}){
 let info;
 try{info=await lstat(folder);}catch(error){if(error.code!=='ENOENT'||!create)throw error;await mkdir(folder);info=await lstat(folder);}
 if(!info.isDirectory()||info.isSymbolicLink()||!samePath(await realpath(folder),folder))throw Error('Unsafe public asset path.');
}
async function readLimitedFile(file,limit,message){
 const info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe public asset path.');
 if(info.size>limit)throw Error(message);
 const chunks=[];let size=0;
 for await(const chunk of createReadStream(file,{highWaterMark:65536})){
  size+=chunk.length;if(size>limit)throw Error(message);chunks.push(chunk);
 }
 return Buffer.concat(chunks,size);
}
async function checkedLeaf(file){
 try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe public asset path.');}catch(error){if(error.code!=='ENOENT')throw error;}
}
function validateManifest(manifest){
 if(!plain(manifest)||Object.keys(manifest).sort().join(',')!=='files,origin,schema'||manifest.schema!=='lenz/git-public-assets/v1'||manifest.origin!==origin||!plain(manifest.files))throw Error('Invalid public asset manifest.');
 const entries=Object.entries(manifest.files);
 if(!entries.length||entries.length>allowedPaths.size||entries.some(([name,digest])=>!allowedPaths.has(name)||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)))throw Error('Invalid public asset manifest.');
 return entries;
}
async function interrupted(operation,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
async function download(url,name,fetchImpl,limit,timeoutMs){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('Public asset download timed out: '+name)),timeoutMs);let response,reader;
 try{
  response=await interrupted(fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal}),controller.signal);
  if(response.redirected||response.url&&response.url!==url)throw Error('Public asset redirect rejected: '+name);
  if(response.status!==200)throw Error('Public asset download failed: '+name);
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(limit)))throw Error('Public asset too large: '+name);
  const chunks=[];let size=0;
  if(!response.body)return Buffer.alloc(0);
  reader=response.body.getReader();
  while(true){
   const part=await interrupted(reader.read(),controller.signal);if(part.done)break;
   size+=part.value.byteLength;if(size>limit)throw Error('Public asset too large: '+name);chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks,size);
 }finally{
  clearTimeout(timer);controller.abort();
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  else if(response?.body)void response.body.cancel().catch(()=>{});
 }
}

export async function preparePublicAssets({manifestPath=fileURLToPath(new URL('./git-public-assets.json',import.meta.url)),publicRoot=fileURLToPath(new URL('./public/',import.meta.url)),fetchImpl=fetch,maxAssetBytes=maximumBytes,maxTotalBytes=maximumBytes,timeoutMs=maximumTimeout}={}){
 if(!Number.isSafeInteger(maxAssetBytes)||maxAssetBytes<1||maxAssetBytes>maximumBytes||!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<1||maxTotalBytes>maximumBytes||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>maximumTimeout)throw Error('Invalid public asset download limits.');
 let manifest;
 try{manifest=JSON.parse((await readLimitedFile(manifestPath,8192,'Invalid public asset manifest.')).toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw Error('Invalid public asset manifest.');throw error;}
 const entries=validateManifest(manifest);
 await checkedDirectory(resolve(publicRoot));publicRoot=await realpath(publicRoot);
 let downloaded=0,skipped=0,bytes=0;
 for(const [name,expected]of entries){
  const file=join(publicRoot,name);let existing;
  await checkedDirectory(dirname(file),{create:true});
  try{existing=await readLimitedFile(file,maxAssetBytes,'Public asset too large: '+name);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&hash(existing)===expected){if(bytes+existing.length>maxTotalBytes)throw Error('Public asset too large: '+name);skipped++;bytes+=existing.length;continue;}
  const value=await download(manifest.origin+'/'+name,name,fetchImpl,Math.min(maxAssetBytes,maxTotalBytes-bytes),timeoutMs);
  if(hash(value)!==expected)throw Error('Pinned public asset changed: '+name);
  const temporary=join(dirname(file),'.'+name.split('/').at(-1)+'.'+randomUUID()+'.tmp');
  await checkedDirectory(dirname(file));await checkedLeaf(file);
  try{await writeFile(temporary,value,{flag:'wx'});await rename(temporary,file);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  downloaded++;bytes+=value.length;
 }
 return {checked:downloaded+skipped,downloaded,skipped,bytes};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 preparePublicAssets().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
