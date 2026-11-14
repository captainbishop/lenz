import {createAuroraIntentReader,auroraIntentReadSelection} from './intent-aurora-read.mjs';

export function createAuroraIntentHttpRoute({origin='http://localhost:4173',reader=createAuroraIntentReader(),now=Date.now}={}){
 const allowed=new URL(origin);if(allowed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(allowed.hostname))throw Error('The Aurora prototype reader requires the local Lenz origin.');
 const hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:'')));
 let windowStart=now(),requests=0;
 const respond=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
 return async function route(request,response){
  const path=new URL(request.url,'http://localhost').pathname;if(!path.startsWith('/api/intent-aurora/'))return false;
  if(!hosts.has(request.headers.host)||request.headers.origin!=='http://'+request.headers.host||!['same-origin','none',undefined].includes(request.headers['sec-fetch-site'])){respond(response,403,{error:'Open the Aurora reader from the local Lenz app.'});return true;}
  const operation=path.slice('/api/intent-aurora/'.length);if(!['config','snapshot'].includes(operation)){respond(response,404,{error:'Unknown Aurora read.'});return true;}
  if(request.method!=='POST'){respond(response,405,{error:'Use a JSON POST request.'});return true;}
  if(request.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(response,415,{error:'Use a JSON request.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests=0;}if(++requests>30){respond(response,429,{error:'Wait before checking Aurora again.'});return true;}
  let body;
  try{
   const raw=await new Promise((resolve,reject)=>{const chunks=[];let size=0,finished=false;request.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>4096){finished=true;resolve(null);return;}chunks.push(chunk);});request.on('end',()=>{if(!finished){finished=true;resolve(Buffer.concat(chunks));}});request.on('error',reject);request.on('aborted',()=>reject(Error()));});
   if(raw===null){respond(response,413,{error:'The Aurora read request is too large.'});return true;}
   body=JSON.parse(raw.toString('utf8'));auroraIntentReadSelection(body);if(operation==='config'&&Object.keys(body).length)throw Error();
  }catch{respond(response,400,{error:'The Aurora read request cannot be read.'});return true;}
  try{respond(response,200,await reader[operation==='config'?'configuration':'snapshot'](body));}
  catch{respond(response,503,{error:'The verified Aurora snapshot is unavailable. No financial request was accepted.'});}
  return true;
 };
}
