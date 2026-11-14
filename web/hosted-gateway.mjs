import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import {publicOrigin,hostedRoute,readHostedBody} from './hosted-policy.mjs';
import {createAccountRoute} from './account-relay.mjs';
import {AccountStore} from './account-store.mjs';
import {openHostedJobs} from './hosted-jobs.mjs';
import {checkHostedCustody,hasHostedCustody,ownsHostedRequest,filterHostedReply,readHostedNativeConfig} from './hosted-custody.mjs';
const sameSecret=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

/** Keeps configured custody on loopback; only the authenticated server proxy can enter. */
export async function createHostedGateway({origin,gatewaySecret,custody={},backendURL='http://127.0.0.1:4173',backendOrigin='http://localhost:4173',accountDir,accountRoute,aiRoute,jobsDir,fetcher=fetch}={}){
 const approved=publicOrigin(origin),backend=new URL(backendURL),local=new URL(backendOrigin);
 const bindings=checkHostedCustody(custody);
 if(typeof gatewaySecret!=='string'||gatewaySecret.length<32)throw Error('Configure a private gateway credential.');
 for(const value of [backend,local])if(value.protocol!=='http:'||!['localhost','127.0.0.1'].includes(value.hostname)||value.username||value.password||value.pathname!=='/'||value.search||value.hash)throw Error('The gateway can contact only its fixed loopback app.');
 if(backend.port!==local.port)throw Error('Use the same local backend port.');
 let accountStore;
 const accounts=accountRoute??(accountDir?createAccountRoute({origin:approved,store:accountStore=new AccountStore(accountDir)}):null);
 const dispatch=async(policy,method,body,signal,identity)=>{
  // Existing market readers use 127.0.0.1; lending binds the app's configured localhost origin.
  const targetOrigin=policy.path.startsWith('/api/intents/lending/')?local.origin:backend.origin;
  const headers={origin:targetOrigin,'sec-fetch-site':'same-origin'};
  if(identity)headers['x-lenz-hosted-identity']=identity;
  if(method==='POST')headers['content-type']='application/json';
  return fetcher(new URL(policy.raw,targetOrigin),{method,headers,body:method==='POST'?body:undefined,redirect:'error',signal});
 };
 const jobs=jobsDir?await openHostedJobs({directory:jobsDir,dispatch}):null;
 const route=async(req,res)=>{
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!sameSecret(req.headers['x-lenz-gateway-authorization'],gatewaySecret)||req.headers['x-lenz-public-origin']!==approved)return json(res,403,{error:'Gateway authorization failed.'});
  const policy=hostedRoute(req.url,req.method);
  if(!policy)return json(res,404,{error:'Unknown gateway action.'});
  if(policy.privileged&&req.headers['x-lenz-privileged']!=='1')return json(res,403,{error:'Demo custody access is required.'});
  const identity=req.headers['x-lenz-hosted-identity'];
  if(policy.privileged&&!hasHostedCustody(bindings,identity,policy))return json(res,403,{code:'HOSTED_CUSTODY_SCOPE',error:'This Lenz identity does not own this configured route.'});
  if(req.method==='POST'&&req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'Use a JSON request.'});
  try{
   if(policy.job){if(!jobs)return json(res,503,{error:'Native operation journal is not configured.'});return json(res,200,await jobs.read(policy.path.split('/').at(-1),identity));}
   if(policy.path.startsWith('/api/accounts/')||policy.path.startsWith('/api/ai/')){
    const handler=policy.path.startsWith('/api/accounts/')?accounts:aiRoute;
    if(!handler)return json(res,503,{error:'This authenticated service is not configured.'});
    const body=await readHostedBody(req,policy.maxBytes),forwarded=Object.assign(Readable.from([body]),{url:req.url,method:req.method,socket:req.socket,headers:{host:new URL(approved).host,origin:approved,'content-type':'application/json','content-length':String(body.length),'sec-fetch-site':'same-origin'}});
    if(!ownsHostedRequest(bindings,identity,policy,body))return json(res,403,{code:'HOSTED_CUSTODY_SCOPE',error:'The requested account does not match this Lenz identity.'});
    await handler(forwarded,res);return;
   }
   const body=await readHostedBody(req,policy.maxBytes);
   if(!ownsHostedRequest(bindings,identity,policy,body))return json(res,403,{code:'HOSTED_CUSTODY_SCOPE',error:'This Lenz identity does not own this requested source or beneficiary.'});
   if(policy.async){
    if(!jobs)return json(res,503,{error:'Native operation journal is not configured.'});
    const id=req.headers['x-lenz-hosted-request-id'];
    if(typeof id!=='string'||!/^\d{13}-[a-f0-9]{32}$/.test(id))return json(res,400,{error:'Keep the persistent native request identifier.'});
    return json(res,202,await jobs.start(id,policy,req.method,body,identity));
   }
   const controller=new AbortController(),close=()=>{if(!res.writableFinished)controller.abort();};res.once('close',close);
   try{
    const upstream=await dispatch(policy,req.method,body,controller.signal,policy.privileged?identity:undefined);
    if(upstream.status>=300&&upstream.status<400)throw Error('Backend redirects are not accepted.');
    if(policy.path==='/api/intent-zcash/config'&&upstream.ok)return json(res,upstream.status,filterHostedReply(bindings,identity,policy,await readHostedNativeConfig(upstream)));
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(policy.stream?{'X-Accel-Buffering':'no'}:{})});
    if(req.method==='HEAD'||!upstream.body){await upstream.body?.cancel();res.end();return;}
    const reader=upstream.body.getReader();let bytes=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>(policy.artifact?24_000_000:policy.stream?32_000_000:17_000_000))throw Error('Backend response exceeds its limit.');if(!res.write(value))await new Promise((resolve,reject)=>{const closed=()=>{cleanup();reject(Error('Proxy disconnected.'));},drain=()=>{cleanup();resolve();},cleanup=()=>{res.removeListener('close',closed);res.removeListener('drain',drain);};res.once('close',closed);res.once('drain',drain);});}}
    finally{await reader.cancel();reader.releaseLock();}res.end();
   }finally{res.removeListener('close',close);}
  }catch(error){if(!res.headersSent&&!res.destroyed)json(res,error.status??502,{code:error.status===403?'HOSTED_CUSTODY_SCOPE':'HOSTED_REQUEST_UNCERTAIN',error:error.status===403?'This native transport job belongs to another Lenz identity.':error.status?'This hosted request exceeds its size limit.':'The local operation connection stopped. Keep and reconcile its original saved request.'});else res.destroy();}
 };
 let closePromise;route.close=()=>closePromise??=(async()=>{accountStore?.close();await jobs?.close();})();return route;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.LENZ_GATEWAY_PORT??4187);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Use a valid gateway port.');
 const route=await createHostedGateway({origin:process.env.LENZ_HOSTED_ORIGIN,gatewaySecret:process.env.LENZ_GATEWAY_SECRET,custody:JSON.parse(process.env.LENZ_HOSTED_CUSTODY??'{}'),backendURL:process.env.LENZ_GATEWAY_BACKEND??'http://127.0.0.1:4173',backendOrigin:process.env.LENZ_GATEWAY_LOCAL_ORIGIN??'http://localhost:4173',accountDir:process.env.LENZ_ACCOUNT_DATA,jobsDir:process.env.LENZ_HOSTED_JOBS});
 const server=http.createServer(route).listen(port,'127.0.0.1',()=>console.log('Lenz authenticated gateway listening on loopback port '+port));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await route.close();process.exit();}));
}
