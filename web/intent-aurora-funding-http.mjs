import {openAuroraFundingService} from './intent-aurora-funding-live.mjs';

const operations={config:'configuration',prepare:'prepare',submit:'submit',reconcile:'reconcile',resume:'resume',cleanup:'cleanup'};
export function createAuroraFundingHttpRoute({origin='http://localhost:4173',stateDir,deployerKeyFile,operatorId,engineCodeHash,maxGrants=5,openService=openAuroraFundingService,now=Date.now}={}){
 const allowed=new URL(origin);if(allowed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(allowed.hostname))throw Error('The private test faucet requires the local Lenz origin.');
 const configured=!!(stateDir&&deployerKeyFile&&operatorId&&engineCodeHash),hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:'')));let servicePromise=null,windowStart=now(),requests={intake:0,recovery:0};
 const respond=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
 async function route(request,response){
  const path=new URL(request.url,'http://localhost').pathname;if(!path.startsWith('/api/intent-aurora-funds/'))return false;
  if(!hosts.has(request.headers.host)||request.headers.origin!=='http://'+request.headers.host||!['same-origin','none',undefined].includes(request.headers['sec-fetch-site'])){respond(response,403,{error:'Open private test funding from the local Lenz app.'});return true;}
  const operation=path.slice('/api/intent-aurora-funds/'.length);if(!Object.hasOwn(operations,operation)){respond(response,404,{error:'Unknown private funding action.'});return true;}
  if(request.method!=='POST'){respond(response,405,{error:'Use a JSON POST request.'});return true;}
  if(request.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(response,415,{error:'Use a JSON request.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests={intake:0,recovery:0};}const budget=['reconcile','resume','cleanup'].includes(operation)?'recovery':'intake';if(++requests[budget]>30){respond(response,429,{error:'Wait before checking private funding again.'});return true;}
  let body;try{const raw=await new Promise((resolve,reject)=>{const chunks=[];let size=0,done=false;request.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>16384){done=true;resolve(null);return;}chunks.push(chunk);});request.on('end',()=>{if(!done){done=true;resolve(Buffer.concat(chunks));}});request.on('error',reject);request.on('aborted',()=>reject(Error()));});if(raw===null){respond(response,413,{error:'The private funding request is too large.'});return true;}body=JSON.parse(raw.toString('utf8'));if(!body||Object.getPrototypeOf(body)!==Object.prototype)throw Error();const fields=operation==='config'?[]:operation==='prepare'?['owner','commitment']:['review','signed'];if(Object.keys(body).sort().join()!==fields.sort().join())throw Error();}catch{respond(response,400,{error:'The private funding request cannot be read.'});return true;}
  if(!configured){respond(response,503,{error:'The verified private test faucet is not configured.'});return true;}
  try{servicePromise??=openService({stateDir,deployerKeyFile,operatorId,engineCodeHash,maxGrants}).catch(error=>{servicePromise=null;throw error;});const service=await servicePromise;respond(response,200,await service[operations[operation]](body));}
  catch{respond(response,503,{error:'Private funding could not be verified. Keep the original note and check its retained request.'});}return true;
 }
 route.close=async()=>{if(servicePromise)await(await servicePromise).close();};return route;
}
