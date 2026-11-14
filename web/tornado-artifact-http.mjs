import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const prefix='/api/intent-testnet/private-pool/artifacts/';
const files=Object.freeze({
 'withdraw.json':{sha256:'3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98',type:'application/json'},
 'withdraw_proving_key.bin':{sha256:'8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',type:'application/octet-stream'},
 'withdraw_verification_key.json':{sha256:'3eedcf6ec6b5c24219ed19c7a33966fbfa6a03ae7c84124270589091e87cf8d3',type:'application/json'}
});

export function createTornadoArtifactRoute({artifactDir}={}){
 const loaded=new Map();
 const error=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:message}));};
 return async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(!path.startsWith(prefix))return false;
  const name=path.slice(prefix.length),file=Object.hasOwn(files,name)?files[name]:null;
  if(!file){error(res,404,'Unknown public proving artifact.');return true;}
  if(!['GET','HEAD'].includes(req.method)){error(res,405,'Read the public proving artifact with GET.');return true;}
  if(!artifactDir){error(res,503,'The original public proving artifacts are not configured.');return true;}
  try{
   let bytes=loaded.get(name);
   if(!bytes){bytes=await readFile(resolve(artifactDir,name));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error();loaded.set(name,bytes);}
   res.writeHead(200,{'Content-Type':file.type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:bytes);
  }catch{error(res,503,'The original public proving artifact failed its integrity check.');}
  return true;
 };
}
