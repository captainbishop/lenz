import {configuration,relayAccount,call,view} from '../contracts/client.mjs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {keysAre,digest,bytes,unhex} from './public/peer-crypto.js';
import {FUND,applySpend} from './public/near-protocol.js';
import {createReserveSponsor} from './reserve-sponsor.mjs';

let queue=Promise.resolve();
export const serialize=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result;};
const check=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const noteId=value=>typeof value==='string'&&/^(root:[0-9a-f]{64}|[0-9a-f]{64}:[01])$/.test(value);
const spendingKey=value=>typeof value==='string'&&/^(02|03)[0-9a-f]{64}$/.test(value);
const amount=value=>typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value)&&BigInt(value)<2n**128n;
const validNote=(note,id)=>keysAre(note,['id','owner','amount'])&&note.id===id&&spendingKey(note.owner)&&amount(note.amount);
const receiptMatches=(receipt,spend,outputs,id)=>receipt?.id===id&&receipt.input===spend.input&&Array.isArray(receipt.outputs)&&receipt.outputs.length===outputs.length&&receipt.outputs.every((note,index)=>validNote(note,outputs[index].id)&&note.owner===outputs[index].owner&&note.amount===outputs[index].amount)&&Number.isSafeInteger(receipt.block_height)&&receipt.block_height>0;

export function createTestnetRelay({origin='http://127.0.0.1:4173',configuration:configRead=configuration,relayAccount:accountRead=relayAccount,call:chainCall=call,view:chainView=view,sponsorDir=process.env.LENZ_TESTNET_SPONSOR_DATA??join(homedir(),'Documents','Lenz-local-notes','testnet-operator','reserve-sponsor'),dailyLimit=Number(process.env.LENZ_TESTNET_SPONSOR_DAILY_LIMIT??12),now=Date.now}={}){
 const approved=new URL(origin);check(approved.protocol==='http:'&&['localhost','127.0.0.1'].includes(approved.hostname),'Use the local reserve origin.');
 const reserve=createReserveSponsor({directory:sponsorDir,dailyLimit,now});let minute=0,reads=0;
 function admit(){const currentMinute=Math.floor(now()/60000);if(minute!==currentMinute){minute=currentMinute;reads=0;}check(++reads<=60,'The testnet service is busy. Keep the original saved request and check again shortly.',429);}
 async function body(req){
  check(req.headers['content-type']?.split(';')[0]==='application/json'&&req.headers.origin===approved.origin,'Only this Lenz app can use the test relay.',403);
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;check(size<=50000,'Request too large',413);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks));
 }
 async function verifyFunding(data,contract){
  check(keysAre(data,['contract','owner','amount','nonce','signature','id'])&&spendingKey(data.owner)&&amount(data.amount)&&BigInt(data.amount)<=100000000n&&typeof data.nonce==='string'&&/^[0-9a-f]{32}$/.test(data.nonce)&&typeof data.signature==='string'&&/^[0-9a-f]{128}$/.test(data.signature),'Invalid signed funding request');
  const terms=[FUND,'testnet',contract,data.owner,data.amount,data.nonce];check(data.id==='root:'+await digest(terms),'Funding identifier does not match its signed terms.');
  let key;try{key=await crypto.subtle.importKey('raw',unhex(data.owner),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{check(false,'The funding spending key is invalid.');}
  check(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(data.signature),bytes(terms)),'Funding signature rejected.');
 }
 async function inspectPath(path,contract){
  const notes=new Map(),consumed=new Map(),records=[];
  for(const spend of path){
   if(!notes.has(spend.input)){const note=await chainView(contract,'get_note',{id:spend.input});check(validNote(note,spend.input),'Input has not reached the reserve.');notes.set(spend.input,note);}
   const spent=await chainView(contract,'spent_by',{id:spend.input});if(spent!==null){check(typeof spent==='string'&&/^[a-f0-9]{64}$/.test(spent),'The spent-input check is incomplete.');consumed.set(spend.input,spent);}
   let result;try{result=await applySpend(contract,notes,consumed,spend);}catch{check(false,'The signed payment path is invalid or conflicts with a confirmed spend.');}
   const receipt=await chainView(contract,'get_receipt',{id:result.id});
   check(!receipt||receiptMatches(receipt,spend,result.outputs,result.id),'The final transfer receipt changed.');records.push({spend,...result,receipt});
  }
  return records;
 }
 return async function route(req,res){
  if(!req.url.startsWith('/api/testnet/'))return false;
  try{
   check(req.headers.host===approved.host,'Invalid host',403);
   check(req.url==='/api/testnet/status'&&req.method==='GET'||['/api/testnet/fund','/api/testnet/settle','/api/testnet/check'].includes(req.url)&&req.method==='POST','Unknown testnet action',404);
   const config=await configRead();check(config?.network==='testnet'&&typeof config.ready==='boolean'&&typeof config.contract==='string'&&/^[a-z0-9._-]{2,64}$/.test(config.contract)&&config.contract.endsWith('.testnet'),'The reserve configuration cannot be verified.',503);
   if(req.url==='/api/testnet/status'&&req.method==='GET'){admit();send(res,200,config);return true;}
   const data=await body(req);check(config.ready,'The NEAR reserve is not ready.',503);check(data.contract===config.contract,'Wrong testnet contract');const contract=config.contract;
   if(req.url==='/api/testnet/fund'){
    await verifyFunding(data,contract);admit();
    const result=await serialize(async()=>{
     const {owner,amount,nonce,signature,id}=data,existing=await chainView(contract,'get_root',{id});
     if(existing){check(validNote(existing,id)&&existing.owner===owner&&existing.amount===amount,'Funding record does not match');return {root:existing,finality:'FINAL',recovered:true};}
     const account=await accountRead();check(account.accountId?.endsWith('.testnet'),'The sponsor must use a testnet account.',503);await reserve(id.slice(5),'fund',contract,owner);
     let receipt;try{receipt=await chainCall(account,contract,'fund_test',{owner,amount,nonce,signature},'0.03');}catch{check(false,'Funding has no verified outcome. Keep and check the original signed request.',409);}check(receipt.finality==='FINAL','Funding is not final. Check its original request.',409);
     const root=await chainView(contract,'get_root',{id});check(validNote(root,id)&&root.owner===owner&&root.amount===amount,'Funding has not appeared in matching final NEAR state.',409);return {...receipt,value:undefined,root};
    });send(res,200,result);
   }else if(req.url==='/api/testnet/settle'){
    check(keysAre(data,['contract','path'])&&Array.isArray(data.path)&&data.path.length>0&&data.path.length<=16&&data.path.every(spend=>keysAre(spend,['input','recipient','amount','nonce','signature'])&&noteId(spend.input)&&spendingKey(spend.recipient)&&amount(spend.amount)&&typeof spend.nonce==='string'&&/^[a-f0-9]{32}$/.test(spend.nonce)&&typeof spend.signature==='string'&&/^[a-f0-9]{128}$/.test(spend.signature)),'Expected 1 to 16 signed transfers');admit();
    const result=await serialize(async()=>{
     const records=await inspectPath(data.path,contract);if(records.every(row=>row.receipt))return {finality:'FINAL',receipts:records.map(row=>row.receipt),recovered:true};
     const account=await accountRead();check(account.accountId?.endsWith('.testnet'),'The sponsor must use a testnet account.',503);await reserve(records.at(-1).id,'settle',contract,null);
     let receipt;try{receipt=await chainCall(account,contract,'settle',{path:data.path});}catch{check(false,'Settlement has no verified outcome. Keep and check the original signed path.',409);}check(receipt.finality==='FINAL','Settlement is not final. Check its original path.',409);
     const confirmed=[];for(const row of records){const observed=await chainView(contract,'get_receipt',{id:row.id});check(receiptMatches(observed,row.spend,row.outputs,row.id),'Settlement has no matching final receipt.',409);confirmed.push(observed);}return {...receipt,value:undefined,receipts:confirmed};
    });send(res,200,result);
   }else{
    check(keysAre(data,['contract','ids'])&&Array.isArray(data.ids)&&data.ids.length<=80&&new Set(data.ids).size===data.ids.length&&data.ids.every(noteId),'Invalid payment ids');admit();
    const results=[];for(const id of data.ids){const note=await chainView(contract,'get_note',{id}),spent=await chainView(contract,'spent_by',{id}),receipt=id.startsWith('root:')?null:await chainView(contract,'get_receipt',{id:id.split(':')[0]});results.push({id,note,spent,receipt});}send(res,200,{finality:'FINAL',results});
   }
  }catch(error){send(res,error.status??503,{error:error.status?error.message.slice(0,500):'The testnet service cannot verify this request right now. Your original request stays saved.'});}return true;
 };
}
let configuredRoute;
export const testnetRoute=(req,res)=>(configuredRoute??=createTestnetRelay())(req,res);
