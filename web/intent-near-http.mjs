import {openNearIntentRelay} from './intent-near-relay.mjs';

const operations=Object.freeze({'config':'configuration','status':'status','prepare':'prepare','prepare-funds':'prepareFunds','add-funds':'addFunds','reconcile-funds':'reconcileFunds','submit':'submit','reconcile':'reconcile'});
export function createNearIntentHttpRoute({origin='http://localhost:4173',stateDir,deployerKeyFile,deploymentStateFile,openRelay=openNearIntentRelay,now=Date.now}={}){
 const allowed=new URL(origin),configured=Boolean(stateDir&&deployerKeyFile&&deploymentStateFile);
 if(configured&&(!['localhost','127.0.0.1'].includes(allowed.hostname)||allowed.protocol!=='http:'))throw Error('The testnet intent relay requires the local Lenz origin.');
 const hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:'')));
 let relayPromise=null,windowStart=now(),requests=0;
 const respond=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 async function route(req,res){
  const path=new URL(req.url,'http://localhost').pathname;
  if(!path.startsWith('/api/intent-near/'))return false;
  if(!hosts.has(req.headers.host)||req.headers.origin!=='http://'+req.headers.host||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])){respond(res,403,{error:'Open the testnet route from the local Lenz app.'});return true;}
  const operation=path.slice('/api/intent-near/'.length);
  if(!Object.hasOwn(operations,operation)){respond(res,404,{error:'Unknown testnet action.'});return true;}
  if(req.method!=='POST'){respond(res,405,{error:'Use a JSON POST request.'});return true;}
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(res,415,{error:'Use a JSON request.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests=0;}
  if(++requests>120){respond(res,429,{error:'Wait before checking the testnet route again.'});return true;}
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>65536){req.resume();respond(res,413,{error:'The testnet request is too large.'});return true;}
  let body;
  try{
   const raw=await new Promise((resolve,reject)=>{
    let size=0,done=false;const chunks=[];
    req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>65536){done=true;resolve(null);return;}chunks.push(chunk);});
    req.on('end',()=>{if(!done){done=true;resolve(Buffer.concat(chunks));}});
    req.on('error',reject);req.on('aborted',()=>reject(Error('Interrupted request.')));
   });
   if(raw===null){respond(res,413,{error:'The testnet request is too large.'});return true;}
   body=JSON.parse(raw.toString('utf8'));
   if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
  }catch{respond(res,400,{error:'The testnet request cannot be read.'});return true;}
  if(!configured){respond(res,503,{error:'The real NEAR testnet route is not configured.'});return true;}
  let relay;
  try{
   if(!relayPromise)relayPromise=openRelay({stateDir,deployerKeyFile,deploymentStateFile}).catch(error=>{relayPromise=null;throw error;});
   relay=await relayPromise;
  }catch{respond(res,503,{error:'The real testnet service could not open its verified configuration.'});return true;}
  try{
   const value=await relay[operations[operation]](body);
   respond(res,200,value);
  }catch(error){respond(res,503,{error:error.code||error instanceof SyntaxError||error instanceof TypeError?'The testnet service could not complete this check.':error.message??'The testnet result is unavailable. Check the original request before trying again.'});}
  return true;
 }
 route.close=async()=>{if(relayPromise)await(await relayPromise).close();};
 return route;
}
