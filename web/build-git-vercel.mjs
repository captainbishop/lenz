import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildHostedVercel} from './build-hosted-vercel.mjs';

const manifest=JSON.parse(await readFile(new URL('./git-public-assets.json',import.meta.url),'utf8'));
for(const [name,expected]of Object.entries(manifest.files)){
 if(!/^(?:assets|vendor)\/[a-zA-Z0-9_.-]+$/.test(name)&&!['config.js','capsule.js'].includes(name))throw Error('Invalid pinned public asset path.');
 const file=new URL('./public/'+name,import.meta.url);
 let bytes;
 try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==expected){
  const response=await fetch(manifest.origin+'/'+name,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('Public asset download failed: '+name);
  bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned public asset changed: '+name);
  await mkdir(new URL('./public/'+name.split('/').slice(0,-1).join('/')+'/',import.meta.url),{recursive:true});
  await writeFile(file,bytes);
 }
}
const destination=fileURLToPath(new URL('../.vercel-package/',import.meta.url));
try{await stat(destination);throw Error('Git build output already exists. Use a fresh checkout.');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log(JSON.stringify(await buildHostedVercel({destination})));
