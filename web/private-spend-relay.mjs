import {prepareConfidentialSpend,prepareConfidentialFunding,readConfidentialFundingStatus} from '../integrations/intents-spend.mjs';
import {verifyQuoteSignature} from '../integrations/quote-verifier/index.mjs';
import {checkConfidentialSpendTerms} from './public/intents-spend.js';
import {fundingRequest,checkHistoricalFunding,checkFundingObservation} from './public/private-funding.js';

function readTerms(req,signal,maxBytes=4096){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;
  const cleanup=()=>{req.removeListener('data',data);req.removeListener('end',end);signal.removeEventListener('abort',abort);};
  const fail=error=>{cleanup();req.resume();reject(error);};
  const abort=()=>fail(signal.reason);
  const data=chunk=>{size+=chunk.length;if(size>maxBytes)fail(Object.assign(Error('Request too large'),{status:413}));else chunks.push(chunk);};
  const end=()=>{cleanup();try{resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}catch{reject(Object.assign(Error('Invalid request'),{status:400}));}};
  req.on('data',data);req.on('end',end);signal.addEventListener('abort',abort,{once:true});
 });
}
// Preparation and original-deposit reads accept no wallet spending authority.
export function createPrivateSpendRoute({origin,origins=['http://127.0.0.1:4173','http://localhost:4173'],apiKey,prepare=prepareConfidentialSpend,prepareFunding=prepareConfidentialFunding,observeFunding=readConfidentialFundingStatus,verifySignature=verifyQuoteSignature,now=Date.now}={}){
 const allowed=origin?[origin]:origins;
 let active=0;
 return async(req,res)=>{
  const funding=req.url==='/api/private-spend/fund-prepare',checking=req.url==='/api/private-spend/fund-status',swapping=req.url==='/api/private-spend/swap-prepare';
  if(!funding&&!checking&&!swapping&&req.url!=='/api/private-spend/prepare')return false;
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}};
  if(!allowed.includes(req.headers.origin)||req.headers.host!==new URL(req.headers.origin).host){send(403,{error:'Open private approvals in Lenz.'});req.resume();return true;}
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(405,{error:'Use a private preparation request.'});req.resume();return true;}
  if(typeof apiKey!=='string'||!apiKey.trim()||active>=4){send(503,{error:'Private preparation is unavailable. Try again later.'});req.resume();return true;}
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),abort=()=>controller.abort();
  req.once('aborted',abort);res.once('close',abort);active++;
  try{
   const input=await readTerms(req,signal,checking?70000:4096);
   let terms;
   try{if(checking){if(!input||Object.keys(input).join(',')!=='offer')throw Error();checkHistoricalFunding(input.offer,{now:now(),verifySignature});terms=input.offer;}else if(funding){fundingRequest(input,{now:now()});terms=input;}else{if(Object.hasOwn(input,'signingDeadline')||input.slippageBps!==0)throw Error();if(swapping){if(input.originAsset===input.destinationAsset||input.recipient!==input.owner)throw Error();}else if(input.originAsset!==input.destinationAsset||input.minOutput!==input.amount)throw Error();terms=checkConfidentialSpendTerms({...input,signingDeadline:input.refundDeadline},now());delete terms.signingDeadline;}}
   catch{send(400,{error:'Review the private recipient, asset, amount and time limit.'});return true;}
   const result=await (checking?observeFunding:funding?prepareFunding:prepare)(terms,{apiKey,signal,now,verifySignature});signal.throwIfAborted();send(200,checking?checkFundingObservation(terms,result,{now:now(),verifySignature}):result);
  }catch(error){send([400,413].includes(error.status)?error.status:503,{error:error.status===413?'Private request is too large.':error.status===400?'Review the private request.':'Private preparation is unavailable. Try again later.'});}
  finally{active--;req.removeListener('aborted',abort);res.removeListener('close',abort);}
  return true;
 };
}
