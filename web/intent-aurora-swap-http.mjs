import {openAuroraSwapService} from './intent-aurora-swap-live.mjs';
import {checkAuroraSwapPreparation,checkAuroraSwapPublicRequest} from './intent-aurora-swap.mjs';

const operations={config:'configuration',prepare:'prepare',submit:'submit',reconcile:'reconcile',recover:'recover'};
export function createAuroraSwapHttpRoute({origin='http://localhost:4173',stateDir,deployerKeyFile,operatorId,engineCodeHash,maxRequests=5,openService=openAuroraSwapService,now=Date.now}={}){
 const allowed=new URL(origin);if(allowed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(allowed.hostname))throw Error('The private swap sponsor requires the local Lenz origin.');
 const configured=!!(stateDir&&deployerKeyFile&&operatorId&&engineCodeHash),hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:'')));let servicePromise=null,windowStart=now(),requests={intake:0,recovery:0};
 const respond=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
 async function route(request,response){
  const path=new URL(request.url,'http://localhost').pathname;if(!path.startsWith('/api/intent-aurora-swap/'))return false;
  if(!hosts.has(request.headers.host)||request.headers.origin!=='http://'+request.headers.host||!['same-origin','none',undefined].includes(request.headers['sec-fetch-site'])){respond(response,403,{error:'Open private swap from the local Lenz app.'});return true;}
  const operation=path.slice('/api/intent-aurora-swap/'.length);if(!Object.hasOwn(operations,operation)){respond(response,404,{error:'Unknown private swap action.'});return true;}
  if(request.method!=='POST'){respond(response,405,{error:'Use a JSON POST request.'});return true;}if(request.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(response,415,{error:'Use a JSON request.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests={intake:0,recovery:0};}const budget=['reconcile','recover'].includes(operation)?'recovery':'intake';if(++requests[budget]>30){respond(response,429,{error:'Wait before checking the original private swap again.'});return true;}
  let body;try{
   const raw=await new Promise((resolve,reject)=>{const chunks=[];let size=0,done=false;request.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>16384){done=true;resolve(null);return;}chunks.push(chunk);});request.on('end',()=>{if(!done){done=true;resolve(Buffer.concat(chunks));}});request.on('error',reject);request.on('aborted',()=>reject(Error()));});
   if(raw===null){respond(response,413,{error:'The public private-swap request is too large.'});return true;}body=JSON.parse(raw.toString('utf8'));
   if(operation==='config'){if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length)throw Error();}
   else if(operation==='prepare')checkAuroraSwapPreparation(body);
   else if(operation==='recover'){if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).sort().join()!=='operation,request'||!['recover','withdrawRefund'].includes(body.operation))throw Error();checkAuroraSwapPublicRequest(body.request);}
   else checkAuroraSwapPublicRequest(body);
  }catch{respond(response,400,{error:'The original public private-swap request cannot be read.'});return true;}
  if(!configured){respond(response,503,{error:'The verified private swap sponsor is not configured.'});return true;}
  try{servicePromise??=openService({stateDir,deployerKeyFile,operatorId,engineCodeHash,maxRequests}).catch(error=>{servicePromise=null;throw error;});const service=await servicePromise;respond(response,200,await service[operations[operation]](body));}
  catch{respond(response,503,{error:'Private swap could not be verified. Keep the original proof and check its retained request.'});}return true;
 }
 route.close=async()=>{if(servicePromise)await(await servicePromise).close();};return route;
}
