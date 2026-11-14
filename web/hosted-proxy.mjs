import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {publicOrigin,hostedRoute,readHostedBody} from './hosted-policy.mjs';
import {validateProfile,verifyValue,keysAre} from './public/peer-crypto.js';
import {checkHostedCustody,hasHostedCustody,ownsHostedRequest,filterHostedReply,readHostedNativeConfig} from './hosted-custody.mjs';

const cookieName='lenz_demo_access';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const HOSTED_SESSION_REQUEST='lenz/hosted-operator-session/v1';
const sessionSignature=(secret,origin,id,expiry)=>createHmac('sha256',secret).update(origin+'\n'+id+'\n'+expiry).digest('base64url');
const challengeSignature=(secret,origin,id,until,nonce)=>createHmac('sha256',secret).update(HOSTED_SESSION_REQUEST+'\n'+origin+'\n'+id+'\n'+until+'\n'+nonce).digest('base64url');
function sessionValue(cookie,secret,origin,now,allowed){
 const value=cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1),parts=value?.split('.');
 return parts?.length===3&&/^\d{13}$/.test(parts[0])&&Number(parts[0])>now&&Number(parts[0])<=now+7_200_000&&allowed.has(parts[1])&&equal(parts[2],sessionSignature(secret,origin,parts[1],parts[0]))?{identity:parts[1],expiresAt:Number(parts[0])}:null;
}
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

export function createHostedProxy({origin,gatewayURL,gatewaySecret,sessionSecret,custody={},fetcher=fetch,now=Date.now,timeoutMs=280000}={}){
 const approved=publicOrigin(origin),gateway=new URL(gatewayURL);
 const bindings=checkHostedCustody(custody),allowed=new Set(Object.keys(bindings));
 if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.pathname!=='/'||gateway.search||gateway.hash)throw Error('Use the authenticated HTTPS gateway origin.');
 if(typeof gatewaySecret!=='string'||gatewaySecret.length<32||typeof sessionSecret!=='string'||sessionSecret.length<32||gatewaySecret===sessionSecret)throw Error('Configure separate private gateway and demo-session secrets.');
 return async(req,res)=>{
  const method=req.method,session=sessionValue(req.headers.cookie,sessionSecret,approved,now(),allowed),authorized=!!session;
  if(req.headers.host!==new URL(approved).host||(req.headers.origin&&req.headers.origin!==approved)||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))return json(res,403,{error:'Open this request from the saved Lenz site.'});
  if(!['GET','HEAD'].includes(method)&&req.headers.origin!==approved)return json(res,403,{error:'The Lenz request origin changed.'});
  if(req.url==='/api/hosted/session'||req.url==='/api/hosted/session/challenge'){
   if(method==='GET'&&req.url==='/api/hosted/session')return json(res,200,{authorized,identity:session?.identity??null,expiresAt:session?.expiresAt??null});
   if(method==='DELETE'){res.setHeader('Set-Cookie',cookieName+'=; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return json(res,200,{authorized:false});}
   if(method!=='POST'||req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,405,{error:'Use the Lenz identity request.'});
   try{
    const input=JSON.parse((await readHostedBody(req,8192)).toString('utf8'));
    if(req.url==='/api/hosted/session/challenge'){
     if(!keysAre(input,['id'])||!allowed.has(input.id))return json(res,403,{code:'DEMO_IDENTITY_REQUIRED',error:'The configured testnet wallet belongs to another Lenz account.'});
     const until=now()+60000,random=randomBytes(32).toString('hex'),nonce=random+'.'+challengeSignature(sessionSecret,approved,input.id,until,random);return json(res,200,{nonce,until});
    }
    if(!keysAre(input,['profile','nonce','until','signature']))throw Error();
    const profile=await validateProfile(input.profile),parts=input.nonce?.split('.');
    if(!allowed.has(profile.id)||!Number.isSafeInteger(input.until)||input.until<=now()||input.until>now()+60000||parts?.length!==2||!/^[a-f0-9]{64}$/.test(parts[0])||!equal(parts[1],challengeSignature(sessionSecret,approved,profile.id,input.until,parts[0]))||!await verifyValue(profile.signingPublic,[HOSTED_SESSION_REQUEST,approved,profile.id,input.nonce,input.until],input.signature))return json(res,403,{error:'The Lenz identity authorization changed.'});
    const expiry=String(now()+7_200_000),value=expiry+'.'+profile.id+'.'+sessionSignature(sessionSecret,approved,profile.id,expiry);
    res.setHeader('Set-Cookie',cookieName+'='+value+'; Path=/api/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200');return json(res,200,{authorized:true,identity:profile.id,expiresAt:Number(expiry)});
   }catch{return json(res,400,{error:'The Lenz identity request cannot be verified.'});}
  }
  const policy=hostedRoute(req.url,method);
  if(!policy)return json(res,404,{error:'Unknown hosted Lenz action.'});
  if(policy.privileged&&(!authorized||req.headers['x-lenz-hosted-identity']!==session.identity))return json(res,401,{code:'DEMO_IDENTITY_REQUIRED',error:'Open the Lenz account that owns the configured testnet wallet.'});
  if(policy.privileged&&!hasHostedCustody(bindings,session.identity,policy))return json(res,403,{code:'HOSTED_CUSTODY_SCOPE',error:'This Lenz account does not own this configured route.'});
  const requestId=req.headers['x-lenz-hosted-request-id'];
  if(policy.async&&(typeof requestId!=='string'||!/^\d{13}-[a-f0-9]{32}$/.test(requestId)))return json(res,400,{error:'Keep the persistent native request identifier.'});
  if(method==='POST'&&req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{error:'Use a JSON request.'});
  const controller=new AbortController(),aborted=()=>controller.abort();req.once('aborted',aborted);res.once('close',aborted);
  try{
   const body=await readHostedBody(req,policy.maxBytes);
   if(!ownsHostedRequest(bindings,session?.identity,policy,body))return json(res,403,{code:'HOSTED_CUSTODY_SCOPE',error:'This Lenz account does not own this requested source or beneficiary.'});
   const headers={'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':approved,'x-lenz-privileged':policy.privileged?'1':'0','accept':req.headers.accept??'application/json'};
   if(policy.privileged)headers['x-lenz-hosted-identity']=session.identity;
   if(method==='POST')headers['content-type']='application/json';
   if(policy.async)headers['x-lenz-hosted-request-id']=requestId;
   const upstream=await fetcher(new URL(policy.raw,gateway),{method,headers,body:method==='POST'?body:undefined,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});
   if(upstream.status>=300&&upstream.status<400)throw Error('Gateway redirects are not supported.');
   const type=upstream.headers.get('content-type')??'application/json';
   if(policy.path==='/api/intent-zcash/config'&&upstream.ok)return json(res,upstream.status,filterHostedReply(bindings,session.identity,policy,await readHostedNativeConfig(upstream)));
   res.writeHead(upstream.status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(policy.stream?{'X-Accel-Buffering':'no'}:{})});
   if(method==='HEAD'||!upstream.body){await upstream.body?.cancel();res.end();return;}
   const reader=upstream.body.getReader();let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(policy.artifact?24_000_000:policy.stream?32_000_000:17_000_000))throw Error('Gateway reply exceeds its limit.');if(!res.write(value))await new Promise((resolve,reject)=>{const close=()=>{cleanup();reject(Error('Client left.'));},drain=()=>{cleanup();resolve();},cleanup=()=>{res.removeListener('close',close);res.removeListener('drain',drain);};res.once('close',close);res.once('drain',drain);});}}
   finally{await reader.cancel();reader.releaseLock();}res.end();
  }catch(error){if(!res.headersSent&&!res.destroyed)json(res,error.status??502,{code:'HOSTED_REQUEST_UNCERTAIN',error:error.status?'This hosted request exceeds its size limit.':'The operator connection stopped. Check the original saved request before another attempt.'});else res.destroy();}
  finally{req.removeListener('aborted',aborted);res.removeListener('close',aborted);}
 };
}
