import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {encodeCall} from '../aurora/engine-codec.mjs';
import {inspectEngineTransaction} from '../aurora/engine-receipt.mjs';
import {checkAuroraFundingTransaction} from './intent-aurora-funding.mjs';
import {base64} from './public/intents-vendor/codecs.js';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {checkAuroraSwapPlan,sameAuroraSwapValue} from './public/intent-aurora-plan.js';
import {decodeSignedTransaction} from '../contracts/node_modules/near-api-js/lib/index.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(value,fields)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()===fields.slice().sort().join();
const planTuple='(address beneficiary,address refundRecipient,address relayer,uint256 relayerFee,uint256 minOutput,uint256 deadline,bytes32 salt)';
const abi=new Interface(['function approve(address,uint256)','function deposit(bytes32)',`function fulfill(${planTuple},bytes,bytes32,bytes32)`,`function recover(${planTuple})`,`function withdrawRefund(${planTuple},bytes,bytes32,bytes32)`]);
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const scalar=value=>/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n&&BigInt(value)<field;
export const emptyAuroraSponsorJournal=()=>({version:1,pending:null,completed:[]});
export function checkAuroraSponsorCall(call){
 check(exact(call,['receiverId','methodName','args','gas','deposit'])&&call.receiverId==='aurora'&&call.methodName==='call'&&call.deposit==='0'&&typeof call.args==='string'&&call.args.length<=44000,'The bounded sponsor call changed.');
 const bytes=Buffer.from(base64.decode(call.args));check(bytes.toString('base64')===call.args&&bytes.length>=57&&bytes[0]===0&&bytes.subarray(21,53).every(value=>value===0)&&bytes.readUInt32LE(53)===bytes.length-57,'The sponsor call has noncanonical bytes or native value.');
 const contract='0x'+bytes.subarray(1,21).toString('hex'),input='0x'+bytes.subarray(57).toString('hex');let parsed;try{parsed=abi.parseTransaction({data:input});}catch{}
 check(parsed&&abi.encodeFunctionData(parsed.name,parsed.args)===input,'The sponsor calldata is not canonical.');
 if(contract===d.inputToken)check(parsed.name==='approve'&&parsed.args[0].toLowerCase()===d.pool&&[0n,1000000n].includes(parsed.args[1])&&call.gas==='300000000000000','The sponsor token authority changed.');
 else if(contract===d.pool)check(parsed.name==='deposit'&&scalar(parsed.args[0])&&call.gas==='1000000000000000','The sponsor original deposit changed.');
 else{
  check(contract===d.factory&&['fulfill','recover','withdrawRefund'].includes(parsed.name)&&call.gas==='1000000000000000','The sponsor target or gas authority changed.');
  const value=parsed.args[0],plan={beneficiary:value.beneficiary.toLowerCase(),refundRecipient:value.refundRecipient.toLowerCase(),relayer:value.relayer.toLowerCase(),relayerFee:value.relayerFee.toString(),minOutput:value.minOutput.toString(),deadline:value.deadline.toString(),salt:value.salt};
  checkAuroraSwapPlan(plan);check(plan.beneficiary===plan.refundRecipient,'The sponsor refund recipient changed.');
  if(parsed.name!=='recover')check(/^0x[0-9a-f]{512}$/.test(parsed.args[1])&&scalar(parsed.args[2])&&scalar(parsed.args[3]),'The sponsor original proof changed.');
 }
 return {contract,input};
}
export function inspectAuroraSponsoredTransaction(signed,call,operatorId,result){
 const action=checkAuroraSponsorCall(call);checkAuroraFundingTransaction(signed,call,operatorId);
 if(!result||result.final_execution_status!=='FINAL')return null;
 const inspection=inspectEngineTransaction({version:1,network:'testnet',engine:'aurora',sender:operatorId,txHash:signed.txHash,gas:call.gas,contract:action.contract,value:'0',input:action.input},result,{maxGas:1000000000000000n});
 return {success:inspection.state==='evm_succeeded',transaction:signed.txHash,receiptIds:result.receipts_outcome.map(row=>row.id),execution:inspection.evm??null};
}
export function createAuroraSponsorCoordinator({signer,transport,journal,operatorId,now=Date.now,fundingDailyLimit=5,swapDailyLimit=5,budgetStatus,maxGasPrice='200000000',safetyBalance='50000000000000000000000'}={}){
 check(signer&&transport&&journal&&typeof operatorId==='string'&&operatorId.endsWith('.testnet'),'The shared private sponsor is not configured.');
 const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value),plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
 check(typeof now==='function'&&[fundingDailyLimit,swapDailyLimit].every(value=>Number.isSafeInteger(value)&&value>0&&value<=50)&&(!budgetStatus||typeof budgetStatus==='function')&&uint(maxGasPrice)&&BigInt(maxGasPrice)>0n&&BigInt(maxGasPrice)<=200000000n&&uint(safetyBalance),'The bounded private sponsor budget is invalid.');
 const limits={funding:{actions:3,gas:'1600000000000000',daily:fundingDailyLimit},swap:{actions:2,gas:'2000000000000000',daily:swapDailyLimit}};
 const policy=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{sponsorCapacity:true});};
 const day=()=>{const stamp=now();policy(Number.isSafeInteger(stamp)&&stamp>0,'The sponsor budget clock is unavailable.');return new Date(stamp).toISOString().slice(0,10);};
 function selection(value){
  check(plain(value)&&Object.hasOwn(value,'id')&&Object.hasOwn(value,'kind')&&Object.keys(value).every(key=>['id','kind','retained'].includes(key))&&Object.hasOwn(limits,value.kind)&&typeof value.id==='string'&&new RegExp(value.kind==='funding'?'^aurora-funds:[a-f0-9]{64}$':'^aurora-(?:request|swap):[a-f0-9]{64}$').test(value.id)&&(value.retained===undefined||typeof value.retained==='boolean'),'Keep the original private workflow identity and kind.');return {id:value.id,kind:value.kind,retained:value.retained===true};
 }
 const kindOf=call=>checkAuroraSponsorCall(call).contract===d.factory?'swap':'funding';
 const workflows=state=>Object.values(state.workflows??{}),signing=state=>workflows(state).some(row=>row.signing);
 const charged=state=>state.completed.filter(row=>!row.workflowId).length+(state.pending&&!state.pending.workflowId?1:0)+workflows(state).reduce((sum,row)=>sum+(row.released?row.usedActions:row.actions),0);
 const remainingGas=state=>workflows(state).reduce((sum,row)=>sum+(row.released?0n:BigInt(row.gas)-BigInt(row.usedGas)),0n);
 let queue=Promise.resolve(),actionQueue=Promise.resolve();
 const enqueue=(operation,atomic)=>{const task=(atomic?actionQueue:queue).then(operation);if(atomic)actionQueue=task.catch(()=>{});else queue=task.catch(()=>{});return task;};
 const serialize=operation=>enqueue(operation,false),atomic=operation=>enqueue(operation,true);
 function validate(state){
  check(state?.version===1&&Array.isArray(state.completed)&&state.completed.length<=100&&JSON.stringify(state).length<=2_000_000,'The shared sponsor journal is invalid.');
  if(state.workflows!==undefined){
   check(plain(state.workflows)&&Object.keys(state.workflows).length<=100,'The retained sponsor workflows are invalid.');
   for(const [id,row]of Object.entries(state.workflows)){
    selection({id,kind:row?.kind,retained:row?.retained});const limit=limits[row.kind];check(exact(row,['kind','day','retained','actions','gas','usedActions','usedGas','released','signing'])&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)&&row.actions===limit.actions&&row.gas===limit.gas&&Number.isSafeInteger(row.usedActions)&&row.usedActions>=0&&row.usedActions<=row.actions&&uint(row.usedGas)&&BigInt(row.usedGas)<=BigInt(row.gas)&&typeof row.released==='boolean','The retained sponsor workflow budget changed.');
    if(row.signing)check(exact(row.signing,['call','at'])&&!row.released&&row.usedActions>0&&Number.isSafeInteger(row.signing.at)&&row.signing.at>0&&kindOf(row.signing.call)===row.kind&&BigInt(row.usedGas)>=BigInt(row.signing.call.gas),'The unresolved original sponsor signing fence changed.');else check(row.signing===null,'The retained sponsor signing fence is invalid.');
   }
  }
  const retained=new Map();
  const charge=(id,call)=>{const old=retained.get(id)??{actions:0,gas:0n};old.actions++;old.gas+=BigInt(call.gas);retained.set(id,old);};
  for(const row of [...state.completed,...(state.pending?[state.pending]:[])]){checkAuroraSponsorCall(row.call);checkAuroraFundingTransaction(row.signed,row.call,operatorId);if(row.workflowId!==undefined){check(state.workflows?.[row.workflowId]?.kind===kindOf(row.call)&&state.workflows[row.workflowId].usedActions>0,'The original sponsor transaction lost its workflow reservation.');charge(row.workflowId,row.call);}}
  for(const [id,row]of Object.entries(state.workflows??{}))if(row.signing)charge(id,row.signing.call);
  for(const [id,used]of retained){const row=state.workflows[id];check(row.usedActions>=used.actions&&BigInt(row.usedGas)>=used.gas,'The retained sponsor transactions exceed their workflow action or gas charge.');}
  if(state.pending)check(['signed','submitting','submitted','unknown'].includes(state.pending.state),'The shared pending sponsor state is invalid.');return state;
 }
 async function nativeBudget(state,additional=0n){
  if(!budgetStatus)return;let status;try{status=await budgetStatus();}catch{policy(false,'The bounded sponsor balance could not be verified.');}
  policy(uint(status?.gasPrice)&&BigInt(status.gasPrice)>0n&&BigInt(status.gasPrice)<=BigInt(maxGasPrice)&&uint(status.availableBalance),'The bounded sponsor gas price or balance is unavailable.');
  policy(BigInt(status.availableBalance)>=(remainingGas(state)+additional)*BigInt(maxGasPrice)+BigInt(safetyBalance),'The complete private workflow native gas reserve is unavailable.');
 }
 async function admission(state,kind,retained=false){
  const limit=limits[kind];policy(!state.pending&&!signing(state),'Check the original pending or unresolved sponsor signing request.');policy(Object.keys(state.workflows??{}).length<100&&charged(state)+limit.actions<=100,'The complete workflow exceeds the retained sponsor capacity limit.');
  policy(retained||workflows(state).filter(row=>row.kind===kind&&!row.retained&&row.day===day()).length<limit.daily,'The private test sponsor reached its daily '+kind+' intake limit. Original saved work keeps its reservation.');await nativeBudget(state,BigInt(limit.gas));
 }
 const reservation=(id,row)=>({id,kind:row.kind,day:row.day,reserved:true,remainingActions:row.released?0:row.actions-row.usedActions,remainingGas:row.released?'0':String(BigInt(row.gas)-BigInt(row.usedGas)),released:row.released});
 async function reserve(state,value){
  policy(charged(state)<=100,'The retained sponsor capacity limit needs review before another reservation.');const chosen=selection(value),old=state.workflows?.[chosen.id];if(old){check(old.kind===chosen.kind,'The original sponsor workflow kind changed.');return reservation(chosen.id,old);}
  await admission(state,chosen.kind,chosen.retained);const limit=limits[chosen.kind];state.workflows??={};state.workflows[chosen.id]={kind:chosen.kind,day:day(),retained:chosen.retained,actions:limit.actions,gas:limit.gas,usedActions:0,usedGas:'0',released:false,signing:null};await journal.write(state);return reservation(chosen.id,state.workflows[chosen.id]);
 }
 async function capacity(kind){return atomic(async()=>{check(Object.hasOwn(limits,kind),'Choose a private funding or swap workflow.');try{await admission(validate(await journal.read()),kind);return {available:true,reason:''};}catch(error){return {available:false,reason:error.sponsorCapacity?error.message:'The retained private sponsor budget could not be verified.'};}});}
 async function reserveWorkflow(value){return atomic(async()=>reserve(validate(await journal.read()),value));}
 async function release(id,unused){return atomic(async()=>{
  const state=validate(await journal.read()),row=Object.hasOwn(state.workflows??{},id)?state.workflows[id]:null;if(!row)return;if(unused)policy(row.usedActions===0&&row.usedGas==='0'&&!row.signing,'An original consumed sponsor authority cannot be released as unstarted.');if(row.released)return;policy(!state.pending&&!signing(state),'Check the original pending sponsor transaction before releasing its reservation.');row.released=true;await journal.write(state);
 });}
 const releaseWorkflow=id=>release(id,false),releaseUnusedWorkflow=id=>release(id,true);
 async function pending(){return structuredClone(validate(await journal.read()).pending);}
 async function signTransaction(call,value){return atomic(async()=>{
  checkAuroraSponsorCall(call);const state=validate(await journal.read());policy(charged(state)<=100,'The retained sponsor capacity limit needs review before another signature.');check(!state.pending&&!signing(state),'Check the original shared sponsor transaction or signing fence before signing another.');let chosen,row;
  if(value!==undefined){chosen=selection(value);check(kindOf(call)===chosen.kind,'The sponsor call belongs to another workflow kind.');await reserve(state,chosen);row=state.workflows[chosen.id];check(!row.released&&row.usedActions<row.actions&&BigInt(row.usedGas)+BigInt(call.gas)<=BigInt(row.gas),'The original workflow action or gas reservation is exhausted.');await nativeBudget(state);
   // A lost native signature or journal write keeps this charged signing fence.
   row.usedActions++;row.usedGas=String(BigInt(row.usedGas)+BigInt(call.gas));row.signing={call:structuredClone(call),at:now()};await journal.write(state);
  }else check(!budgetStatus&&charged(state)<100,'The bounded sponsor requires an original workflow reservation.');
  const signed=await signer.signTransaction(call);checkAuroraFundingTransaction(signed,call,operatorId);if(row)row.signing=null;state.pending={call:structuredClone(call),signed:structuredClone(signed),state:'signed',...(chosen?{workflowId:chosen.id}:{})};await journal.write(state);return signed;
 });}
 async function send(bytes){return atomic(async()=>{
  const state=validate(await journal.read()),original=state.pending;check(original?.signed.bytes===bytes&&original.state==='signed','The original sponsor transaction was already submitted or changed.');
  original.state='submitting';await journal.write(state);let result;
  try{result=await transport.send(bytes);if(result?.final_execution_status==='FINAL')inspectAuroraSponsoredTransaction(original.signed,original.call,operatorId,result);}catch(error){original.state='unknown';await journal.write(state);throw error;}
  original.state='submitted';await journal.write(state);return result;
 });}
 async function transaction(txHash,senderId){
  const state=validate(await journal.read()),original=state.pending?.signed.txHash===txHash?state.pending:state.completed.find(row=>row.signed.txHash===txHash);check(senderId===operatorId&&original,'Choose the original retained sponsor transaction.');const result=await transport.transaction(txHash,senderId);if(result?.final_execution_status==='FINAL')inspectAuroraSponsoredTransaction(original.signed,original.call,operatorId,result);return result;
 }
 async function settle(signed,receipt){return atomic(async()=>{
  const state=validate(await journal.read());if(state.completed.some(row=>sameAuroraSwapValue(row.signed,signed)&&sameAuroraSwapValue(row.receipt,receipt)))return;
  check(typeof receipt?.success==='boolean'&&receipt.transaction===signed.txHash&&Array.isArray(receipt.receiptIds)&&state.completed.length<100,'The original sponsor completion changed.');
  let original=state.pending?.signed.txHash===signed.txHash?state.pending:null;
  if(original)check(sameAuroraSwapValue(original.signed,signed),'The original sponsor signature changed.');
  else{const decoded=decodeSignedTransaction(base64.decode(signed.bytes)),action=decoded.transaction.actions[0]?.functionCall;check(action,'The original historical sponsor call is unavailable.');const call={receiverId:'aurora',methodName:action.methodName,args:base64.encode(Uint8Array.from(action.args)),gas:action.gas.toString(),deposit:action.deposit.toString()};checkAuroraSponsorCall(call);checkAuroraFundingTransaction(signed,call,operatorId);original={call,signed};}
  const verified=inspectAuroraSponsoredTransaction(signed,original.call,operatorId,await transport.transaction(signed.txHash,operatorId));check(verified&&verified.success===receipt.success&&sameAuroraSwapValue(verified.receiptIds,receipt.receiptIds),'The final shared sponsor receipt changed.');
  state.completed.push({call:original.call,signed:original.signed,receipt:structuredClone(receipt),...(original.workflowId?{workflowId:original.workflowId}:{})});if(state.pending?.signed.txHash===signed.txHash)state.pending=null;await journal.write(state);
 });}
 return Object.freeze({serialize,pending,capacity,reserveWorkflow,releaseWorkflow,releaseUnusedWorkflow,signTransaction,send,transaction,settle});
}
