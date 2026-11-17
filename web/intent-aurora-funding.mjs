import {createHash,createPublicKey,verify,randomBytes} from 'node:crypto';
import {decodeSignedTransaction,encodeTransaction} from '../contracts/node_modules/near-api-js/lib/index.js';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {verifyNep413} from '../integrations/intent-testnet/swap.mjs';
import {encodeCall,decodeSubmitResult} from '../aurora/engine-codec.mjs';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './public/intent-aurora-config.js';
import {buildAuroraFundingReview,checkAuroraFundingReview,checkAuroraFundingSigned,AURORA_FUNDING_DISCLOSURE} from './public/intent-aurora-funding-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const hash=value=>createHash('sha256').update(value).digest();
const abi=new Interface(['function approve(address,uint256) returns(bool)','function deposit(bytes32)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);
const empty=()=>({version:1,grants:{},pending:null});
export const emptyAuroraFundingJournal=empty;
export function auroraFundingStorageId(review){checkAuroraFundingReview(review,{allowExpired:true});return 'aurora-funds:'+hash(review.payload.message).toString('hex');}
function checkJournal(state){
 check(state?.version===1&&state.grants&&typeof state.grants==='object'&&!Array.isArray(state.grants)&&Object.keys(state.grants).length<=50&&JSON.stringify(state).length<=2_000_000,'The retained private funding journal is invalid.');
 for(const [id,row]of Object.entries(state.grants)){check(id===row.review?.id&&row.signed&&Array.isArray(row.stages)&&row.stages.length<=3&&['pending','confirmed','failed'].includes(row.state),'The retained private funding request is invalid.');checkAuroraFundingReview(row.review,{allowExpired:true});checkAuroraFundingSigned(row.signed,row.review);check(verifyNep413(row.signed),'The retained funding signature is invalid.');
  for(const [index,stage]of row.stages.entries()){check((stage.stage===index||row.cancelled===true&&index===1&&stage.stage===2)&&equal(stage.call,fundingCall(stage.stage,row.review.commitment)),'The retained private funding stage changed.');if(!stage.receipt)check(state.pending?.id===id&&(state.pending.index??state.pending.stage)===index&&state.pending.stage===stage.stage&&equal(state.pending.signed,stage.signed)&&equal(state.pending.call,stage.call),'The unresolved private transaction fence is missing.');}
 }
 if(state.pending)check(state.grants[state.pending.id]?.stages[state.pending.index??state.pending.stage]&&!state.grants[state.pending.id].stages[state.pending.index??state.pending.stage].receipt,'The original pending private transaction is missing.');
 return state;
}
export function checkAuroraFundingTransaction(signed,call,operator){
 check(typeof signed?.bytes==='string'&&Buffer.from(signed.bytes,'base64').toString('base64')===signed.bytes,'The retained funding transaction is invalid.');
 const decoded=decodeSignedTransaction(Buffer.from(signed.bytes,'base64')),tx=decoded.transaction,action=tx.actions[0]?.functionCall,digest=hash(encodeTransaction(tx));
 check(signed.senderId===operator&&tx.signerId===operator&&tx.receiverId==='aurora'&&tx.actions.length===1&&action?.methodName==='call'&&base64.encode(Uint8Array.from(action.args))===call.args&&action.gas.toString()===call.gas&&action.deposit===0n&&base58.encode(digest)===signed.txHash,'The retained funding transaction changed its exact call.');
 check(tx.publicKey.keyType===0&&decoded.signature.ed25519Signature?.data?.length===64&&verify(null,digest,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(tx.publicKey.data)]),type:'spki',format:'der'}),Buffer.from(decoded.signature.ed25519Signature.data)),'The retained operator signature is invalid.');return decoded;
}
function fundingCall(stage,commitment){
 const target=stage===1?deployment.pool:deployment.inputToken,name=stage===1?'deposit':'approve',args=stage===1?[commitment]:[deployment.pool,stage===0?BigInt(deployment.denomination):0n];
 const input=Buffer.from(abi.encodeFunctionData(name,args).slice(2),'hex');
 return {receiverId:'aurora',methodName:'call',args:base64.encode(encodeCall({contract:target,input})),gas:stage===1?'1000000000000000':'300000000000000',deposit:'0'};
}
export function createAuroraFundingService({rpc,signer,journal,operatorId,operatorAddress,now=Date.now,random=size=>randomBytes(size),maxGrants=5,serialize}={}){
 check(rpc&&signer&&journal&&typeof operatorId==='string'&&operatorId.endsWith('.testnet')&&/^0x[0-9a-f]{40}$/.test(operatorAddress)&&Number.isSafeInteger(maxGrants)&&maxGrants>0&&maxGrants<=50,'The private test faucet is not configured.');
 let queue=Promise.resolve();const serial=serialize??(operation=>{const task=queue.then(operation);queue=task.catch(()=>{});return task;});
 async function fundingState(){
  const [snapshot,operator]=await Promise.all([rpc.snapshot({owner:operatorAddress}),rpc.operatorState()]);
  check(snapshot.network==='testnet'&&snapshot.chainId===deployment.chainHex&&snapshot.pool.address===deployment.pool&&snapshot.source?.owner===operatorAddress&&snapshot.pool.denomination===deployment.denomination,'The verified private funding route changed.');
  check(operator.accountId===operatorId&&operator.address===operatorAddress&&operator.engineVerified===true&&typeof operator.maxGas==='string'&&/^[0-9]{1,20}$/.test(operator.maxGas)&&BigInt(operator.maxGas)>=1000000000000000n,'The high-gas testnet funding path changed.');
  check(Object.entries(deployment.codeSha256).every(([name,digest])=>snapshot.codes?.[name]===digest),'The verified private funding code changed.');
  return {snapshot,operator};
 }
 async function configuration(){
  const state=checkJournal(await journal.read()),{snapshot,operator}=await fundingState(),used=Object.values(state.grants).filter(row=>!row.cancelled||!row.cleanupComplete).length,capacity=await signer.capacity?.('funding');
  const available=!state.pending&&Object.keys(state.grants).length<50&&(capacity?capacity.available:used<maxGrants)&&BigInt(snapshot.source.inputBalance)>=BigInt(deployment.denomination)&&BigInt(snapshot.venue.outputBalance)>=BigInt(deployment.outputAmount)&&operator.gasReady===true&&operator.allowance==='0';
  return {available,network:'testnet',chainId:deployment.chainId,pool:deployment.pool,asset:deployment.inputToken,amount:deployment.denomination,operator:operatorAddress,privacy:'pool-withdrawal',disclosure:AURORA_FUNDING_DISCLOSURE,reason:available?'':state.pending?'Check the original private funding transaction.':Object.keys(state.grants).length>=50?'Private test funding is paused while its retained history is reviewed.':capacity&&!capacity.available?capacity.reason:!capacity&&used>=maxGrants?'The private test faucet needs replenishing.':'The private test faucet needs verified token inventory, gas and a cleared allowance.'};
 }
 async function prepare({owner,commitment}){return serial(async()=>{
  const state=checkJournal(await journal.read());check(!Object.values(state.grants).some(row=>(row.review.owner===owner||row.review.commitment===commitment)&&(!row.cancelled||!row.cleanupComplete)),'Check the original grant for this account or commitment.');
  check((await configuration()).available,'The verified private test faucet is unavailable.');
  return buildAuroraFundingReview(owner,{commitment,nonce:base64.encode(random(32)),deadline:now()+300000},{now:now()});
 });}
 function outcome(row){
  const deposit=row.stages.find(stage=>stage.stage===1)?.receipt;
  return {id:row.review.id,commitment:row.review.commitment,state:row.state,funded:!!deposit?.success,verified:!!deposit?.success,network:'testnet',chainId:deployment.chainId,pool:deployment.pool,asset:deployment.inputToken,amount:deployment.denomination,
   ...(deposit?.success?{deposit:{transaction:deposit.transaction,receiptIds:deposit.receiptIds,index:deposit.index,commitment:row.review.commitment,pool:deployment.pool}}:{}),cleanupComplete:row.state==='confirmed'||row.cleanupComplete===true,cancelled:row.cancelled===true,stages:row.stages.map(stage=>({stage:stage.stage,transaction:stage.signed.txHash,...(stage.receipt?{success:stage.receipt.success}:{} )}))};
 }
 async function unretainedCancellation(state,review,signed){
  check(review.deadline<=now(),'An active unsubmitted grant cannot be cancelled here.');
  check(!Object.values(state.grants).some(saved=>(saved.review.owner===review.owner||saved.review.commitment===review.commitment)&&(!saved.cancelled||!saved.cleanupComplete)),'Check the original grant for this account or commitment.');
  // Dispatch always requires a retained row. An absent, expired permission
  // can no longer dispatch and needs no persistent cancellation entry.
  await signer.releaseUnusedWorkflow?.(auroraFundingStorageId(review));return outcome({review,signed,state:'failed',stages:[],cancelled:true,cleanupComplete:true});
 }
 function finalReceipt(result,pending){
  if(!result||result.final_execution_status!=='FINAL')return null;
  check(result.transaction?.hash===pending.signed.txHash&&result.transaction.signer_id===operatorId&&result.transaction.receiver_id==='aurora'&&result.transaction.actions?.length===1,'The private funding receipt belongs to another transaction.');
  const call=result.transaction.actions[0].FunctionCall;check(call?.method_name==='call'&&call.args===pending.call.args&&String(call.gas)===pending.call.gas&&String(call.deposit)==='0','The private funding receipt changed its call.');
  check(Array.isArray(result.receipts_outcome)&&result.receipts_outcome.length>0&&result.receipts_outcome.every(row=>typeof row.id==='string'),'The private funding receipt list is invalid.');
  const receiptIds=result.receipts_outcome.map(row=>row.id),failed=Object.hasOwn(result.status??{},'Failure')||result.receipts_outcome.some(row=>Object.hasOwn(row.outcome?.status??{},'Failure'));
  if(failed)return {success:false,transaction:pending.signed.txHash,receiptIds};
  check(typeof result.status?.SuccessValue==='string','The final private funding result is unavailable.');
  const execution=decodeSubmitResult(Buffer.from(result.status.SuccessValue,'base64'));if(!execution.succeeded)return {success:false,transaction:pending.signed.txHash,receiptIds};
  if(pending.stage!==1)return {success:true,transaction:pending.signed.txHash,receiptIds};
  const events=execution.logs.filter(log=>log.address===deployment.pool).map(log=>{try{return abi.parseLog(log);}catch{return null;}}).filter(event=>event?.name==='Deposit');
  check(events.length===1&&events[0].args.commitment.toLowerCase()===pending.commitment&&events[0].args.leafIndex<4096n,'The pool receipt did not deposit the original commitment.');
  return {success:true,transaction:pending.signed.txHash,receiptIds,index:Number(events[0].args.leafIndex)};
 }
 async function finish(state,row,result){
  const pending=state.pending;check(pending?.id===row.review.id,'Another private funding operation is pending.');checkAuroraFundingTransaction(pending.signed,pending.call,operatorId);
  const receipt=finalReceipt(result,pending);if(!receipt)return outcome(row);
  row.stages[pending.index??pending.stage].receipt=receipt;state.pending=null;if(!receipt.success)row.state='failed';else if(pending.stage===2){row.state=row.cancelled?'failed':'confirmed';row.cleanupComplete=true;}
  await journal.write(state);await rpc.settle?.(pending.signed,receipt);if(row.cleanupComplete)await signer.releaseWorkflow?.(auroraFundingStorageId(row.review));return outcome(row);
 }
 async function advance(state,row){
  while(row.state==='pending'&&!state.pending&&row.stages.length<3){
   const stage=row.stages.length;check(stage===2||row.review.deadline>now(),'The original private funding permission expired.');
   const {snapshot,operator}=await fundingState();check(operator.gasReady===true&&(stage===2||BigInt(snapshot.source.inputBalance)>=BigInt(deployment.denomination)),'The operator token or gas budget is unavailable.');
   check(stage!==0||operator.allowance==='0','Clear the operator allowance before creating a new grant.');check(stage!==1||operator.allowance===deployment.denomination,'The original pool allowance changed.');
   const call=fundingCall(stage,row.review.commitment),signed=await signer.signTransaction(call,{id:auroraFundingStorageId(row.review),kind:'funding',retained:row.stages.length>0});checkAuroraFundingTransaction(signed,call,operatorId);
   row.stages.push({stage,call,signed,receipt:null});state.pending={id:row.review.id,commitment:row.review.commitment,stage,index:stage,call,signed};await journal.write(state);
   let result;try{result=await rpc.send(signed.bytes);}catch{return outcome(row);}
   await finish(state,row,result);
  }
  return outcome(row);
 }
 async function submit({review,signed}){return serial(async()=>{
  checkAuroraFundingReview(review,{now:now()});checkAuroraFundingSigned(signed,review);check(verifyNep413(signed),'The private funding signature is invalid.');const state=checkJournal(await journal.read());let row=state.grants[review.id];
  if(row){check(equal(row.review,review)&&equal(row.signed,signed),'The original private funding request changed.');return outcome(row);}
  check((await configuration()).available,'The verified private test faucet is unavailable.');check(Object.keys(state.grants).length<50,'The retained private funding request limit was reached.');check(!Object.values(state.grants).some(row=>(row.review.owner===review.owner||row.review.commitment===review.commitment)&&(!row.cancelled||!row.cleanupComplete)),'Check the original grant for this account or commitment.');
  await signer.reserveWorkflow?.({id:auroraFundingStorageId(review),kind:'funding',retained:false});row={review:structuredClone(review),signed:structuredClone(signed),state:'pending',stages:[]};state.grants[review.id]=row;await journal.write(state);return advance(state,row);
 });}
 async function reconcile({review,signed}){return serial(async()=>{
  checkAuroraFundingReview(review,{allowExpired:true});checkAuroraFundingSigned(signed,review);check(verifyNep413(signed),'The private funding signature is invalid.');const state=checkJournal(await journal.read()),row=state.grants[review.id];
  if(!row)return unretainedCancellation(state,review,signed);
  check(equal(row.review,review)&&equal(row.signed,signed),'The original retained private funding request is unavailable.');
  if(!state.pending){const last=row.stages.at(-1);if(last?.receipt)await rpc.settle?.(last.signed,last.receipt);if(row.cleanupComplete)await signer.releaseWorkflow?.(auroraFundingStorageId(row.review));return outcome(row);}check(state.pending.id===row.review.id,'Check the original pending private funding request.');let result;try{result=await rpc.transaction(state.pending.signed.txHash,operatorId);}catch{return outcome(row);}return finish(state,row,result);
 });}
 async function resume({review,signed}){return serial(async()=>{
  checkAuroraFundingReview(review,{allowExpired:true});checkAuroraFundingSigned(signed,review);check(verifyNep413(signed),'The private funding signature is invalid.');const state=checkJournal(await journal.read()),row=state.grants[review.id];
  check(row&&equal(row.review,review)&&equal(row.signed,signed)&&!state.pending,'Check the original pending private funding transaction.');return row.cancelled?outcome(row):advance(state,row);
 });}
 async function cleanup({review,signed}){return serial(async()=>{
  checkAuroraFundingReview(review,{allowExpired:true});checkAuroraFundingSigned(signed,review);check(verifyNep413(signed),'The private funding signature is invalid.');const state=checkJournal(await journal.read());let row=state.grants[review.id];
  check(!state.pending,'Check the original pending private funding transaction.');
  if(!row){
   return unretainedCancellation(state,review,signed);
  }
  check(equal(row.review,review)&&equal(row.signed,signed),'The original private funding request changed.');
  const deposit=row.stages.find(stage=>stage.stage===1);check(!deposit||deposit.receipt?.success===false,'A pool deposit may have been submitted. Check the original request.');if(row.cleanupComplete)return outcome(row);
  const {operator}=await fundingState();check(operator.allowance==='0'||operator.allowance===deployment.denomination,'The original private pool allowance changed.');
  row.cancelled=true;row.state='failed';await journal.write(state);
  if(operator.allowance==='0'){row.cleanupComplete=true;await journal.write(state);await signer.releaseWorkflow?.(auroraFundingStorageId(row.review));return outcome(row);}
  check((row.stages.length===1||row.stages.length===2&&deposit?.receipt?.success===false)&&row.stages[0].receipt?.success===true,'The original approval must be finally verified before clearing it.');
  const call=fundingCall(2,row.review.commitment),operatorSigned=await signer.signTransaction(call,{id:auroraFundingStorageId(row.review),kind:'funding',retained:true});checkAuroraFundingTransaction(operatorSigned,call,operatorId);
  const index=row.stages.length;row.stages.push({stage:2,call,signed:operatorSigned,receipt:null});state.pending={id:row.review.id,commitment:row.review.commitment,stage:2,index,call,signed:operatorSigned};await journal.write(state);
  let result;try{result=await rpc.send(operatorSigned.bytes);}catch{return outcome(row);}return finish(state,row,result);
 });}
 return Object.freeze({configuration,prepare,submit,reconcile,resume,cleanup});
}
