import {submitConfidentialSpend,readConfidentialSpendStatus} from '../integrations/intents-spend.mjs';
import {verifyQuoteSignature} from '../integrations/quote-verifier/index.mjs';
import {checkConfidentialSpend,checkConfidentialSignedData} from './public/intents-spend.js';
import {checkConfidentialObservation} from './public/intents-status.js';
import {base58} from './public/intents-vendor/codecs.js';

const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
async function readRequest(req,signal){
 const chunks=[];let size=0;
 await new Promise((resolve,reject)=>{
  const finish=error=>{req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',failed);signal.removeEventListener('abort',aborted);if(error){req.resume();reject(error);}else resolve();};
  const data=chunk=>{size+=chunk.length;if(size>65536)finish(Object.assign(Error('Request too large'),{status:413}));else chunks.push(chunk);},end=()=>finish(),failed=error=>finish(error),aborted=()=>finish(signal.reason);
  signal.throwIfAborted();req.on('data',data);req.once('end',end);req.once('error',failed);signal.addEventListener('abort',aborted,{once:true});
 });
 signal.throwIfAborted();try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Object.assign(Error('Invalid request'),{status:400});}
}

// The receiving browser owns the encrypted submission journal. This bridge has
// no wallet key and must never retry an approval after a lost provider response.
export function createPrivateExecutorRoute({origin,origins=['http://127.0.0.1:4173','http://localhost:4173'],apiKey,submit=submitConfidentialSpend,observe=readConfidentialSpendStatus,verifySignature=verifyQuoteSignature,now=Date.now,timeoutMs=25000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw Error('Invalid executor timeout');
 const allowed=origin?[origin]:origins,hosts=allowed.map(value=>new URL(value).host);let active=0;
 return async(req,res)=>{
  const operation={'/api/private-executor/config':'config','/api/private-executor/submit':'submit','/api/private-executor/status':'status'}[req.url];if(!operation)return false;
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}};
  const ready=typeof apiKey==='string'&&apiKey.trim().length>0;
  if(!hosts.includes(req.headers.host)||(req.headers.origin!==undefined&&!allowed.includes(req.headers.origin))){send(403,{error:'Open received requests in Lenz.'});req.resume();return true;}
  if(operation==='config'){if(req.method!=='GET'){send(405,{error:'Use an executor configuration read.'});req.resume();}else send(200,{ready});return true;}
  if(!allowed.includes(req.headers.origin)){send(403,{error:'Open received requests in Lenz.'});req.resume();return true;}
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(405,{error:'Use a saved private request.'});req.resume();return true;}
  if(!ready||active>=4){send(503,{error:'Private request execution is unavailable.'});req.resume();return true;}
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);active++;
  let dispatched=false;
  try{
   const input=await readRequest(req,signal);if(!keys(input,operation==='submit'?['offer','signedData']:['offer']))throw Object.assign(Error('Invalid request'),{status:400});
   let review;
   try{const time=now(),quoted=Date.parse(input.offer?.quote?.timestamp),reviewTime=operation==='submit'?time:Math.max(0,quoted-30000,Date.parse(input.offer?.terms?.signingDeadline)-345600000);if(!Number.isSafeInteger(reviewTime)||reviewTime>time)throw Error();review=checkConfidentialSpend(input.offer,{now:reviewTime,verifySignature});if(operation==='submit')checkConfidentialSignedData(review,input.signedData);}catch{throw Object.assign(Error('Invalid approval'),{status:400});}
   signal.throwIfAborted();dispatched=true;
   const options={apiKey,signal,verifySignature,now},result=operation==='submit'?await submit(input.offer,input.signedData,options):await observe(input.offer,options);signal.throwIfAborted();
   if(operation==='submit'){
    if(result?.state!=='submitted'||result.settlementVerified!==false||result.depositAddress!==review.depositAddress||typeof result.intentHash!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.intentHash)||base58.decode(result.intentHash).length!==32)throw Error('Invalid submission result');
    send(200,{state:'submitted',intentHash:result.intentHash,depositAddress:review.depositAddress,settlementVerified:false});
   }else send(200,checkConfidentialObservation(review,result,{now:now()}));
  }catch(error){send(!dispatched&&[400,413].includes(error.status)?error.status:503,{error:dispatched?'Outcome is unknown. Check the original saved request before any retry.':error.status===413?'Private request is too large.':'Review the saved private request.'});}
  finally{active--;req.removeListener('aborted',abort);res.removeListener('close',abort);}
  return true;
 };
}
