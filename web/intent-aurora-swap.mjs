import {Interface,keccak256,toUtf8Bytes} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {encodeCall} from '../aurora/engine-codec.mjs';
import {base64} from './public/intents-vendor/codecs.js';
import {AURORA_INTENT_DEPLOYMENT as d,AURORA_INTENT_PRIVACY} from './public/intent-aurora-config.js';
import {checkAuroraSwapPlan,checkAuroraSwapSnapshot,auroraVaultAddress,sameAuroraSwapValue} from './public/intent-aurora-plan.js';
import {checkAuroraFundingTransaction} from './intent-aurora-funding.mjs';
import {inspectAuroraSponsoredTransaction} from './intent-aurora-sponsor.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(value,fields)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()===fields.slice().sort().join();
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const scalar=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n&&BigInt(value)<field;
const amount=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<(1n<<256n);
export const AURORA_SWAP_GAS='1000000000000000';
export const emptyAuroraSwapJournal=()=>({version:1,requests:{},pending:null});
const planTuple='(address beneficiary,address refundRecipient,address relayer,uint256 relayerFee,uint256 minOutput,uint256 deadline,bytes32 salt)';
export const AURORA_SWAP_ABI=new Interface([`function fulfill(${planTuple},bytes,bytes32,bytes32)`,`function recover(${planTuple})`,`function withdrawRefund(${planTuple},bytes,bytes32,bytes32)`]);
const events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)']);

export function checkAuroraSwapPreparation(value){
 check(exact(value,['plan','vault','root','nullifierHash']),'The public private-swap selection changed.');
 const plan=checkAuroraSwapPlan(value.plan);check(plan.beneficiary===plan.refundRecipient,'Use the same recoverable receiving and refund account.');
 check(value.vault===auroraVaultAddress(plan),'The deterministic private vault changed.');check(scalar(value.root)&&scalar(value.nullifierHash),'The original private root or nullifier is invalid.');
 return {plan,vault:value.vault,root:value.root,nullifierHash:value.nullifierHash};
}
const selection=checkAuroraSwapPreparation;
export function checkAuroraSwapPublicRequest(value){
 check(exact(value,['id','artifactId','plan','vault','root','nullifierHash','proof','publicSignals'])&&/^aurora-swap:[0-9a-f]{64}$/.test(value.id),'The original public private-swap request changed.');
 selection({plan:value.plan,vault:value.vault,root:value.root,nullifierHash:value.nullifierHash});
 const signals=[value.root,value.nullifierHash,value.vault,value.plan.relayer,'0','0'].map(v=>BigInt(v).toString());
 check(typeof value.proof==='string'&&/^0x[0-9a-f]{512}$/.test(value.proof)&&sameAuroraSwapValue(value.publicSignals,signals),'The original proof authorized different public signals.');
 const artifact='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:value.id,proof:value.proof,publicSignals:signals}))).slice(2);
 check(value.artifactId===artifact,'The original private proof artifact changed.');return structuredClone(value);
}
export function auroraSwapCall(request,operation='fulfill'){
 checkAuroraSwapPublicRequest(request);check(['fulfill','recover','withdrawRefund'].includes(operation),'Choose an explicit original private-swap action.');
 const data=AURORA_SWAP_ABI.encodeFunctionData(operation,operation==='recover'?[request.plan]:[request.plan,request.proof,request.root,request.nullifierHash]);
 return {receiverId:'aurora',methodName:'call',args:base64.encode(encodeCall({contract:d.factory,input:Buffer.from(data.slice(2),'hex')})),gas:AURORA_SWAP_GAS,deposit:'0'};
}
function vaultBindings(vault,request){
 check(vault?.deployed===true&&vault.bindingsVerified===true&&Object.entries({inputToken:d.inputToken,outputToken:d.outputToken,adapter:d.adapter,inputAmount:d.denomination,minOutput:request.plan.minOutput,deadline:request.plan.deadline,beneficiary:request.plan.beneficiary,refundRecipient:request.plan.refundRecipient,chainId:String(d.chainId)}).every(([key,value])=>vault[key]===value),'The original vault immutable terms or code bindings changed.');
}
function evidence(request,receipt,status){return {network:'testnet',verifier:'Aurora original factory',transaction:receipt.transaction,receiptIds:receipt.receiptIds,inputAsset:d.inputToken,inputAmount:d.denomination,outputAsset:d.outputToken,outputAmount:status==='executed'?d.outputAmount:'0',beneficiary:request.plan.beneficiary,vault:request.vault,nullifierHash:request.nullifierHash,allowance:'0',...(status==='refunded'?{refundRecipient:request.plan.refundRecipient,refundAsset:d.inputToken,refundAmount:d.denomination}:{}),description:status==='executed'?'The original withdrawal, fixed-rate swap and recipient credit are finally verified.':'The original note returned to its fixed refund account.'};}
function checkedLogs(execution,request,status,operation){
 const logs=execution.logs.map(log=>{let parsed;try{parsed=events.parseLog(log);}catch{}return {address:log.address,parsed};});
 if(operation!=='recover'){
  const withdrawals=logs.filter(log=>log.address===d.pool&&log.parsed?.name==='Withdrawal');check(withdrawals.length===1&&withdrawals[0].parsed.args.to.toLowerCase()===request.vault&&withdrawals[0].parsed.args.nullifierHash===request.nullifierHash&&withdrawals[0].parsed.args.relayer.toLowerCase()===request.plan.relayer&&withdrawals[0].parsed.args.fee===0n,'The final original withdrawal belongs to another note or vault.');
 }
 const transfer=(asset,from,to,amount)=>check(logs.filter(log=>log.address===asset&&log.parsed?.name==='Transfer'&&log.parsed.args.from.toLowerCase()===from&&log.parsed.args.to.toLowerCase()===to&&log.parsed.args.value===BigInt(amount)).length===1,'The original private asset transfer or recipient credit is missing.');
 if(operation!=='recover')transfer(d.inputToken,d.pool,request.vault,d.denomination);
 if(status==='executed'){transfer(d.inputToken,request.vault,d.adapter,d.denomination);transfer(d.outputToken,d.adapter,request.vault,d.outputAmount);transfer(d.outputToken,request.vault,request.plan.beneficiary,d.outputAmount);}
 else transfer(d.inputToken,request.vault,request.plan.refundRecipient,d.denomination);
}
export function createAuroraSwapService({rpc,signer,journal,operatorId,operatorAddress,now=Date.now,serialize,maxRequests=5}={}){
 check(rpc&&signer&&journal&&typeof operatorId==='string'&&operatorId.endsWith('.testnet')&&/^0x[0-9a-f]{40}$/.test(operatorAddress)&&Number.isSafeInteger(maxRequests)&&maxRequests>0&&maxRequests<=50,'The private swap sponsor is not configured.');
 let queue=Promise.resolve();const serial=serialize??(operation=>{const task=queue.then(operation);queue=task.catch(()=>{});return task;});
 function checkJournal(state){
  check(state?.version===1&&state.requests&&Object.getPrototypeOf(state.requests)===Object.prototype&&Object.keys(state.requests).length<=50&&JSON.stringify(state).length<=2_000_000,'The retained private swap journal is invalid.');
  for(const [id,row]of Object.entries(state.requests)){
   check(id===row.request?.id&&['pending','unknown','executed','refunded'].includes(row.status)&&Array.isArray(row.stages)&&row.stages.length<=2&&amount(row.before?.outputBalance)&&amount(row.before?.inputBalance)&&(!['executed','refunded'].includes(row.status)||row.outcome),'The retained private swap request is invalid.');checkAuroraSwapPublicRequest(row.request);
   for(const [index,stage]of row.stages.entries()){
    check(sameAuroraSwapValue(stage.call,auroraSwapCall(row.request,stage.operation)),'The retained private swap call changed.');checkAuroraFundingTransaction(stage.signed,stage.call,operatorId);
    if(!stage.receipt)check(state.pending?.id===id&&state.pending.index===index&&state.pending.operation===stage.operation&&sameAuroraSwapValue(state.pending.signed,stage.signed)&&sameAuroraSwapValue(state.pending.call,stage.call),'The unresolved original private-swap fence is missing.');
    else{const verified=inspectAuroraSponsoredTransaction(stage.signed,stage.call,operatorId,stage.receipt.result);check(verified&&verified.success===stage.receipt.success&&sameAuroraSwapValue(verified.receiptIds,stage.receipt.receiptIds)&&stage.receipt.transaction===stage.signed.txHash,'The retained original receipt changed.');if(stage.receipt.success&&index===row.stages.length-1&&row.outcome){checkedLogs(verified.execution,row.request,row.status,stage.operation);check(sameAuroraSwapValue(row.outcome,{intentId:id,artifactId:row.request.artifactId,status:row.status,verified:true,evidence:evidence(row.request,stage.receipt,row.status)}),'The retained verified private outcome changed.');}}
   }
  }
  if(state.pending)check(state.requests[state.pending.id]?.stages[state.pending.index]&&!state.requests[state.pending.id].stages[state.pending.index].receipt,'The original pending private swap is missing.');return state;
 }
 const outcome=row=>row.outcome?structuredClone(row.outcome):({intentId:row.request.id,artifactId:row.request.artifactId,status:row.status,verified:false,...(row.statusCheck?{recovery:{available:!!row.statusCheck.operation,operation:row.statusCheck.operation,checkedAt:row.statusCheck.checkedAt}}:{})});
 function checkOperator(operator){check(operator.accountId===operatorId&&operator.address===operatorAddress&&operator.engineVerified===true&&typeof operator.maxGas==='string'&&/^[0-9]{1,20}$/.test(operator.maxGas)&&BigInt(operator.maxGas)>=BigInt(AURORA_SWAP_GAS),'The bounded private sponsor identity, code or gas authority changed.');}
 async function observedState(request,options){const state=await rpc.swapState(request,options);checkAuroraSwapSnapshot(state.snapshot,{now:now(),requireVenueFunding:options?.requireVenueFunding===true});check(Math.abs(now()-state.snapshot.block.timestamp)<=120000,'The final private chain snapshot is stale.');check(state.factoryVault===request.vault&&state.factoryBindingsVerified===true,'The onchain factory vault or immutable code binding changed.');check(amount(state.beneficiaryOutputBalance)&&amount(state.beneficiaryInputBalance)&&amount(state.vault?.inputBalance)&&amount(state.vault.outputBalance)&&amount(state.vault.allowance),'The original private balances are invalid.');if(state.vault.deployed)vaultBindings(state.vault,request);return state;}
 async function preflight(chosen){
  const [state,operator]=await Promise.all([observedState(chosen,{requireVenueFunding:true}),rpc.operatorState()]);checkOperator(operator);check(operator.gasReady===true&&operator.allowance==='0','The bounded private sponsor gas or authority is unavailable.');
  check(BigInt(chosen.plan.deadline)*1000n>BigInt(now())&&BigInt(chosen.plan.deadline)*1000n<=BigInt(now()+300000),'Review an active private swap deadline.');
  check(state.knownRoot===true&&state.spent===false,'The original private note is spent or its root is unknown.');
  check(BigInt(state.snapshot.pool.inputBalance)>=BigInt(d.denomination),'The original private pool has insufficient input funds.');
  check(state.vault&&(state.vault.status===null||state.vault.status===0)&&state.vault.inputBalance==='0'&&state.vault.outputBalance==='0'&&state.vault.allowance==='0','Check the original funded or resolved private vault.');
  if(state.vault.deployed)vaultBindings(state.vault,chosen);
  return state;
 }
 async function configuration(){
  const [state,snapshot,operator]=await Promise.all([journal.read(),rpc.snapshot(),rpc.operatorState()]);checkJournal(state);checkAuroraSwapSnapshot(snapshot,{now:now()});checkOperator(operator);
  const available=!state.pending&&Object.keys(state.requests).length<maxRequests&&operator.gasReady===true&&operator.allowance==='0'&&BigInt(operator.maxGas)>=BigInt(AURORA_SWAP_GAS)&&BigInt(snapshot.pool.inputBalance)>=BigInt(d.denomination);
  return {available,execute:available,network:'testnet',routeId:d.routeId,inputAsset:d.inputToken,inputAmount:d.denomination,outputAsset:d.outputToken,outputAmount:d.outputAmount,privacyDisclosure:AURORA_INTENT_PRIVACY,reason:available?'':'Check the original private request or replenish verified sponsor gas and pool inventory.'};
 }
 async function prepare(value){return serial(async()=>{const chosen=selection(value),state=checkJournal(await journal.read());check(!state.pending&&Object.keys(state.requests).length<maxRequests,'Check the original pending private request.');await preflight(chosen);return {...chosen,available:true,execute:true,network:'testnet',inputAsset:d.inputToken,inputAmount:d.denomination,outputAsset:d.outputToken,outputAmount:d.outputAmount,privacyDisclosure:AURORA_INTENT_PRIVACY};});}
 async function finish(state,row,result){
  const pending=state.pending;check(pending?.id===row.request.id,'Another original private request is pending.');const receipt=inspectAuroraSponsoredTransaction(pending.signed,pending.call,operatorId,result);if(!receipt)return outcome(row);
  const stage=row.stages[pending.index];stage.finalResult=structuredClone(result);await journal.write(state);
  if(receipt.success){
   const observed=await observedState(row.request);check(observed.spent===true,'The original withdrawal nullifier is not final.');vaultBindings(observed.vault,row.request);
   if(pending.operation==='recover')check(observed.snapshot.pool.withdrawals.some(entry=>entry.nullifierHash===row.request.nullifierHash&&entry.recipient===row.request.vault&&entry.relayer===row.request.plan.relayer&&entry.fee==='0'),'The original funded-vault withdrawal is not final.');
   const status=observed.vault.status===2?'executed':observed.vault.status===3?'refunded':null;check(status&&(pending.operation!=='fulfill'||status==='executed')&&(pending.operation!=='withdrawRefund'||status==='refunded'),'The original private vault has no verified outcome.');
   check(observed.vault.inputBalance==='0'&&observed.vault.outputBalance==='0'&&observed.vault.allowance==='0','The original private vault has unconsumed input or remaining allowance.');checkedLogs(receipt.execution,row.request,status,pending.operation);
   if(status==='executed')check(typeof observed.beneficiaryOutputBalance==='string'&&BigInt(observed.beneficiaryOutputBalance)>=BigInt(row.before.outputBalance)+BigInt(d.outputAmount),'The private receiving account credit is unavailable.');
   else check(typeof observed.beneficiaryInputBalance==='string'&&BigInt(observed.beneficiaryInputBalance)>=BigInt(row.before.inputBalance)+BigInt(d.denomination),'The original refund account credit is unavailable.');
   row.status=status;row.outcome={intentId:row.request.id,artifactId:row.request.artifactId,status,verified:true,evidence:evidence(row.request,receipt,status)};row.observation={block:observed.snapshot.block,codes:observed.snapshot.codes,vault:observed.vault,beneficiaryOutputBalance:observed.beneficiaryOutputBalance,beneficiaryInputBalance:observed.beneficiaryInputBalance};
  }else{row.status='unknown';row.failed=true;}
  stage.receipt={success:receipt.success,transaction:receipt.transaction,receiptIds:receipt.receiptIds,result:structuredClone(result)};state.pending=null;await journal.write(state);await rpc.settle?.(stage.signed,stage.receipt);return outcome(row);
 }
 async function submit(value){return serial(async()=>{
  const request=checkAuroraSwapPublicRequest(value),state=checkJournal(await journal.read());let row=state.requests[request.id];
  if(row){check(sameAuroraSwapValue(row.request,request),'The original private request changed.');return outcome(row);}
  check(!state.pending&&Object.keys(state.requests).length<maxRequests&&!Object.values(state.requests).some(saved=>saved.request.nullifierHash===request.nullifierHash),'Check the original private request before another spend.');
  const observed=await preflight(request);check(observed.proofValid===true&&observed.simulateValid===true,'The original onchain proof or exact factory simulation did not verify.');
  row={request,status:'pending',stages:[],before:{outputBalance:observed.beneficiaryOutputBalance,inputBalance:observed.beneficiaryInputBalance??'0'}};state.requests[request.id]=row;await journal.write(state);
  const call=auroraSwapCall(request),signed=await signer.signTransaction(call);checkAuroraFundingTransaction(signed,call,operatorId);
  row.stages.push({operation:'fulfill',call,signed,receipt:null});state.pending={id:request.id,index:0,operation:'fulfill',call,signed};await journal.write(state);
  let result;try{result=await rpc.send(signed.bytes);}catch{row.status='unknown';await journal.write(state);return outcome(row);}return finish(state,row,result);
 });}
 function recoveryChoice(request,observed){
  if(observed.spent===true&&observed.vault.deployed&&observed.vault.status===0&&observed.vault.inputBalance===d.denomination&&observed.vault.outputBalance==='0'&&observed.vault.allowance==='0'&&observed.snapshot.pool.withdrawals.some(row=>row.nullifierHash===request.nullifierHash&&row.recipient===request.vault&&row.relayer===request.plan.relayer&&row.fee==='0'))return 'recover';
  if(observed.spent===false&&observed.knownRoot===true&&observed.proofValid===true&&BigInt(observed.snapshot.block.timestamp)>BigInt(request.plan.deadline)*1000n&&BigInt(observed.snapshot.pool.inputBalance)>=BigInt(d.denomination)&&(observed.vault.status===null||observed.vault.status===0)&&observed.vault.inputBalance==='0'&&observed.vault.outputBalance==='0'&&observed.vault.allowance==='0')return 'withdrawRefund';return null;
 }
 async function reconcile(value){return serial(async()=>{
  const request=checkAuroraSwapPublicRequest(value),state=checkJournal(await journal.read());let row=state.requests[request.id];if(row)check(sameAuroraSwapValue(row.request,request),'The original retained private request changed.');
  if(state.pending?.id===request.id){let result;try{result=await rpc.transaction(state.pending.signed.txHash,operatorId);}catch{return outcome(row);}return finish(state,row,result);}
  if(row?.outcome){const last=row.stages.at(-1);await rpc.settle?.(last.signed,last.receipt);return outcome(row);}
  const observed=await observedState(request);check(observed.proofValid===true,'The retained original proof did not verify.');
  if(!row){check(Object.keys(state.requests).length<maxRequests&&!Object.values(state.requests).some(saved=>saved.request.nullifierHash===request.nullifierHash),'Check the original retained request for this note.');row={request,status:'unknown',stages:[],before:{outputBalance:observed.beneficiaryOutputBalance,inputBalance:observed.beneficiaryInputBalance}};state.requests[request.id]=row;}
  const last=row.stages.at(-1);if(last?.receipt)await rpc.settle?.(last.signed,last.receipt);row.statusCheck={checkedAt:now(),operation:recoveryChoice(request,observed),withdrawal:observed.snapshot.pool.withdrawals.find(entry=>entry.nullifierHash===request.nullifierHash)??null};await journal.write(state);return outcome(row);
 });}
 async function recover(value){return serial(async()=>{
  check(exact(value,['request','operation'])&&['recover','withdrawRefund'].includes(value.operation),'Choose an explicit original recovery operation.');const request=checkAuroraSwapPublicRequest(value.request),state=checkJournal(await journal.read()),row=state.requests[request.id];check(row&&sameAuroraSwapValue(row.request,request),'Check the original private request status first.');if(row.outcome)return outcome(row);
  check(!state.pending&&row.stages.length<2&&(!row.stages.length||row.stages[0].operation==='fulfill'&&row.stages[0].receipt?.success===false),'Check the original pending or already recovered private transaction.');
  check(row.statusCheck?.operation===value.operation&&Number.isSafeInteger(row.statusCheck.checkedAt)&&now()-row.statusCheck.checkedAt>=0&&now()-row.statusCheck.checkedAt<=60000,'Read the original private request status before recovery.');
  const [observed,operator]=await Promise.all([observedState(request,{operation:value.operation}),rpc.operatorState()]);checkOperator(operator);check(operator.gasReady===true&&operator.allowance==='0'&&recoveryChoice(request,observed)===value.operation&&observed.simulateValid===true,'The original recovery funds, gas or exact simulation changed.');
  row.before={outputBalance:observed.beneficiaryOutputBalance,inputBalance:observed.beneficiaryInputBalance};row.recoveryObservation=row.statusCheck;row.statusCheck=null;row.status='pending';await journal.write(state);
  const call=auroraSwapCall(request,value.operation),signed=await signer.signTransaction(call);checkAuroraFundingTransaction(signed,call,operatorId);const index=row.stages.length;row.stages.push({operation:value.operation,call,signed,receipt:null});state.pending={id:request.id,index,operation:value.operation,call,signed};await journal.write(state);
  let result;try{result=await rpc.send(signed.bytes);}catch{row.status='unknown';await journal.write(state);return outcome(row);}return finish(state,row,result);
 });}
 return Object.freeze({configuration,prepare,submit,reconcile,recover});
}
