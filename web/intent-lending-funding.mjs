import {Interface,Transaction,keccak256,toUtf8Bytes} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';

const check=(value,reason)=>{if(!value)throw Error(reason);};
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&!/^0x0{64}$/.test(value);
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const LENDING_FUNDING_ABI=new Interface(['function approve(address spender,uint256 amount) returns(bool)','function deposit(bytes32 commitment)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);
export const emptyLendingFundingJournal=()=>({version:1,requests:{},pending:null});
export function checkLendingFundingRequest(value){
  check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()==='account,commitment,owner,ownerAddress'&&typeof value.owner==='string'&&/^[0-9a-f]{64}$/.test(value.owner)&&address(value.ownerAddress)&&address(value.account)&&hash(value.commitment)&&BigInt(value.commitment)<field,'Retain the original Lenz faucet account and private commitment.');
  return{owner:value.owner,ownerAddress:value.ownerAddress,account:value.account,commitment:value.commitment};
}
export const lendingFundingId=value=>'lending-funding:'+keccak256(toUtf8Bytes(JSON.stringify(checkLendingFundingRequest(value)))).slice(2);
export function lendingFundingCall(value,operation,config=LENDING_TESTNET){
  const input=checkLendingFundingRequest(value);check(['approve','deposit','clear'].includes(operation),'Choose an original faucet funding stage.');
  return{to:operation==='deposit'?config.privacyPool:config.link,data:LENDING_FUNDING_ABI.encodeFunctionData(operation==='deposit'?'deposit':'approve',operation==='deposit'?[input.commitment]:[config.privacyPool,operation==='approve'?config.denomination:'0']),value:'0'};
}

export function createLendingFundingService({config=LENDING_TESTNET,rpc,signer,journal,sponsorAddress,serialize,sponsorFence,maxGas='1000000',maxFeePerGas='6250000000',maxGrants=20,now=Date.now}={}){
  check(rpc&&signer&&journal&&address(sponsorAddress)&&config.chainId===11155111&&config.chain===LENDING_TESTNET.chain&&config.link===LENDING_TESTNET.link&&config.denomination===LENDING_TESTNET.denomination&&address(config.privacyPool)&&address(config.lendingFactory)&&uint(maxGas)&&BigInt(maxGas)>=21000n&&BigInt(maxGas)<=100000000n&&uint(maxFeePerGas)&&BigInt(maxFeePerGas)>0n&&BigInt(maxGas)*BigInt(maxFeePerGas)<=6250000000000000n&&Number.isSafeInteger(maxGrants)&&maxGrants>0&&maxGrants<=20,'The bounded Sepolia faucet grant is unavailable.');
  for(const key of ['pool','link','usdc','aLink','variableDebt','privacyPool','lendingFactory'])check(hash(config.codeHashes?.[key])&&(LENDING_TESTNET[key]===null||config[key]===LENDING_TESTNET[key]),'The original faucet route is not pinned.');
  let queue=Promise.resolve();const serial=serialize??(work=>{const task=queue.then(work);queue=task.catch(()=>{});return task;});
  const terminal=row=>['funded','failed'].includes(row.status);
  const result=row=>structuredClone(row.outcome??{grantId:lendingFundingId(row.input),...row.input,status:row.status==='pending'?'pending':'unknown',verified:false,operation:row.stages.at(-1)?.operation??null,continuationAvailable:Boolean(row.next),...(row.next?{nextOperation:row.next}:{}),resubmissionSafe:row.resubmissionSafe===true,...(row.stages.at(-1)?.transaction?{transaction:row.stages.at(-1).transaction.hash}:{})});
  function transaction(raw,call,sponsor){
    check(typeof raw==='string'&&/^0x[0-9a-f]+$/i.test(raw)&&raw.length<=4096,'The original faucet transaction is invalid.');const tx=Transaction.from(raw);
    check(tx.isSigned()&&tx.type===2&&tx.chainId===11155111n&&tx.from.toLowerCase()===sponsorAddress&&tx.to?.toLowerCase()===call.to&&tx.data.toLowerCase()===call.data.toLowerCase()&&tx.value===0n&&tx.gasLimit===BigInt(maxGas)&&tx.maxFeePerGas>0n&&tx.maxFeePerGas<=BigInt(maxFeePerGas)&&tx.maxPriorityFeePerGas>=0n&&tx.maxPriorityFeePerGas<=tx.maxFeePerGas&&(tx.accessList?.length??0)===0&&tx.hash===keccak256(raw),'The sponsor signed another faucet grant, allowance or gas authority.');
    if(sponsor)check(BigInt(tx.nonce)===BigInt(sponsor.nonce)&&tx.maxFeePerGas===BigInt(sponsor.maxFeePerGas)&&tx.maxPriorityFeePerGas===BigInt(sponsor.maxPriorityFeePerGas),'The original faucet sponsor nonce or gas price changed.');
    return{raw:tx.serialized,hash:tx.hash};
  }
  function depositWitness(row,stage){
    check(stage.operation==='deposit'&&stage.receipt?.status==='0x1','The original faucet deposit has no successful receipt.');
    const logs=stage.receipt.logs.map(log=>{try{return{address:log.address?.toLowerCase(),parsed:LENDING_FUNDING_ABI.parseLog(log)};}catch{return{parsed:null};}});
    const deposits=logs.filter(log=>log.address===config.privacyPool&&log.parsed?.name==='Deposit');
    const moved=logs.filter(log=>log.address===config.link&&log.parsed?.name==='Transfer'&&log.parsed.args.from.toLowerCase()===sponsorAddress&&log.parsed.args.to.toLowerCase()===config.privacyPool&&log.parsed.args.value===BigInt(config.denomination));
    check(deposits.length===1&&deposits[0].parsed.args.commitment===row.input.commitment&&moved.length===1,'The exact original faucet deposit or LINK transfer is missing.');
    return{commitment:row.input.commitment,index:Number(deposits[0].parsed.args.leafIndex),transactionHash:stage.transaction.hash,blockNumber:BigInt(stage.receipt.blockNumber).toString(),blockHash:stage.receipt.blockHash};
  }
  function checkJournal(state){
    check(state?.version===1&&state.requests&&Object.getPrototypeOf(state.requests)===Object.prototype&&Object.keys(state.requests).length<=maxGrants&&JSON.stringify(state).length<=1000000&&(state.pending===null||typeof state.pending==='string'),'The retained faucet journal is invalid.');
    const owners=new Set(),accounts=new Set(),commitments=new Set();
    for(const [id,row]of Object.entries(state.requests)){
      const input=checkLendingFundingRequest(row.input);check(id===lendingFundingId(input)&&['signing-unresolved','pending','unknown','funded','failed'].includes(row.status)&&Array.isArray(row.stages)&&row.stages.length>=1&&row.stages.length<=5,'The original faucet grant changed.');
      check(!owners.has(input.owner)&&!accounts.has(input.account)&&!commitments.has(input.commitment),'A faucet account or commitment received another grant.');owners.add(input.owner);accounts.add(input.account);commitments.add(input.commitment);
      check(terminal(row)?state.pending!==id:state.pending===id,'An unresolved faucet grant lost its shared sponsor fence.');
      for(const [index,stage]of row.stages.entries()){
        check(same(stage.call,lendingFundingCall(input,stage.operation,config))&&uint(stage.before?.inputBalance)&&uint(stage.before?.allowance)&&hash(stage.before?.accountCodeHash)&&(index===0?stage.operation==='approve':stage.operation==='clear'||stage.operation==='deposit'&&index===1&&row.stages[0].receipt?.status==='0x1'),'The original faucet stage or allowance changed.');
        if(stage.transaction)check(same(transaction(stage.transaction.raw,stage.call),stage.transaction),'The retained original faucet transaction changed.');
        if(stage.receipt)check(stage.transaction&&stage.receipt.transactionHash===stage.transaction.hash&&['0x0','0x1'].includes(stage.receipt.status),'The original faucet stage receipt changed.');
        check(stage.finalized?Boolean(stage.receipt):state.pending===id&&(index===row.stages.length-1||Boolean(stage.receipt)),'The original faucet stage lost its receipt or fence.');
      }
      if(row.outcome){
        check(terminal(row)&&row.outcome.grantId===id&&row.outcome.owner===input.owner&&row.outcome.ownerAddress===input.ownerAddress&&row.outcome.account===input.account&&row.outcome.commitment===input.commitment&&row.outcome.status===row.status&&row.outcome.verified===(row.status==='funded'),'The retained faucet result changed.');
        if(row.status==='funded'){
          const deposit=row.stages.find(stage=>stage.operation==='deposit'&&stage.receipt?.status==='0x1'),witness=depositWitness(row,deposit),e=row.outcome.evidence;
          check(e?.chainId===config.chain&&e.asset===config.link&&e.amount===config.denomination&&e.sponsor===sponsorAddress&&e.pool===config.privacyPool&&e.allowance==='0'&&Object.entries(witness).every(([key,value])=>e[key]===value),'The retained faucet deposit witness changed.');
        }
      }else check(!terminal(row),'The faucet result evidence is missing.');
    }
    check(state.pending===null||state.requests[state.pending]&&!terminal(state.requests[state.pending]),'The shared faucet grant reservation is invalid.');return state;
  }
  async function save(state){checkJournal(state);await journal.write(structuredClone(state));check(same(await journal.read(),state),'The original faucet request was not durably saved.');}
  async function observe(input,blockTag='finalized'){
    const value=await rpc.fundingSnapshot(input,{blockTag}),s=value?.snapshot,a=s?.account,b=s?.block,o=value?.operator;
    check(s?.chainId===config.chain&&s.routeVerified===true&&s.trust?.codePinsVerified===true&&s.trust.implementationPinsVerified===true&&s.trust.executionPinsVerified===true&&Number.isSafeInteger(s.observedAt)&&Math.abs(now()-s.observedAt)<=120000&&b?.finality===blockTag&&b.requireCanonical===true&&uint(b.number)&&uint(b.timestamp)&&hash(b.hash),'The canonical pinned faucet route is unavailable.');
    check(a?.status==='verified'&&a.address===input.account&&a.owner===input.ownerAddress&&hash(a.codeHash)&&a.route?.chainId===config.chain&&a.route.factory===config.lendingFactory,'Use the original deployed durable lending account.');
    for(const key of ['pool','link','usdc','aLink','variableDebt'])check(a.route[key]===config[key]&&a.route[key+'CodeHash']===config.codeHashes[key],'The original faucet lending route changed.');
    check(o?.address===sponsorAddress&&uint(o.inputBalance)&&uint(o.allowance)&&typeof value.deposited==='boolean'&&s.privatePool?.address===config.privacyPool&&Array.isArray(s.privatePool.commitments)&&value.deposited===s.privatePool.commitments.includes(input.commitment)&&value.deposited===Boolean(value.deposit),'The original faucet inventory, allowance or commitment history is unavailable.');
    if(value.deposited)check(value.deposit.commitment===input.commitment&&hash(value.deposit.transactionHash)&&hash(value.deposit.blockHash)&&uint(value.deposit.blockNumber)&&Number.isSafeInteger(value.deposit.index)&&value.deposit.index>=0&&value.deposit.index<4096,'The original faucet deposit witness is invalid.');
    return value;
  }
  async function gas(){const value=await rpc.sponsorState();check(value?.chainId==='11155111'&&value.address===sponsorAddress&&['nonce','balance','maxFeePerGas','maxPriorityFeePerGas'].every(key=>uint(value[key]))&&BigInt(value.nonce)<=BigInt(Number.MAX_SAFE_INTEGER)&&BigInt(value.maxFeePerGas)>0n&&BigInt(value.maxFeePerGas)<=BigInt(maxFeePerGas)&&BigInt(value.maxPriorityFeePerGas)<=BigInt(value.maxFeePerGas)&&BigInt(value.balance)>=BigInt(maxGas)*BigInt(value.maxFeePerGas),'The bounded faucet sponsor gas is unavailable.');return value;}
  function preflight(operation,observed,row){
    if(operation==='approve')check(!observed.deposited&&observed.operator.allowance==='0'&&BigInt(observed.operator.inputBalance)>=BigInt(config.denomination),'The original faucet note, inventory or zero allowance changed.');
    if(operation==='deposit')check(!observed.deposited&&observed.operator.allowance===config.denomination&&BigInt(observed.operator.inputBalance)>=BigInt(config.denomination),'The original faucet deposit or exact allowance changed.');
    if(operation==='clear')check(BigInt(observed.operator.allowance)<=BigInt(config.denomination),'The faucet allowance exceeds the original grant.');
    if(row?.stages.length)check(observed.snapshot.account.codeHash===row.stages[0].before.accountCodeHash,'The durable faucet account code changed.');
  }
  async function dispatch(state,row,operation,observed){
    preflight(operation,observed,row);check(row.stages.length<5,'The original faucet cleanup exceeded its bounded attempts.');
    const id=lendingFundingId(row.input);await sponsorFence?.assertAvailable(id);const sponsor=await gas(),call=lendingFundingCall(row.input,operation,config);
    check(await rpc.simulateFunding({from:sponsorAddress,...call})===true,'The exact original faucet stage did not simulate.');await sponsorFence?.reserve(id);
    const stage={operation,call,transaction:null,finalized:false,before:{inputBalance:observed.operator.inputBalance,allowance:observed.operator.allowance,accountCodeHash:observed.snapshot.account.codeHash}};
    row.stages.push(stage);row.status='signing-unresolved';row.next=null;row.resubmissionSafe=false;state.pending=id;await save(state);
    const raw=await signer.signTransaction({chainId:11155111,type:2,...call,nonce:sponsor.nonce,gasLimit:maxGas,maxFeePerGas:sponsor.maxFeePerGas,maxPriorityFeePerGas:sponsor.maxPriorityFeePerGas});stage.transaction=transaction(raw,call,sponsor);row.status='pending';await save(state);
    try{check(await rpc.send(stage.transaction.raw)===stage.transaction.hash,'The faucet network returned another transaction.');}catch{row.status='unknown';await save(state);}return result(row);
  }
  async function finish(state,row){
    const id=lendingFundingId(row.input);if(terminal(row)){await sponsorFence?.release(id);return result(row);}
    row.next=null;row.resubmissionSafe=false;
    const receipts=await Promise.all(row.stages.map(stage=>stage.transaction?rpc.receipt(stage.transaction.hash):null));
    if(receipts.every(receipt=>receipt===null)){check(!row.stages.some(stage=>stage.finalized),'A finalized faucet transaction disappeared.');return result(row);}
    const [included,finalized]=await Promise.all([observe(row.input,'latest'),observe(row.input,'finalized')]);
    let allIncluded=true;
    for(const [index,stage]of row.stages.entries()){
      const receipt=receipts[index];
      if(!receipt){check(!stage.finalized,'A finalized faucet transaction disappeared.');allIncluded=false;continue;}
      check(receipt.transactionHash===stage.transaction.hash&&receipt.from?.toLowerCase()===sponsorAddress&&receipt.to?.toLowerCase()===stage.call.to&&hash(receipt.blockHash)&&quantity(receipt.blockNumber)&&['0x0','0x1'].includes(receipt.status)&&Array.isArray(receipt.logs),'The original faucet receipt changed.');
      if(BigInt(included.snapshot.block.number)<BigInt(receipt.blockNumber)){allIncluded=false;continue;}
      const block=await rpc.block(receipt.blockNumber);check(block?.hash===receipt.blockHash&&BigInt(block.number)===BigInt(receipt.blockNumber),'The original faucet receipt is no longer canonical.');
      if(stage.finalized)check(stage.receipt.blockHash===receipt.blockHash,'The finalized faucet block changed.');
      const observedStage={...stage,receipt};
      if(receipt.status==='0x1'){
        if(stage.operation==='deposit'){
          const witness=depositWitness(row,observedStage);check(included.deposited&&Object.entries(witness).every(([key,value])=>included.deposit[key]===value)&&BigInt(included.operator.inputBalance)+BigInt(config.denomination)<=BigInt(stage.before.inputBalance),'The original included faucet note or sponsor debit is not independently visible.');
        }else{
          const expected=stage.operation==='approve'?config.denomination:'0';
          const approvals=receipt.logs.filter(log=>log.address?.toLowerCase()===config.link).map(log=>{try{return LENDING_FUNDING_ABI.parseLog(log);}catch{return null;}}).filter(log=>log?.name==='Approval'&&log.args.owner.toLowerCase()===sponsorAddress&&log.args.spender.toLowerCase()===config.privacyPool&&log.args.value===BigInt(expected));
          check(approvals.length===1,'The exact original faucet approval is not verified.');
        }
      }
      stage.receipt=structuredClone(receipt);stage.finalized=BigInt(finalized.snapshot.block.number)>=BigInt(receipt.blockNumber);
    }
    if(allIncluded){
      const stage=row.stages.at(-1),allFinal=row.stages.every(value=>value.finalized);
      if(stage.operation==='approve'&&stage.receipt.status==='0x1'){preflight('deposit',included,row);row.next='deposit';}
      else if(stage.operation==='deposit')row.next='clear';
      else if(included.operator.allowance!=='0')row.next='clear';
      else if(allFinal){
        check(finalized.operator.allowance==='0','The original faucet allowance cleanup is not finalized.');
        const deposit=row.stages.find(value=>value.operation==='deposit'&&value.receipt?.status==='0x1');
        row.status=deposit?'funded':'failed';let evidence;
        if(deposit){const witness=depositWitness(row,deposit);check(finalized.deposited&&Object.entries(witness).every(([key,value])=>finalized.deposit[key]===value)&&BigInt(finalized.operator.inputBalance)+BigInt(config.denomination)<=BigInt(deposit.before.inputBalance),'The original funded commitment or sponsor debit is not finalized.');evidence={chainId:config.chain,asset:config.link,amount:config.denomination,sponsor:sponsorAddress,pool:config.privacyPool,...witness,allowance:'0',cleanupTransaction:stage.transaction.hash,cleanupStatus:stage.receipt.status,checkedBlockNumber:finalized.snapshot.block.number,checkedBlockHash:finalized.snapshot.block.hash};}
        row.outcome={grantId:id,...row.input,status:row.status,verified:Boolean(deposit),...(evidence?{evidence}:{reason:'The original faucet grant did not deposit; its allowance is cleared.'})};state.pending=null;
      }
    }
    if(!terminal(row))row.status='unknown';await save(state);if(terminal(row))await sponsorFence?.release(id);return result(row);
  }
  async function configuration(){return serial(async()=>{const state=checkJournal(await journal.read());let available=state.pending===null&&Object.keys(state.requests).length<maxGrants;try{if(available)await sponsorFence?.assertAvailable();}catch{available=false;}return{available,execute:available,chainId:config.chain,asset:config.link,amount:config.denomination,remainingGrants:Math.max(0,maxGrants-Object.keys(state.requests).length)};});}
  async function unresolvedStage(row){for(const stage of row.stages)if(!stage.transaction||await rpc.receipt(stage.transaction.hash)===null){check(!stage.finalized,'A finalized faucet transaction disappeared.');return stage;}return null;}
  async function submit(value){return serial(async()=>{const input=checkLendingFundingRequest(value),id=lendingFundingId(input),state=checkJournal(await journal.read()),old=state.requests[id];if(old){check(same(old.input,input),'The original faucet input changed.');return finish(state,old);}check(state.pending===null&&Object.keys(state.requests).length<maxGrants&&!Object.values(state.requests).some(row=>row.input.owner===input.owner||row.input.account===input.account||row.input.commitment===input.commitment||row.input.ownerAddress===input.ownerAddress),'This account or note already has its original faucet grant.');const observed=await observe(input);preflight('approve',observed);const row={input,status:'unknown',stages:[],next:null};state.requests[id]=row;return dispatch(state,row,'approve',observed);});}
  async function reconcile(value){return serial(async()=>{const input=checkLendingFundingRequest(value),state=checkJournal(await journal.read()),row=state.requests[lendingFundingId(input)];check(row&&same(row.input,input),'The original faucet grant is not retained.');await finish(state,row);if(!terminal(row)&&!row.next){const stage=await unresolvedStage(row);row.resubmissionSafe=Boolean(stage?.transaction&&typeof rpc.transaction==='function'&&await rpc.transaction(stage.transaction.hash)===null);await save(state);}return result(row);});}
  async function resume(value){return serial(async()=>{
    const input=checkLendingFundingRequest(value),id=lendingFundingId(input),state=checkJournal(await journal.read()),row=state.requests[id];check(row&&same(row.input,input),'The original faucet grant is not retained.');await finish(state,row);if(terminal(row))return result(row);await sponsorFence?.assertAvailable(id);const observed=await observe(input,'latest');
    if(row.next)return dispatch(state,row,row.next,observed);
    const stage=await unresolvedStage(row);if(!stage)return result(row);check(stage.transaction&&typeof rpc.transaction==='function','Keep the original unresolved faucet transaction.');const known=await rpc.transaction(stage.transaction.hash);
    if(known!==null){check(known?.hash===stage.transaction.hash&&known.from?.toLowerCase()===sponsorAddress&&known.to?.toLowerCase()===stage.call.to&&known.input?.toLowerCase()===stage.call.data.toLowerCase()&&known.value==='0x0','The known original faucet transaction changed.');return result(row);}
    preflight(stage.operation,observed,row);check(await rpc.simulateFunding({from:sponsorAddress,...stage.call})===true,'The original faucet transaction no longer simulates.');row.resubmissionSafe=false;
    try{check(await rpc.send(stage.transaction.raw)===stage.transaction.hash,'The original faucet replay returned another transaction.');row.status='pending';}catch{row.status='unknown';}await save(state);return result(row);
  });}
  return Object.freeze({configuration,submit,reconcile,resume});
}
