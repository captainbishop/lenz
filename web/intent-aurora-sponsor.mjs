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
export function createAuroraSponsorCoordinator({signer,transport,journal,operatorId}={}){
 check(signer&&transport&&journal&&typeof operatorId==='string'&&operatorId.endsWith('.testnet'),'The shared private sponsor is not configured.');
 let queue=Promise.resolve(),actionQueue=Promise.resolve();
 const enqueue=(operation,atomic)=>{const task=(atomic?actionQueue:queue).then(operation);if(atomic)actionQueue=task.catch(()=>{});else queue=task.catch(()=>{});return task;};
 const serialize=operation=>enqueue(operation,false),atomic=operation=>enqueue(operation,true);
 function validate(state){
  check(state?.version===1&&Array.isArray(state.completed)&&state.completed.length<=100&&JSON.stringify(state).length<=2_000_000,'The shared sponsor journal is invalid.');
  for(const row of [...state.completed,...(state.pending?[state.pending]:[])]){checkAuroraSponsorCall(row.call);checkAuroraFundingTransaction(row.signed,row.call,operatorId);}
  if(state.pending)check(['signed','submitting','submitted','unknown'].includes(state.pending.state),'The shared pending sponsor state is invalid.');return state;
 }
 async function pending(){return structuredClone(validate(await journal.read()).pending);}
 async function signTransaction(call){return atomic(async()=>{
  checkAuroraSponsorCall(call);const state=validate(await journal.read());check(!state.pending,'Check the original shared sponsor transaction before signing another.');check(state.completed.length<100,'The shared sponsor journal limit was reached.');
  const signed=await signer.signTransaction(call);checkAuroraFundingTransaction(signed,call,operatorId);state.pending={call:structuredClone(call),signed:structuredClone(signed),state:'signed'};await journal.write(state);return signed;
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
  state.completed.push({call:original.call,signed:original.signed,receipt:structuredClone(receipt)});if(state.pending?.signed.txHash===signed.txHash)state.pending=null;await journal.write(state);
 });}
 return Object.freeze({serialize,pending,signTransaction,send,transaction,settle});
}
