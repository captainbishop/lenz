import {readFile,writeFile,mkdir,unlink,readdir,stat} from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildVercelPreview} from './build-vercel.mjs';

const proxyEntry=`import {createHostedProxy} from '../runtime/hosted-proxy.mjs';
import {hostedIncomingPath} from '../runtime/hosted-policy.mjs';
let route;
export default async function handler(req,res){
 const path=hostedIncomingPath(req.url);
 if(path===null){res.statusCode=404;res.end();return;}
 req.url=path;
 route??=createHostedProxy({origin:process.env.LENZ_HOSTED_ORIGIN,gatewayURL:process.env.LENZ_GATEWAY_URL,gatewaySecret:process.env.LENZ_GATEWAY_SECRET,sessionSecret:process.env.LENZ_DEMO_SESSION_SECRET,custody:JSON.parse(process.env.LENZ_HOSTED_CUSTODY??'{}')});
 await route(req,res);
}
`;

async function browserRevision(directory){
 const files=[];
 async function walk(prefix=''){for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){const name=join(prefix,entry.name);if(entry.isDirectory())await walk(name);else if(/\.(?:js|css|html|json|webmanifest)$/.test(name))files.push(name);}}
 await walk();const hash=createHash('sha256');for(const name of files.sort())hash.update(name.replaceAll('\\','/')).update('\0').update(await readFile(join(directory,name))).update('\0');return hash.digest('hex').slice(0,12);
}

async function bundleMarketsEntry(root){
 const require=createRequire(new URL('./near-connector/package.json',import.meta.url)),{build,version}=require('esbuild');
 const directory=join(root,'public'),file=join(directory,'markets.js'),source=await readFile(file,'utf8');
 if(source.includes('import.meta'))throw Error('Review module-relative assets before relocating Markets.');
 const assetURLs=[],workerNeedle="new URL('./tornado-vendor/prover-worker.js',import.meta.url)";
 const workerURLPlugin={name:'public-worker-url',setup(compiler){compiler.onLoad({filter:/\.js$/},async({path})=>{
  const contents=await readFile(path,'utf8'),name=relative(directory,path).replaceAll('\\','/');
  if(name==='tornado-prover.js'){
   if(contents.split(workerNeedle).length!==2)throw Error('Review the local prover URL before relocating its module.');
   const changed=contents.replace(workerNeedle,"new URL('/tornado-vendor/prover-worker.js',location.href)");
   if(changed.includes('import.meta'))throw Error('Review additional local prover URLs before relocating its module.');
   assetURLs.push({source:name,url:'/tornado-vendor/prover-worker.js'});
   return {contents:changed,loader:'js',resolveDir:dirname(path)};
  }
  if(contents.includes('import.meta'))throw Error('Review module-relative assets before relocating '+name+'.');
  return null;
 });}};
 const compiled=await build({absWorkingDir:directory,stdin:{contents:source,resolveDir:directory,sourcefile:'markets.js'},bundle:true,splitting:true,outdir:directory,entryNames:'markets',chunkNames:'markets-chunks/[name]-[hash]',write:false,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof',sourcemap:false,treeShaking:true,metafile:true,plugins:[workerURLPlugin]});
 const publicPath=path=>{
  const name=relative(directory,resolve(directory,path)).replaceAll('\\','/');
  if(name!=='markets.js'&&!/^markets-chunks\/[A-Za-z0-9_-]+-[A-Z0-9]{8}\.js$/.test(name))throw Error('Review the Markets browser output path before packaging.');
  return name;
 };
 const outputs=compiled.outputFiles.map(output=>({path:publicPath(output.path),bytes:output.contents.length,sha256:createHash('sha256').update(output.contents).digest('hex')})),names=new Set(outputs.map(output=>output.path));
 if(compiled.warnings.length||names.size!==outputs.length||!names.has('markets.js'))throw Error('Review the Markets browser bundle before packaging.');
 for(const [path,output]of Object.entries(compiled.metafile.outputs)){
  const record=outputs.find(record=>record.path===publicPath(path));
  record.imports=output.imports.map(imported=>{
   const name=publicPath(imported.path);
   if(imported.external||!names.has(name)||!['import-statement','dynamic-import'].includes(imported.kind))throw Error('Review the Markets browser import before packaging.');
   return {path:name,kind:imported.kind};
  });
 }
 const preloaded=new Set();
 function preload(path){for(const imported of outputs.find(output=>output.path===path).imports){if(imported.kind==='dynamic-import'||preloaded.has(imported.path))continue;preloaded.add(imported.path);preload(imported.path);}}
 preload('markets.js');
 const preloads=[...preloaded].sort().map(path=>'/'+path);
 for(const output of compiled.outputFiles){await mkdir(dirname(output.path),{recursive:true});await writeFile(output.path,output.contents,{flag:publicPath(output.path)==='markets.js'?'w':'wx'});}
 const htmlFile=join(directory,'markets.html'),html=await readFile(htmlFile,'utf8');
 if(html.split('</head>').length!==2)throw Error('Review the Markets document before adding module preloads.');
 const changedHtml=html.replace('</head>',preloads.map(path=>`<link rel="modulepreload" href="${path}">`).join('')+'</head>');await writeFile(htmlFile,changedHtml);
 const entry=outputs.find(output=>output.path==='markets.js');
 return {compiler:version,modules:Object.keys(compiled.metafile.inputs).length,bytes:entry.bytes,previousBytes:Buffer.byteLength(source),sha256:entry.sha256,totalBytes:outputs.reduce((total,output)=>total+output.bytes,0),outputs,preloads,assetURLs,html:{path:'markets.html',bytes:Buffer.byteLength(changedHtml),previousBytes:Buffer.byteLength(html),sha256:createHash('sha256').update(changedHtml).digest('hex')}};
}

function cacheMarketsChunks(source,name,paths){
 const pathsNeedle='const PATHS = [',shellNeedle='const BRAND_SHELL = [';
 if(source.split(pathsNeedle).length!==2||name==='sw.js'&&source.split(shellNeedle).length!==2)throw Error('Review the offline manifest before adding Markets chunks.');
 // A claimed page can still import immutable chunks from its previous entry.
 let changed=source.replace(pathsNeedle,`const MARKET_CHUNKS = ${JSON.stringify(paths)};\nfunction isMarketChunk(path){return /^\\/markets-chunks\\/[A-Za-z0-9_-]+-[A-Z0-9]{8}\\.js$/.test(path);}\nasync function retainedMarketChunk(request){return isMarketChunk(new URL(request.url).pathname)?caches.match(request):undefined;}\nconst PATHS = [...MARKET_CHUNKS,`);
 if(name==='sw.js'){
  const fetchNeedle='return cached ? cachedMediaResponse(event.request, cached) : fetch(event.request);';
  if(changed.split(fetchNeedle).length!==2)throw Error('Review the home offline fetch handler before retaining Markets chunks.');
  changed=changed.replace(shellNeedle,'const BRAND_SHELL = [...MARKET_CHUNKS,').replace(fetchNeedle,'return cached ? cachedMediaResponse(event.request, cached) : (await retainedMarketChunk(event.request)) ?? fetch(event.request);');
 }else{
  const matchNeedle='!PATHS.includes(url.pathname)',fetchNeedle="(await (await caches.open(CACHE)).match(event.request, { ignoreSearch: true })) ?? fetch(event.request)";
  if(changed.split(matchNeedle).length!==2||changed.split(fetchNeedle).length!==2)throw Error('Review the chat offline fetch handler before retaining Markets chunks.');
  changed=changed.replace(matchNeedle,'(!PATHS.includes(url.pathname)&&!isMarketChunk(url.pathname))').replace(fetchNeedle,"(await (await caches.open(CACHE)).match(event.request, { ignoreSearch: true })) ?? (await retainedMarketChunk(event.request)) ?? fetch(event.request)");
 }
 return changed;
}

async function publicAssetTotals(directory){
 let files=0,bytes=0;
 async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())await walk(path);else{files++;bytes+=(await stat(path)).size;}}}
 await walk(directory);return {files,bytes};
}

/** Ships public assets and a server proxy; custody files and operator code stay local. */
export async function buildHostedVercel({destination}={}){
 const result=await buildVercelPreview({destination}),root=result.destination;
 await unlink(join(root,'api','unavailable.js'));await writeFile(join(root,'api','proxy.mjs'),proxyEntry,{flag:'wx'});
 await mkdir(join(root,'runtime'));
 for(const name of ['hosted-proxy.mjs','hosted-policy.mjs','hosted-custody.mjs'])await writeFile(join(root,'runtime',name),await readFile(new URL(name,import.meta.url)),{flag:'wx'});
 await mkdir(join(root,'runtime','public'));
 for(const name of ['peer-crypto.js','profile-display.js','chat-access.js'])await writeFile(join(root,'runtime','public',name),await readFile(new URL('public/'+name,import.meta.url)),{flag:'wx'});
 const nativeFile=join(root,'public','intent-zcash-route.js'),original=await readFile(nativeFile,'utf8');
 if((original.match(/fetchImpl=fetch/g)??[]).length!==2)throw Error('The native transport source changed; review hosted integration before packaging.');
 const native="import {hostedFetch} from './hosted-native-fetch.js';\n"+original.replaceAll('fetchImpl=fetch','fetchImpl=hostedFetch');await writeFile(nativeFile,native);
 for(const name of ['money.js','markets.js','chat.js','account-ui.js']){const file=join(root,'public',name),source=await readFile(file,'utf8');await writeFile(file,"import './hosted-bootstrap.js';\n"+source);}
 const marketsBundle=await bundleMarketsEntry(root);
 const revision=await browserRevision(join(root,'public'));
 const workerTransforms=[];
 for(const name of ['sw.js','chat-sw.js']){
  const file=join(root,'public',name),original=await readFile(file,'utf8'),needle="'/intent-zcash-plan.js'";
  if((original.split(needle).length-1)!==1)throw Error('Review the native offline cache manifest before hosted packaging.');
  const chunks=marketsBundle.outputs.filter(output=>output.path!=='markets.js').map(output=>'/'+output.path);
  const changed=cacheMarketsChunks(original.replace(needle,needle+",'/hosted-native-fetch.js','/hosted-session.js','/hosted-bootstrap.js'").replace(/(const CACHE = '[^']+)';/,"$1-hosted-"+revision+"';"),name,chunks);await writeFile(file,changed);
  workerTransforms.push({path:name,bytes:Buffer.byteLength(changed),sha256:createHash('sha256').update(changed).digest('hex')});
 }
 const file=join(root,'vercel.json'),config=JSON.parse(await readFile(file,'utf8'));
 config.rewrites=[{source:'/api/:path*',destination:'/api/proxy?__lenz_path=/api/:path*'}];config.functions={'api/proxy.mjs':{maxDuration:300}};
 await writeFile(file,JSON.stringify(config,null,2)+'\n');
 const totals=await publicAssetTotals(join(root,'public'));
 return {...result,...totals,marketsBundle:{...marketsBundle,workers:workerTransforms},backend:'authenticated-loopback-gateway',nativeTransport:'durable-polled-jobs',backupRequestLimit:4_000_000,deployed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)buildHostedVercel({destination:process.argv[2]}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1;});
