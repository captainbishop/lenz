import {createHyperliquidTestnetFunding,checkedFundingRequest,checkedFundingRecovery} from './hyperliquid-testnet-funding.mjs';

export function createHyperliquidTestnetFundingHttpRoute({origin='http://localhost:4173',service=createHyperliquidTestnetFunding(),now=Date.now}={}){
 const allowed=new URL(origin);if(allowed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(allowed.hostname))throw Error('Testnet funding requires the local Lenz origin.');
 const hosts=new Set(['localhost','127.0.0.1'].map(host=>host+(allowed.port?':'+allowed.port:''))),base='/api/hyperliquid-testnet/funding';let windowStart=now(),requests=0,active=0;
 const respond=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
 return async function route(request,response){
  const url=new URL(request.url,'http://localhost');if(!url.pathname.startsWith(base))return false;
  const site=request.headers['sec-fetch-site'],sameOrigin=request.headers.origin==='http://'+request.headers.host;
  if(!hosts.has(request.headers.host)||(!sameOrigin&&!(request.method==='GET'&&!request.headers.origin&&site==='same-origin'))||!['same-origin','none',undefined].includes(site)){respond(response,403,{error:'Open testnet funding from the local Lenz app.'});return true;}
  const config=url.pathname===base&&request.method==='GET',grant=url.pathname===base+'/request'&&request.method==='POST',recover=url.pathname===base+'/recover'&&request.method==='POST';
  if(url.search||![base,base+'/request',base+'/recover'].includes(url.pathname)){respond(response,404,{error:'Unknown testnet funding request.'});return true;}
  if(!config&&!grant&&!recover){respond(response,405,{error:'Use the funding request method.'});return true;}
  if(now()-windowStart>=60000){windowStart=now();requests=0;}if(++requests>30||active>=4){respond(response,429,{error:'Wait, then check the retained funding request.'});return true;}
  if(!config&&request.headers['content-type']?.split(';')[0].trim()!=='application/json'){respond(response,415,{error:'Use a JSON funding request.'});return true;}
  active++;
  try{
   let body;
   if(!config){
    try{
     const raw=await new Promise((resolve,reject)=>{let size=0,finished=false;const chunks=[],timer=setTimeout(()=>finish(Error('timeout')),5000);const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};request.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>1024){finish(null,null);request.resume();}else chunks.push(chunk);});request.on('end',()=>finish(null,Buffer.concat(chunks)));request.on('error',error=>finish(error));request.on('aborted',()=>finish(Error('aborted')));});
     if(raw===null){respond(response,413,{error:'The funding request is too large.'});return true;}body=(recover?checkedFundingRecovery:checkedFundingRequest)(JSON.parse(raw.toString('utf8')));
    }catch{respond(response,400,{error:'The testnet funding request cannot be read.'});return true;}
   }
   try{respond(response,200,config?await service.configuration():recover?await service.recover(body):await service.request(body));}
   catch(error){const message=error.message;const retained=/^Test funds were already requested|^Funding request changed|^Testnet funding limit reached/.test(message);respond(response,retained?409:503,{error:retained?message:'Testnet funding is unavailable. Keep this request and check again.'});}
   return true;
  }finally{active--;}
 };
}
