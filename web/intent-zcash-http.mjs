import {openZcashIntentRelay} from './intent-zcash-relay.mjs';
const operations=Object.freeze({config:'configuration',status:'status',prepare:'prepare',authorize:'authorize',submit:'submit',reconcile:'reconcile','recover-authorization':'recoverAuthorization'});
export function createZcashIntentHttpRoute({origin='http://localhost:4173',stateDir,backendConfigFile,openRelay=openZcashIntentRelay,now=Date.now}={}){
 const allowed=new URL(origin),configured=Boolean(stateDir&&backendConfigFile);if(configured&&(allowed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(allowed.hostname)||allowed.username||allowed.password))throw Error('Native testnet signing requires the local Lenz origin.');
 const hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:'')));
 let relayPromise=null,windowStart=now(),requests=0;
 const respond=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 async function route(req,res){
  const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/api/intent-zcash/'))return false;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!hosts.has(req.headers.host)||req.headers.origin!=='http://'+req.headers.host||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])){respond(res,403,{error:'Open native testnet signing from the local Lenz app.'});return true;}
  const operation=path.slice('/api/intent-zcash/'.length);if(!Object.hasOwn(operations,operation)){respond(res,404,{error:'Unknown native action.'});return true;}
  if(req.method!=='POST'){respond(res,405,{error:'Use a JSON POST request.'});return true;}
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(res,415,{error:'Use a JSON request.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests=0;}if(++requests>120){respond(res,429,{error:'Wait before checking the native route again.'});return true;}
  if(Number(req.headers['content-length'])>65536){req.resume();respond(res,413,{error:'The native request is too large.'});return true;}
  let body;try{const bytes=await new Promise((resolve,reject)=>{let size=0,done=false;const chunks=[],timer=setTimeout(()=>{if(!done){done=true;reject(Error());}},10000);timer.unref();const finish=value=>{if(!done){done=true;clearTimeout(timer);resolve(value);}};req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>65536)finish(null);else chunks.push(chunk);});req.on('end',()=>finish(Buffer.concat(chunks)));req.on('error',error=>{clearTimeout(timer);reject(error);});req.on('aborted',()=>{clearTimeout(timer);reject(Error());});});if(bytes===null){respond(res,413,{error:'The native request is too large.'});return true;}body=JSON.parse(bytes.toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{respond(res,400,{error:'The native request cannot be read.'});return true;}
  if(!configured){respond(res,503,{error:'The local native Zcash signer is not configured. Browser-only Zcash signing is unavailable.'});return true;}
  let relay;try{relayPromise??=openRelay({stateDir,backendConfigFile}).catch(error=>{relayPromise=null;throw error;});relay=await relayPromise;}catch{respond(res,503,{error:'The native testnet backend could not open its verified private configuration.'});return true;}
  const controller=new AbortController(),aborted=()=>controller.abort();req.once('aborted',aborted);res.once('close',()=>{if(!res.writableFinished)aborted();});
  try{const result=await relay[operations[operation]](body,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(1800000)])});respond(res,200,result);}catch{if(!res.destroyed)respond(res,503,{error:'The native action stopped. Open and check the original saved request before another attempt.'});}finally{req.removeListener('aborted',aborted);}return true;
 }
 route.close=async()=>{if(relayPromise)await(await relayPromise).close();};return route;
}
