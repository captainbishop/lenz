import {join} from 'node:path';
import {homedir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {adapterConfig,verifyAdapter,verifyPacketRoot,adapterCall} from '../contracts/adapter-client.mjs';
import {relayAccount,view,call} from '../contracts/client.mjs';
import {reconcileAdapterOrder} from '../contracts/adapter-recovery.mjs';
import {serialize} from './testnet-relay.mjs';
import {keysAre,digest} from './public/peer-crypto.js';
import {checkRheaPacket} from './public/rhea-protocol.js';
import {applySpend} from './public/near-protocol.js';
import {createReserveSponsor} from './reserve-sponsor.mjs';

const check=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const same=isDeepStrictEqual;
const send=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
const terminal=new Set(['complete','refunded','rejected','attention']);
const inFlight=new Set(['checking','redeeming','depositing','swapping','withdrawing_output','withdrawing_refund','paying_output','paying_refund']);
const defaults={adapterConfig,verifyAdapter,verifyPacketRoot,adapterCall,relayAccount,view,call,reconcileAdapterOrder,serialize};

/** Public sponsorship requires possession of the original owner-signed packet on every operation. */
export function createSignedRheaRoute({clients=defaults,origin='http://127.0.0.1:4173',sponsorDir=process.env.LENZ_TESTNET_SPONSOR_DATA??join(homedir(),'Documents','Lenz-local-notes','testnet-operator','reserve-sponsor'),dailyLimit=Number(process.env.LENZ_TESTNET_SPONSOR_DAILY_LIMIT??12),now=Date.now}={}){
 const allowed=new URL(origin);check(allowed.protocol==='http:'&&['localhost','127.0.0.1'].includes(allowed.hostname),'Use the local swap origin.');
 const reserve=createReserveSponsor({directory:sponsorDir,dailyLimit,now});let minute=0,reads=0;
 function admit(){const current=Math.floor(now()/60000);if(minute!==current){minute=current;reads=0;}check(++reads<=60,'The swap service is busy. Keep the original request.',429);}
 async function checkedOrder(c,packet){
  const result=await clients.reconcileAdapterOrder(c,packet.id);
  check(result?.finality==='FINAL'&&(result.order===null||result.order?.id===packet.id&&same(result.order.instruction,packet.instruction)),'The final swap order changed its signed terms.');return result;
 }
 async function sponsor(c,packet,operation,stage,input=packet.instruction.input){
  const key=await digest(['lenz/rhea-sponsor/v1',c.reserve,c.adapter,input,operation,stage]);
  await reserve(key,operation,c.reserve,packet.instruction.owner);
 }
 async function pathState(c,packet){
  const notes=new Map([[packet.root.id,packet.root]]),consumed=new Map();let firstMissing=null;
  for(const spend of packet.path){
   const result=await applySpend(c.reserve,notes,consumed,spend),spent=await clients.view(c.reserve,'spent_by',{id:spend.input});
   check(spent===null||spent===result.id,'The signed ancestry conflicts with a confirmed payment.',409);
   if(spent===null)firstMissing??=spend.input;
  }
  const spent=await clients.view(c.reserve,'spent_by',{id:packet.instruction.input});check(spent===null,'The original swap input is already consumed. Check its saved status.',409);return firstMissing;
 }
 return async function signedRheaRoute(request,response){
  const operation={'/api/rhea/signed-submit':'submit','/api/rhea/signed-advance':'advance','/api/rhea/signed-order':'order','/api/rhea/signed-recover':'recover'}[request.url];
  if(!operation)return false;
  try{
   check(request.headers.host===allowed.host&&request.headers.origin===allowed.origin&&request.headers['content-type']?.split(';')[0].trim()==='application/json','Only the Lenz app can submit this signed swap.',403);
   check(request.method==='POST','Use a signed JSON POST request.',405);
   const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;check(size<=50000,'The signed swap request is too large.',413);chunks.push(chunk);}
   const data=JSON.parse(Buffer.concat(chunks));check(keysAre(data,['adapter','packet']),'Include only the original adapter and signed packet.');
   const c=await clients.adapterConfig();check(c.ready===true&&c.network==='testnet'&&data.adapter===c.adapter,'The selected testnet swap route is unavailable.',503);
   const packet=structuredClone(data.packet);check(keysAre(packet?.config,['network','adapter','reserve','exchange','poolId','tokenOut']),'The signed swap configuration changed.');await checkRheaPacket(c,packet);check(BigInt(packet.instruction.amount)<=100000000n,'The sponsored swap limit is 100 tUSD.');admit();
   const result=await clients.serialize(async()=>{
    await clients.verifyAdapter(c);await clients.verifyPacketRoot(c,packet);
    const current=await checkedOrder(c,packet);
    if(operation==='order'||current.order&&(operation==='submit'||terminal.has(current.order.stage)))return current;
    if(operation==='submit'){
     check(Number(packet.instruction.deadline_ms)>now(),'The signed permission expired. Check the original swap.',409);
     check(Number(packet.instruction.deadline_ms)<=now()+86400000,'The swap permission exceeds 24 hours.');
     const checkStart=()=>check(Number(packet.instruction.deadline_ms)>now(),'The signed permission expired before dispatch. Check the original swap.',409);
     const missing=await pathState(c,packet);checkStart();const account=await clients.relayAccount();check(account.accountId?.endsWith('.testnet'),'The sponsor must use a testnet account.',503);checkStart();
     if(missing){await sponsor(c,packet,'rhea-settle','ancestry',missing);checkStart();const settled=await clients.call(account,c.reserve,'settle',{path:packet.path},'0.2');check(settled?.finality==='FINAL','The original ancestry settlement is unresolved. Check before retrying.',409);checkStart();}
     const input=await clients.view(c.reserve,'get_note',{id:packet.instruction.input});check(input?.id===packet.instruction.input&&input.owner===packet.instruction.owner&&input.amount===packet.instruction.amount,'The exact funded swap input cannot be verified.',409);
     check(await clients.view(c.reserve,'spent_by',{id:input.id})===null,'The original swap input has a confirmed conflict.',409);
     checkStart();await sponsor(c,packet,'rhea-submit','new');checkStart();return clients.adapterCall(account,c,'submit',{instruction:packet.instruction});
    }
    check(current.order,'This original swap has not started. Review it before submission.',409);
    if(operation==='advance'&&inFlight.has(current.order.stage))return current;
    if(operation==='recover'){check(c.recoverRedemption===true,'Original redemption recovery is unavailable.');if(current.order.stage!=='redeeming')return current;const evidence=current.reconciliation;check(evidence?.finality==='FINAL'&&['confirmed','transaction_failed','needs_review'].includes(evidence.state)&&typeof evidence.txHash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(evidence.txHash),'Reconcile the original redemption before a recovery dispatch.',409);}
    const account=await clients.relayAccount();check(account.accountId?.endsWith('.testnet'),'The sponsor must use a testnet account.',503);
    await sponsor(c,packet,operation==='recover'?'rhea-recover':'rhea-advance',current.order.stage);
    return clients.adapterCall(account,c,operation==='recover'?'recover_redemption':'advance',{id:packet.id});
   });send(response,200,result);
  }catch(error){send(response,error.status??400,{error:(error.message??'The original signed swap cannot be verified.').slice(0,500)});}return true;
 };
}
