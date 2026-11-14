import {lstat,readdir,readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {securityHeaders} from './security-policy.mjs';
import {carrierConfig} from './public/carrier-protocol.js';
import {nostrConfig} from './public/nostr-protocol.js';

const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
const extensions=new Set(['.html','.js','.css','.json','.webmanifest','.svg','.png','.webp','.jpg','.mp4','.wasm','.zkey','.txt','.md']);
const required=['index.html','account.html','chat.html','money.html','sw.js','chat-sw.js','carrier-config.json','nostr-config.json'];
const unavailable=`module.exports = function unavailable(req, res) {
  const body = JSON.stringify({code:'BACKEND_UNAVAILABLE',error:'This preview backend is not configured. No backup or financial request was accepted.'});
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.statusCode = 503;
  res.end(req.method === 'HEAD' ? undefined : body);
};
`;

async function inventory(root,relative=''){
 const files=[];
 for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
  const name=relative?relative+'/'+entry.name:entry.name;
  if(entry.name.startsWith('.')||entry.isSymbolicLink())throw Error('Private or linked path in public assets: '+name);
  if(entry.isDirectory()){files.push(...await inventory(root,name));continue;}
  if(!entry.isFile()||!extensions.has(extname(name).toLowerCase()))throw Error('Unsupported public asset: '+name);
  files.push(name);
 }
 return files.sort();
}

/** Creates an isolated frontend preview package. It does not deploy or copy local APIs. */
export async function buildVercelPreview({source=publicRoot,destination}={}){
 if(!destination)throw Error('Choose a new output directory for the Vercel preview.');
 const root=await realpath(source),requested=resolve(destination),parent=await realpath(dirname(requested)),target=join(parent,basename(requested));
 const compare=value=>process.platform==='win32'?value.toLowerCase():value;
 if(compare(target)===compare(root)||compare(target).startsWith(compare(root+sep)))throw Error('The preview output must be outside the public asset directory.');
 try{await lstat(target);throw Error('The preview output already exists. Choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const files=await inventory(root);
 for(const file of required)if(!files.includes(file))throw Error('Required offline entry file is missing: '+file);
 const carriers=carrierConfig(JSON.parse(await readFile(join(root,'carrier-config.json'),'utf8')));
 const relays=nostrConfig(JSON.parse(await readFile(join(root,'nostr-config.json'),'utf8')));
 if(carriers.some(value=>!value.startsWith('https:'))||relays.some(value=>!value.startsWith('wss:')))throw Error('Hosted previews cannot use loopback delivery services.');
 const headerList=values=>Object.entries(values).map(([key,value])=>({key,value}));
 const headers=[{source:'/(.*)',headers:headerList({...securityHeaders('/',carriers,relays),'Cache-Control':'public, max-age=0, must-revalidate'})}];
 for(const file of files.filter(file=>file.endsWith('.html'))){
  headers.push({source:'/'+file,headers:headerList(securityHeaders('/'+file,carriers,relays))});
 }
 for(const source of ['/sw.js','/chat-sw.js'])headers.push({source,headers:headerList({'Cache-Control':'public, max-age=0, must-revalidate','Service-Worker-Allowed':'/'})});
 headers.push({source:'/carrier-config.json',headers:headerList({'Cache-Control':'no-store'})});
 const config={$schema:'https://openapi.vercel.sh/vercel.json',framework:null,buildCommand:null,installCommand:null,outputDirectory:'public',cleanUrls:false,headers,rewrites:[{source:'/api/:path*',destination:'/api/unavailable'}]};
 await mkdir(target);
 const staticRoot=join(target,'public');let bytes=0;
 for(const file of files){
  // Copy only the inventoried public tree; environment files and local API storage stay outside it.
  if(!(await lstat(join(root,file))).isFile())throw Error('Public asset changed while packaging: '+file);
  const contents=await readFile(join(root,file));bytes+=contents.length;
  await mkdir(dirname(join(staticRoot,file)),{recursive:true});await writeFile(join(staticRoot,file),contents,{flag:'wx'});
 }
 await mkdir(join(target,'api'));
 await writeFile(join(target,'api/unavailable.js'),unavailable,{flag:'wx'});
 await writeFile(join(target,'vercel.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
 return {destination:target,files:files.length,bytes,backend:'unavailable',deployed:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 buildVercelPreview({destination:process.argv[2]}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
