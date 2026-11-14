import {readFile,writeFile,mkdir,unlink,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
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
 const compiled=await build({stdin:{contents:source,resolveDir:directory,sourcefile:'markets.js'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof',sourcemap:false,treeShaking:true,metafile:true});
 if(compiled.warnings.length||Object.values(compiled.metafile.outputs).some(output=>output.imports.length))throw Error('Review the Markets browser bundle before packaging.');
 const contents=compiled.outputFiles[0].contents;await writeFile(file,contents);
 return {compiler:version,modules:Object.keys(compiled.metafile.inputs).length,bytes:contents.length,previousBytes:Buffer.byteLength(source),sha256:createHash('sha256').update(contents).digest('hex')};
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
 for(const name of ['sw.js','chat-sw.js']){
  const file=join(root,'public',name),original=await readFile(file,'utf8'),needle="'/intent-zcash-plan.js'";
  if((original.split(needle).length-1)!==1)throw Error('Review the native offline cache manifest before hosted packaging.');
  const changed=original.replace(needle,needle+",'/hosted-native-fetch.js','/hosted-session.js','/hosted-bootstrap.js'").replace(/(const CACHE = '[^']+)';/,"$1-hosted-"+revision+"';");await writeFile(file,changed);
 }
 const file=join(root,'vercel.json'),config=JSON.parse(await readFile(file,'utf8'));
 config.rewrites=[{source:'/api/:path*',destination:'/api/proxy?__lenz_path=/api/:path*'}];config.functions={'api/proxy.mjs':{maxDuration:300}};
 await writeFile(file,JSON.stringify(config,null,2)+'\n');
 return {...result,bytes:result.bytes+marketsBundle.bytes-marketsBundle.previousBytes,marketsBundle,backend:'authenticated-loopback-gateway',nativeTransport:'durable-polled-jobs',backupRequestLimit:4_000_000,deployed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)buildHostedVercel({destination:process.argv[2]}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1;});
