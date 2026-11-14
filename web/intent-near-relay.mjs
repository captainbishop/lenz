import {createHash,createPublicKey,verify,randomBytes} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {base58} from './public/intents-vendor/codecs.js';
import {Account,KeyPair,JsonRpcProvider,actions,encodeTransaction,decodeSignedTransaction} from '../contracts/node_modules/near-api-js/lib/index.js';
import {verifyNep413,nep413Hash} from '../integrations/intent-testnet/swap.mjs';
import {outsideRepository} from '../integrations/intent-testnet/private-path.mjs';
import {NEAR_INTENT_DEPLOYMENT as deployment,buildNearReview,buildNearFundingReview,checkNearReview,checkNearSelection,checkNearAuthorization,implicitNearOwner,sameNearValue} from './public/intent-near-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const json=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item);
const hash=value=>createHash('sha256').update(value).digest('hex');
const codeHash=value=>base58.encode(Buffer.from(value,'hex'));
const displayAmount=value=>{const units=BigInt(value),fraction=(units%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return (units/1000000n).toString()+(fraction?'.'+fraction:'');};
const empty=()=>({version:1,requests:{},grants:{},pending:null});
function checkJournal(state){check(state?.version===1&&state.requests&&state.grants&&Object.keys(state.requests).length<=512&&Object.keys(state.grants).length<=100,'The retained NEAR journal cannot be read.');return state;}
export function createNearIntentFinalSnapshot(request){return async()=>{
 const {header}=await request('block',{finality:'final'});
 check(header&&typeof header.hash==='string'&&base58.decode(header.hash).length===32&&Number.isSafeInteger(header.height)&&header.height>0&&typeof header.timestamp_nanosec==='string'&&/^[1-9][0-9]{0,24}$/.test(header.timestamp_nanosec),'The final NEAR block is invalid.');
 const query=async params=>{const result=await request('query',{...params,block_id:header.hash});check(result?.block_hash===header.hash&&result.block_height===header.height,'The expiry query returned another block.');return result;};
 return {header,account:account_id=>query({request_type:'view_account',account_id}),async keys(account_id){return (await query({request_type:'view_access_key_list',account_id})).keys;},async query(method_name,args,account_id){const result=await query({request_type:'call_function',account_id,method_name,args_base64:Buffer.from(json(args)).toString('base64')});return JSON.parse(Buffer.from(result.result).toString('utf8'));}};
};}
function exactTransaction(signed,call){
 check(signed&&typeof signed.bytes==='string'&&Buffer.from(signed.bytes,'base64').toString('base64')===signed.bytes,'Invalid retained transaction bytes.');
 const decoded=decodeSignedTransaction(Buffer.from(signed.bytes,'base64')),tx=decoded.transaction,operation=tx.actions[0]?.functionCall;
 const transactionHash=base58.encode(createHash('sha256').update(encodeTransaction(tx)).digest());
 check(transactionHash===signed.txHash&&tx.signerId===signed.senderId&&tx.receiverId===call.receiverId&&tx.actions.length===1&&operation?.methodName===call.methodName&&sameNearValue(JSON.parse(Buffer.from(operation.args).toString('utf8')),call.args)&&operation.gas.toString()===call.gas&&operation.deposit.toString()===call.deposit,'The retained transaction changed its exact call.');
 check(tx.publicKey.keyType===0&&decoded.signature.ed25519Signature?.data?.length===64&&verify(null,createHash('sha256').update(encodeTransaction(tx)).digest(),createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(tx.publicKey.data)]),type:'spki',format:'der'}),Buffer.from(decoded.signature.ed25519Signature.data)),'The retained transaction signature is invalid.');
 return decoded;
}
export function createNearIntentRelay({rpc,signer,journal,now=Date.now,random=size=>randomBytes(size)}){
 check(rpc&&signer&&journal&&/^[0-9a-f]{64}$/.test(signer.solverId),'The real testnet route is not configured.');
 let queue=Promise.resolve();
 const serialized=operation=>{const task=queue.then(operation);queue=task.catch(()=>{});return task;};
 const randomness=()=>Buffer.from(random(15)).toString('base64');
 async function balances(owner){const result=await rpc.query('mt_batch_balance_of',{account_id:owner,token_ids:['nep141:'+deployment.source,'nep141:'+deployment.target]},deployment.verifier);check(Array.isArray(result)&&result.length===2&&result.every(value=>typeof value==='string'&&/^[0-9]{1,39}$/.test(value)),'The testnet balances are invalid.');return result;}
 async function assertDeployment(view=rpc){
  const [verifier,source,target,fee,keys,roles]=await Promise.all([view.account(deployment.verifier),view.account(deployment.source),view.account(deployment.target),view.query('fee',{},deployment.verifier),view.keys(deployment.verifier),view.query('acl_get_super_admins',{skip:0,limit:100},deployment.verifier)]);
  check(verifier.code_hash===codeHash(deployment.verifierSha256)&&source.code_hash===codeHash(deployment.tokenSha256)&&target.code_hash===codeHash(deployment.tokenSha256)&&fee===0&&Array.isArray(keys)&&keys.length===0&&Array.isArray(roles)&&roles.length===0,'The deployed verifier, assets, authority or fee changed.');
 }
 async function fundingAuthority(){const owners=await Promise.all([rpc.query('owner_get',{},deployment.source),rpc.query('owner_get',{},deployment.target)]);return typeof signer.relayerId==='string'&&owners.every(owner=>owner===signer.relayerId);}
 async function configuration(){await assertDeployment();const [solver,mayMint]=await Promise.all([balances(signer.solverId),fundingAuthority()]),state=checkJournal(await journal.read()),funded=BigInt(solver[1])>=2000000n;return {...deployment,ready:funded&&!state.pending,deploymentVerified:true,venue:'Lenz test venue',offer:'Fixed test offer: 2 LTT per LTS',solverId:signer.solverId,solverResultBalance:solver[1],sourceSymbol:'LTS',targetSymbol:'LTT',decimals:6,rate:'2',maxInput:'1000000',testGrant:'1000000',privacy:'public',fundingAvailable:mayMint&&!state.pending&&Object.values(state.grants).filter(row=>row.authorization).length<50,fundingOwner:mayMint?signer.relayerId:null,custody:'Funds deposited in the NEAR Intents verifier; browser holds the user signing key.'};}
 async function status({owner}){check(/^[0-9a-f]{64}$/.test(owner),'Choose a NEAR source account.');await assertDeployment();const [user,solver]=await Promise.all([balances(owner),balances(signer.solverId)]),state=checkJournal(await journal.read());let externalResultBalance=null;try{const observed=await rpc.query('ft_balance_of',{account_id:owner},deployment.target);if(typeof observed==='string'&&/^[0-9]{1,39}$/.test(observed))externalResultBalance=observed;}catch{}return {network:'testnet',owner,sourceBalance:user[0],resultBalance:user[1],externalResultBalance,solverResultBalance:solver[1],checkedAt:now(),pending:state.pending!==null,grantUsed:Object.values(state.grants).some(row=>row.review.owner===owner&&row.authorization!==null)};}
 async function prepare(chosen){return serialized(async()=>{
  const selected=checkNearSelection(chosen,{now:now()}),state=checkJournal(await journal.read());check(!state.pending,'Check the original pending testnet transaction.');await assertDeployment();
  const [user,solver,salt,registration]=await Promise.all([balances(selected.source.accountId),balances(signer.solverId),rpc.query('current_salt',{},deployment.verifier),rpc.query('storage_balance_of',{account_id:selected.destination.accountId},deployment.target)]);
  check(BigInt(user[0])>=BigInt(selected.source.amount),'Add test funds before reviewing this swap.');check(BigInt(solver[1])>=BigInt(selected.source.amount)*2n,'The solver has insufficient funded LTT.');check(registration!==null,'Register the result account for LTT before reviewing this swap.');
  const review=buildNearReview(selected,{salt,solverId:signer.solverId,userRandom:randomness(),solverRandom:randomness(),withdrawRandom:randomness()},{now:now()});
  return review;
 });}
 async function broadcast(state,operationId,stage,call){
  check(!state.pending,'Check the original pending testnet transaction.');
  const signed=await signer.signTransaction(call);check(signed.senderId===(call.senderRole==='solver'?signer.solverAccountId:signer.relayerId),'The signed transaction source account changed.');exactTransaction(signed,call);
  state.pending={operationId,stage,call,signed};await journal.write(state);
  try{return await rpc.send(signed.bytes);}catch{return null;}
 }
 function finalResult(result,pending){
  if(!result||result.final_execution_status!=='FINAL')return null;
  check(result.transaction?.hash===pending.signed.txHash&&result.transaction.signer_id===pending.signed.senderId&&result.transaction.receiver_id===pending.call.receiverId,'The final result belongs to another transaction.');
  const action=result.transaction.actions?.[0]?.FunctionCall;
  check(result.transaction.actions.length===1&&action?.method_name===pending.call.methodName&&sameNearValue(JSON.parse(Buffer.from(action.args,'base64').toString('utf8')),pending.call.args)&&String(action.gas)===pending.call.gas&&String(action.deposit)===pending.call.deposit,'The final transaction changed its reviewed call.');
  check(Array.isArray(result.receipts_outcome)&&result.receipts_outcome.length>0,'Final receipts are missing.');
  const success=Object.hasOwn(result.status??{},'SuccessValue')&&result.receipts_outcome.every(receipt=>Object.hasOwn(receipt.outcome.status,'SuccessValue')||Object.hasOwn(receipt.outcome.status,'SuccessReceiptId'));
  return {success,txHash:pending.signed.txHash,receiptIds:result.receipts_outcome.map(receipt=>receipt.id),result};
 }
 function pendingOutcome(row,reason='The original testnet transaction has no final result yet.') {return {intentId:row.review.id,artifactId:row.authorization?.artifactId,status:'unknown',verified:false,evidence:{network:'testnet',transaction:row.transaction?.txHash??null,description:reason}};}
 async function observeExpiry(row){
  if(!rpc.finalSnapshot||row.transaction||row.finalReceipt)return null;
  try{
   const view=await rpc.finalSnapshot(),payloads=[...row.review.authorization.payloads,row.review.solverPayload],timestamp=BigInt(view.header.timestamp_nanosec);
   if(!payloads.every(payload=>timestamp>BigInt(Date.parse(JSON.parse(payload.message).deadline))*1000000n))return null;
   await assertDeployment(view);const nonces=[];
   for(const payload of payloads){const accountId=JSON.parse(payload.message).signer_id;check(await view.query('is_nonce_used',{account_id:accountId,nonce:payload.nonce},deployment.verifier)===false,'An original nonce was consumed or unavailable.');nonces.push({accountId,nonce:payload.nonce,used:false});}
   // Expired bitmap prefixes can be deleted by the contract's garbage collector.
   // A false post-expiry view cannot distinguish unused from previously consumed.
   return {intentId:row.review.id,artifactId:row.authorization?.artifactId,status:'unknown',verified:false,resubmissionSafe:false,permissionExpired:true,evidence:{network:'testnet',verifier:deployment.verifier,sourceRevision:deployment.sourceRevision,configHash:deployment.verifierSha256,tokenHash:deployment.tokenSha256,blockHash:view.header.hash,blockHeight:view.header.height,timestampNanosec:view.header.timestamp_nanosec,nonces,authorizationRecovered:!!row.authorization,description:'The permission expired. Nonce records may have been pruned, so this final view cannot prove whether the swap ran. The original request remains unresolved.'}};
  }catch{return null;}
 }
 async function verifySettlement(state,row,final){
  const review=row.review,output=review.quote.output;
  if(!final.success)return pendingOutcome(row,'The final transaction or an asynchronous receipt failed. Check the retained result; a withdrawal failure can leave LTT in your Intents account.');
  const withdrawals=[];
  for(const receipt of final.result.receipts_outcome){if(receipt.outcome.executor_id!==deployment.target)continue;for(const log of receipt.outcome.logs??[]){if(!log.startsWith('EVENT_JSON:'))continue;let event;try{event=JSON.parse(log.slice(11));}catch{continue;}if(event.standard==='nep141'&&event.event==='ft_transfer')withdrawals.push(...event.data.filter(item=>item.old_owner_id===deployment.verifier&&item.new_owner_id===review.destination.accountId));}}
  check(withdrawals.length===1&&withdrawals[0].amount===output,'The final receipts do not prove the exact external result.');
  const signed=[row.authorization.signed[0],row.solverSigned,row.authorization.signed[1]];
  for(const item of signed)check(await rpc.query('is_nonce_used',{account_id:JSON.parse(item.payload.message).signer_id,nonce:item.payload.nonce},deployment.verifier)===true,'The final result did not consume the exact signed nonce.');
  // The exact successful transfer receipt proves delivery even if the recipient
  // subsequently spends it. A later balance is observation, not settlement.
  let external=null;try{external=await rpc.query('ft_balance_of',{account_id:review.destination.accountId},deployment.target);}catch{}
  return {intentId:review.id,artifactId:row.authorization.artifactId,status:'executed',verified:true,evidence:{network:'testnet',transaction:final.txHash,verifier:deployment.verifier,receiptIds:final.receiptIds,inputAsset:review.source.asset,inputAmount:review.source.amount,outputAsset:review.destination.asset,outputAmount:output,recipient:review.destination.accountId,externalBalance:external,sourceRevision:deployment.sourceRevision,description:'Swapped '+displayAmount(review.source.amount)+' LTS and delivered '+displayAmount(output)+' LTT on NEAR testnet.'}};
 }
 async function finishRequest(state,row,result){
  const pending=state.pending,final=finalResult(result,pending);if(!final)return pendingOutcome(row);
  let outcome;try{outcome=await verifySettlement(state,row,final);}catch(error){outcome=pendingOutcome(row,error.message);}
  row.finalReceipt={txHash:final.txHash,receiptIds:final.receiptIds,success:final.success};row.outcome=outcome;if(!final.success||outcome.verified===true)state.pending=null;await journal.write(state);return outcome;
 }
 async function submit(attempt){return serialized(async()=>{
  const state=checkJournal(await journal.read());check(attempt?.id===attempt?.review?.id,'The original NEAR request identifier changed.');let row=state.requests[attempt.id];
  if(row)check(sameNearValue(attempt.review,row.review),'The original NEAR request changed.');else{checkNearReview(attempt.review,attempt.review,{now:now()});check(attempt.review.nonceTerms.solverId===signer.solverId,'The reviewed solver changed.');row={review:structuredClone(attempt.review),authorization:null,outcome:null,transaction:null};}
  const authorization=checkNearAuthorization(attempt.authorization,row.review);for(const signed of authorization.signed)check(verifyNep413(signed),'Invalid user NEP-413 signature.');
  if(row.authorization){check(sameNearValue(row.authorization,authorization),'The retained authorization changed.');if(row.outcome?.verified||row.finalReceipt||row.transaction||state.pending)return row.outcome??pendingOutcome(row);}
  check(!state.pending,'Check the original pending testnet transaction.');checkNearReview(row.review,row.review,{now:now()});await assertDeployment();
  const [user,solver,currentSalt,registration]=await Promise.all([balances(row.review.source.accountId),balances(signer.solverId),rpc.query('current_salt',{},deployment.verifier),rpc.query('storage_balance_of',{account_id:row.review.destination.accountId},deployment.target)]);
  check(currentSalt===row.review.nonceTerms.salt&&BigInt(user[0])>=BigInt(row.review.quote.input)&&BigInt(solver[1])>=BigInt(row.review.quote.output)&&registration!==null,'The reviewed salt, source funds, solver liquidity or destination registration changed.');
  for(const payload of [...row.review.authorization.payloads,row.review.solverPayload])check(await rpc.query('is_nonce_used',{account_id:JSON.parse(payload.message).signer_id,nonce:payload.nonce},deployment.verifier)===false,'A reviewed signing nonce was already used.');
  const solverSigned=await signer.signSolver(row.review.solverPayload);check(solverSigned.payload&&sameNearValue(solverSigned.payload,row.review.solverPayload)&&implicitNearOwner(solverSigned.public_key)===signer.solverId&&verifyNep413(solverSigned),'The solver signed different terms.');
  check(Object.keys(state.requests).length<512||state.requests[row.review.id],'The retained signed request limit was reached.');row.authorization=authorization;row.solverSigned=solverSigned;state.requests[row.review.id]=row;await journal.write(state);
  const call={receiverId:deployment.verifier,methodName:'execute_intents',args:{signed:[authorization.signed[0],solverSigned,authorization.signed[1]]},gas:'300000000000000',deposit:'0'};
  const result=await broadcast(state,row.review.id,'execute',call);row.transaction={txHash:state.pending.signed.txHash,senderId:state.pending.signed.senderId};await journal.write(state);
  return finishRequest(state,row,result);
 });}
 async function reconcile(attempt){return serialized(async()=>{
  const state=checkJournal(await journal.read());let row=state.requests[attempt?.id];
  if(!row){check(attempt?.id===attempt?.review?.id,'The original request identifier changed.');checkNearReview(attempt.review,attempt.review,{allowExpired:true});const authorization=attempt.authorization?checkNearAuthorization(attempt.authorization,attempt.review):null;check(authorization||attempt.status==='approval-unresolved','The original authorization is missing.');for(const signed of authorization?.signed??[])check(verifyNep413(signed),'Invalid user NEP-413 signature.');row={review:attempt.review,authorization,transaction:null};}
  else check(sameNearValue(attempt.review,row.review)&&sameNearValue(attempt.authorization??null,row.authorization??null),'The retained NEAR request or authorization changed.');
  checkNearReview(row.review,row.review,{allowExpired:true});
  if(row.authorization)checkNearAuthorization(row.authorization,row.review);if(row.outcome?.status==='executed')return row.outcome;
  if(!state.pending){
   if(row.finalReceipt||row.transaction)return row.outcome??pendingOutcome(row);
   const expiry=await observeExpiry(row);if(expiry){check(Object.keys(state.requests).length<512||state.requests[row.review.id],'The retained request limit was reached.');row.outcome=expiry;state.requests[row.review.id]=row;await journal.write(state);return expiry;}
   if(!row.authorization)return pendingOutcome(row,'The original approval is unavailable. Expiry has not been verified.');
   let safe=row.review.deadline>now();for(const payload of [...row.review.authorization.payloads,row.review.solverPayload])if(await rpc.query('is_nonce_used',{account_id:JSON.parse(payload.message).signer_id,nonce:payload.nonce},deployment.verifier)!==false)safe=false;
   return {...pendingOutcome(row,safe?'No transaction was created for this request. You can resume the original approval.':'The original permission cannot be safely resumed. Keep checking this request.'),resubmissionSafe:safe};
  }
  check(state.pending.operationId===row.review.id,'Another original testnet transaction is pending.');exactTransaction(state.pending.signed,state.pending.call);
  let result;try{result=await rpc.transaction(state.pending.signed.txHash,state.pending.signed.senderId);}catch{return pendingOutcome(row);}
  return finishRequest(state,row,result);
 });}
 async function prepareFunds({owner,destination=owner}){return serialized(async()=>{
  const state=checkJournal(await journal.read());check(!state.pending,'Check the original pending testnet transaction.');
  await assertDeployment();check(await fundingAuthority(),'The configured testnet relayer is not the owner of both test assets.');
  check(!Object.values(state.grants).some(row=>row.review.owner===owner&&row.authorization!==null),'This source already requested its capped test funds. Check the original grant.');
  check(Object.values(state.grants).filter(row=>row.authorization!==null).length<50,'The private test funding cap was reached.');
  const review=buildNearFundingReview(owner,{nonce:Buffer.from(random(32)).toString('base64'),deadline:now()+300000,solverId:signer.solverId,destination},{now:now()});
  return review;
 });}
 async function finishGrantStage(state,row,result){
  const final=finalResult(result,state.pending);if(!final)return false;
  const stage=state.pending.stage;
  if(final.success&&['deposit-source','deposit-solver'].includes(stage)){
   let transferred;try{transferred=JSON.parse(Buffer.from(final.result.status.SuccessValue,'base64').toString('utf8'));}catch{}
   check(transferred===(stage==='deposit-source'?'1000000':'2000000'),'The final token deposit did not accept the exact grant amount.');
  }
  row.stages[state.pending.stage]={txHash:final.txHash,receiptIds:final.receiptIds,success:final.success};state.pending=null;await journal.write(state);
  check(final.success,'The original test funding transaction failed. No replacement was sent.');return true;
 }
 function grantStatus(row,state){return row.outcome??{id:row.review.id,status:'unknown',owner:row.review.owner,transaction:state.pending?.operationId===row.review.id?state.pending.signed.txHash:null,description:'Check the original capped funding request before trying again.'};}
 async function runGrant(state,row){
  if(row.outcome)return row.outcome;
  const c=deployment,owner=row.review.owner,relayerId=signer.relayerId,solverAccountId=signer.solverAccountId;
  check(typeof relayerId==='string'&&typeof solverAccountId==='string','The actual testnet funding accounts are unavailable.');
  const calls=[
   ['register-result',{receiverId:c.target,methodName:'storage_deposit',args:{account_id:row.review.destination,registration_only:true},deposit:'20000000000000000000000',gas:'50000000000000'}],
   ['mint-source',{receiverId:c.source,methodName:'ft_deposit',args:{owner_id:relayerId,amount:'1000000'},deposit:'20000000000000000000000',gas:'100000000000000'}],
   ['deposit-source',{receiverId:c.source,methodName:'ft_transfer_call',args:{receiver_id:c.verifier,amount:'1000000',msg:owner},deposit:'1',gas:'300000000000000'}],
   ['mint-solver',{receiverId:c.target,methodName:'ft_deposit',args:{owner_id:solverAccountId,amount:'2000000'},deposit:'20000000000000000000000',gas:'100000000000000'}],
   ['deposit-solver',{receiverId:c.target,methodName:'ft_transfer_call',args:{receiver_id:c.verifier,amount:'2000000',msg:signer.solverId},deposit:'1',gas:'300000000000000',senderRole:'solver'}],
  ];
  for(const [stage,call] of calls){
   if(row.stages[stage]){check(row.stages[stage].success,'The original test funding stage failed.');continue;}
   if(state.pending){check(state.pending.operationId===row.review.id&&state.pending.stage===stage&&sameNearValue(state.pending.call,call),'Another original transaction is pending.');let result;try{result=await rpc.transaction(state.pending.signed.txHash,state.pending.signed.senderId);}catch{return grantStatus(row,state);}if(!await finishGrantStage(state,row,result))return grantStatus(row,state);continue;}
   if(row.review.deadline<=now())return {...grantStatus(row,state),status:'funding-expired',description:'The original funding permission expired. Its completed and pending stages remain saved; no new call was sent.'};
   if(stage==='mint-source'||stage==='mint-solver')check(await fundingAuthority(),'The configured testnet relayer is not the owner of both test assets.');
   const result=await broadcast(state,row.review.id,stage,call);if(!await finishGrantStage(state,row,result))return grantStatus(row,state);
  }
  return completeGrant(state,row);
 }
 async function completeGrant(state,row){
  const owner=row.review.owner,[user,solver]=await Promise.all([balances(owner),balances(signer.solverId)]);
  check(row.stages['deposit-source']?.success&&row.stages['deposit-solver']?.success,'The final receipts do not prove the exact capped grant.');
  row.outcome={id:row.review.id,status:'funded',verified:true,network:'testnet',owner,sourceAmount:'1000000',sourceBalance:user[0],solverResultBalance:solver[1],transactions:Object.values(row.stages).map(stage=>stage.txHash),description:'Added 1 LTS to your NEAR testnet Intents account; funded the solver with 2 LTT.'};await journal.write(state);return row.outcome;
 }
 async function addFunds({review,signed}){return serialized(async()=>{
  const state=checkJournal(await journal.read());let row=state.grants[review?.id];
  if(row)check(sameNearValue(row.review,review),'The original test funding review changed.');
  else{check(sameNearValue(review,buildNearFundingReview(review?.owner,{nonce:review?.payload?.nonce,deadline:review?.deadline,solverId:signer.solverId,destination:review?.destination},{now:now()})),'The original test funding review changed.');row={review:structuredClone(review),authorization:null,stages:{},outcome:null};}
  check(signed?.standard==='nep413'&&sameNearValue(signed.payload,row.review.payload)&&implicitNearOwner(signed.public_key)===row.review.owner&&verifyNep413(signed),'The source did not sign this exact test funding grant.');
  if(row.authorization){check(sameNearValue(row.authorization,signed),'The retained test funding authorization changed.');}
  else{check(!state.pending,'Check the original pending testnet transaction.');check(row.review.deadline>now(),'The test funding review expired.');check(!Object.values(state.grants).some(other=>other!==row&&other.review.owner===row.review.owner&&other.authorization!==null),'The capped source grant was already used.');check(Object.values(state.grants).filter(other=>other.authorization!==null).length<50,'The private test funding cap was reached.');await assertDeployment();const [user,solver]=await Promise.all([balances(row.review.owner),balances(signer.solverId)]);row.before={userSource:user[0],solverResult:solver[1]};row.authorization=structuredClone(signed);state.grants[row.review.id]=row;await journal.write(state);}
  return runGrant(state,row);
 });}
 async function reconcileFunds({id}){return serialized(async()=>{
  const state=checkJournal(await journal.read()),row=state.grants[id];check(row?.authorization,'The original signed test funding grant is missing.');if(row.outcome)return row.outcome;
  if(state.pending){check(state.pending.operationId===id,'Another original transaction is pending.');exactTransaction(state.pending.signed,state.pending.call);let result;try{result=await rpc.transaction(state.pending.signed.txHash,state.pending.signed.senderId);}catch{return grantStatus(row,state);}if(!await finishGrantStage(state,row,result))return grantStatus(row,state);}
  if(['register-result','mint-source','deposit-source','mint-solver','deposit-solver'].every(stage=>row.stages[stage]?.success))return completeGrant(state,row);
  return {...grantStatus(row,state),status:'funding-incomplete',description:'The original transaction is final. Continue the saved funding request to finish adding test funds.'};
 });}
 return Object.freeze({configuration,status,prepare,submit,reconcile,prepareFunds,addFunds,reconcileFunds});
}

export async function openNearIntentRelay({stateDir,deployerKeyFile,deploymentStateFile,fetchImpl=fetch}){
 const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(stateDir);
 check([stateDir,deployerKeyFile,deploymentStateFile].every(path=>outsideRepository(root,path)),'Keep NEAR keys and journals outside the product repository.');
 const deployer=JSON.parse(await readFile(resolve(deployerKeyFile),'utf8')),retainedDeployment=JSON.parse(await readFile(resolve(deploymentStateFile),'utf8'));
 check(retainedDeployment.complete===true&&retainedDeployment.plan.names.verifier===deployment.verifier&&retainedDeployment.plan.names.source===deployment.source&&retainedDeployment.plan.names.target===deployment.target&&retainedDeployment.plan.verifierSha256===deployment.verifierSha256&&retainedDeployment.plan.tokenSha256===deployment.tokenSha256,'The original verified deployment changed.');
 const solverKey=retainedDeployment.keys.solver;check(solverKey.accountId===retainedDeployment.plan.names.solver&&deployer.accountId===retainedDeployment.plan.parent,'The retained solver or relayer changed.');
 const provider=new JsonRpcProvider({url:deployment.rpc}),relayer=new Account(deployer.accountId,provider,deployer.privateKey),solver=new Account(solverKey.accountId,provider,solverKey.privateKey),solverPair=KeyPair.fromString(solverKey.privateKey);
 await mkdir(directory,{recursive:true});const path=resolve(directory,'relay-state.json'),lockPath=resolve(directory,'process.lock');
 try{const recordedPid=Number(await readFile(lockPath,'utf8'));check(Number.isSafeInteger(recordedPid)&&recordedPid>0,'The retained process lock is invalid.');try{process.kill(recordedPid,0);throw Error('Another NEAR relay process is active.');}catch(error){if(error.code!=='ESRCH')throw error;await unlink(lockPath);}}catch(error){if(error.code!=='ENOENT')throw error;}
 const lease=await open(lockPath,'wx',0o600);await lease.writeFile(String(process.pid));await lease.sync();await lease.close();
 const journal={async read(){try{return checkJournal(JSON.parse(await readFile(path,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;return empty();}},async write(state){checkJournal(state);const file=await open(path+'.next','w',0o600);await file.writeFile(json(state)+'\n');await file.sync();await file.close();await rename(path+'.next',path);}};
 async function request(method,params){const response=await fetchImpl(deployment.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:json({jsonrpc:'2.0',id:'lenz-near-intent',method,params}),signal:AbortSignal.timeout(90000)});check(response.ok,'NEAR testnet RPC is unavailable.');const body=await response.json();check(!body.error,'NEAR testnet RPC did not return the requested final result.');return body.result;}
 const rpc={finalSnapshot:createNearIntentFinalSnapshot(request),async query(method,args,contractId){const result=await request('query',{request_type:'call_function',account_id:contractId,method_name:method,args_base64:Buffer.from(json(args)).toString('base64'),finality:'final'});return JSON.parse(Buffer.from(result.result).toString('utf8'));},account:account_id=>request('query',{request_type:'view_account',account_id,finality:'final'}),async keys(account_id){return (await request('query',{request_type:'view_access_key_list',account_id,finality:'final'})).keys;},send:signed_tx_base64=>request('send_tx',{signed_tx_base64,wait_until:'FINAL'}),transaction:(tx_hash,sender_account_id)=>request('tx',{tx_hash,sender_account_id,wait_until:'FINAL'})};
 const signer={solverId:implicitNearOwner(solverPair.getPublicKey().toString()),relayerId:relayer.accountId,solverAccountId:solver.accountId,
  async signSolver(payload){return {standard:'nep413',payload:structuredClone(payload),public_key:solverPair.getPublicKey().toString(),signature:'ed25519:'+base58.encode(solverPair.sign(nep413Hash(payload)).signature)};},
  async signTransaction(call){const account=call.senderRole==='solver'?solver:relayer,signed=await account.createSignedTransaction({receiverId:call.receiverId,actions:[actions.functionCall(call.methodName,call.args,BigInt(call.gas),BigInt(call.deposit))]});return {senderId:account.accountId,txHash:base58.encode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest()),bytes:Buffer.from(signed.encode()).toString('base64')};},
 };
 const relay=createNearIntentRelay({rpc,signer,journal});
 return Object.freeze({...relay,async close(){await unlink(resolve(directory,'process.lock'));}});
}

export async function reconcileNearIntentTransaction({stateDir,fetchImpl=fetch}){
 const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(stateDir);check(outsideRepository(root,directory),'Keep the retained transaction journal outside the product repository.');
 const state=checkJournal(JSON.parse(await readFile(resolve(directory,'relay-state.json'),'utf8'))),pending=state.pending;
 if(!pending)return {network:'testnet',status:'no-pending-transaction'};
 check([deployment.verifier,deployment.source,deployment.target].includes(pending.call.receiverId),'The retained receiver is outside this deployment.');exactTransaction(pending.signed,pending.call);
 const result={network:'testnet',operationId:pending.operationId,stage:pending.stage,transaction:pending.signed.txHash,senderId:pending.signed.senderId,receiverId:pending.call.receiverId,status:'unknown',receiptIds:[]};
 let response;try{response=await fetchImpl(deployment.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:json({jsonrpc:'2.0',id:'lenz-read-only-reconcile',method:'tx',params:{tx_hash:pending.signed.txHash,sender_account_id:pending.signed.senderId,wait_until:'FINAL'}}),signal:AbortSignal.timeout(90000)});}catch{return result;}
 if(!response.ok)return result;const body=await response.json();if(body.error||body.result?.final_execution_status!=='FINAL')return result;
 const final=body.result;check(final.transaction?.hash===pending.signed.txHash&&final.transaction.signer_id===pending.signed.senderId&&final.transaction.receiver_id===pending.call.receiverId,'The reconciliation result belongs to another transaction.');check(Array.isArray(final.receipts_outcome)&&final.receipts_outcome.length>0,'The final receipts are missing.');
 const succeeded=Object.hasOwn(final.status??{},'SuccessValue')&&final.receipts_outcome.every(receipt=>!Object.hasOwn(receipt.outcome.status,'Failure'));
 return {...result,status:succeeded?'final-success':'final-failure',receiptIds:final.receipts_outcome.map(receipt=>receipt.id)};
}

export async function inspectNearIntentDeployment({solverId,owner,fetchImpl=fetch}){
 check(/^[0-9a-f]{64}$/.test(solverId)&&(!owner||/^[0-9a-f]{64}$/.test(owner)),'Use the public implicit solver and source account IDs.');
 async function query(params){const response=await fetchImpl(deployment.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:json({jsonrpc:'2.0',id:'lenz-read-only-deployment',method:'query',params:{...params,finality:'final'}}),signal:AbortSignal.timeout(90000)});check(response.ok,'NEAR testnet RPC is unavailable.');const body=await response.json();check(!body.error,'The requested final testnet view is unavailable.');return body.result;}
 const view=async(account_id,method_name,args={})=>{const result=await query({request_type:'call_function',account_id,method_name,args_base64:Buffer.from(json(args)).toString('base64')});return JSON.parse(Buffer.from(result.result).toString('utf8'));};
 const token_ids=['nep141:'+deployment.source,'nep141:'+deployment.target];
 const [verifier,source,target,access,fee,roles,solver,user]=await Promise.all([query({request_type:'view_account',account_id:deployment.verifier}),query({request_type:'view_account',account_id:deployment.source}),query({request_type:'view_account',account_id:deployment.target}),query({request_type:'view_access_key_list',account_id:deployment.verifier}),view(deployment.verifier,'fee'),view(deployment.verifier,'acl_get_super_admins',{skip:0,limit:100}),view(deployment.verifier,'mt_batch_balance_of',{account_id:solverId,token_ids}),owner?view(deployment.verifier,'mt_batch_balance_of',{account_id:owner,token_ids}):null]);
 check(verifier.code_hash===codeHash(deployment.verifierSha256)&&source.code_hash===codeHash(deployment.tokenSha256)&&target.code_hash===codeHash(deployment.tokenSha256)&&fee===0&&access.keys.length===0&&roles.length===0,'The verified deployment configuration changed.');
 return {...deployment,venue:'Lenz test venue',offer:'Fixed test offer: 2 LTT per LTS',deploymentVerified:true,solverId,solverSourceBalance:solver[0],solverResultBalance:solver[1],ready:BigInt(solver[1])>=2000000n,owner:owner??null,userBalances:user,checkedAt:new Date().toISOString(),scope:'Final public RPC views only; no key load, signature, mint, funding or broadcast.'};
}
