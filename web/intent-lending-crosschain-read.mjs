import {Interface,Transaction,keccak256} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {LENDING_DEPLOYMENT} from './public/intent-lending-deployment.js';
import {checkLendingCrosschainQuote} from './public/intent-lending-crosschain.js';
import {LENDING_CROSSCHAIN_PINS,checkLendingCrosschainReview,checkLendingCrosschainSourceTransaction} from './public/intent-lending-crosschain-route.js';
import {createLendingSupplyReader} from './intent-lending-supply-read.mjs';

const pins=LENDING_CROSSCHAIN_PINS,check=(ok,reason)=>{if(!ok)throw Error(reason);};
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&BigInt(value)>0n;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const hex=value=>'0x'+BigInt(value).toString(16);
const abi=new Interface(['function allowance(address,address) view returns(uint256)','function commitments(bytes32) view returns(bool)']);
const readMethods=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_call','eth_getTransactionByHash','eth_getTransactionReceipt']);
function abortable(work,signal){signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
export function createLendingCrosschainReader({deployment=LENDING_DEPLOYMENT,fetchImpl=fetch,now=Date.now,readSnapshot,timeoutMs=60000}={}){
  check(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Choose the bounded cross-chain read timeout.');
  const config={...LENDING_TESTNET,...deployment},destinationReader=createLendingSupplyReader({deployment,fetchImpl,now,readSnapshot,timeoutMs});let sequence=0;
  const signalFor=signal=>signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  async function rpc(chain,method,params,signal){
    check(readMethods.has(method),'Cross-chain observation is read-only.');const id=++sequence,url=chain===84532?pins.sourceRpc:config.rpc;
    const response=await abortable(fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})}),signal);
    check(response.ok&&!response.redirected&&response.body,'The cross-chain network is unavailable.');const stream=response.body.getReader(),chunks=[];let length=0;
    try{for(;;){const {done,value}=await abortable(stream.read(),signal);if(done)break;length+=value.byteLength;check(length<=2000000,'The cross-chain response exceeds its limit.');chunks.push(value);}}finally{stream.cancel().catch(()=>{});stream.releaseLock();}
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Error('The cross-chain response cannot be decoded.');}
    check(body?.jsonrpc==='2.0'&&body.id===id&&!Object.hasOwn(body,'error')&&Object.hasOwn(body,'result'),'The cross-chain RPC evidence is invalid.');return body.result;
  }
  async function pinnedBlock(chain,tag,signal){
    check(await rpc(chain,'eth_chainId',[],signal)===hex(chain),'The cross-chain network changed.');const raw=await rpc(chain,'eth_getBlockByNumber',[tag,false],signal);
    check(quantity(raw?.number)&&quantity(raw.timestamp)&&hash(raw.hash),'The cross-chain block cannot be verified.');return{number:BigInt(raw.number).toString(),timestamp:BigInt(raw.timestamp).toString(),hash:raw.hash,finality:tag,requireCanonical:true};
  }
  async function canonical(chain,block,signal){const value=await rpc(chain,'eth_getBlockByNumber',[hex(block.number),false],signal);check(value?.hash===block.hash&&value.number===hex(block.number),'The cross-chain snapshot is no longer canonical.');}
  async function sourcePins(block,signal){const ref={blockHash:block.hash,requireCanonical:true},codes=await Promise.all([rpc(84532,'eth_getCode',[pins.depository,ref],signal),rpc(84532,'eth_getCode',[pins.sourceRouter,ref],signal)]);check(codes.every(value=>typeof value==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(value))&&keccak256(codes[0])===pins.depositoryCodeHash&&keccak256(codes[1])===pins.sourceRouterCodeHash,'The original source funding code changed.');return{depositoryCodeHash:pins.depositoryCodeHash,routerCodeHash:pins.sourceRouterCodeHash};}
  function inputFor(value){check(value&&Object.keys(value).sort().join()==='account,owner,ownerAddress,plan,quote'&&/^[0-9a-f]{64}$/.test(value.owner)&&address(value.ownerAddress)&&address(value.account)&&value.plan?.privacyPool===config.privacyPool,'Choose the original cross-chain funding account.');checkLendingCrosschainQuote(value.quote,value.plan,{now:now()});return value;}
  async function destination(input,signal){
    const snapshot=await destinationReader.snapshot({owner:input.ownerAddress,account:input.account},{signal}),block=snapshot.block,ref={blockHash:block.hash,requireCanonical:true};
    const [code,allowance,commitment]=await Promise.all([rpc(11155111,'eth_getCode',[pins.destinationRouter,ref],signal),rpc(11155111,'eth_call',[{to:config.link,data:abi.encodeFunctionData('allowance',[pins.destinationRouter,config.privacyPool])},ref],signal),rpc(11155111,'eth_call',[{to:config.privacyPool,data:abi.encodeFunctionData('commitments',[input.plan.commitment])},ref],signal)]);
    check(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(code)&&keccak256(code)===pins.destinationRouterCodeHash,'The original destination router code changed.');
    const decode=(name,value)=>{check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),'The cross-chain contract result is invalid.');const decoded=abi.decodeFunctionResult(name,value);check(abi.encodeFunctionResult(name,decoded)===value,'The cross-chain contract result is noncanonical.');return decoded[0];};
    snapshot.crosschain={router:pins.destinationRouter,routerCodeHash:pins.destinationRouterCodeHash,allowance:decode('allowance',allowance).toString(),commitmentExists:decode('commitments',commitment)};
    check(snapshot.crosschain.commitmentExists===snapshot.privatePool.commitments.includes(input.plan.commitment),'The original private commitment mapping and history disagree.');await canonical(11155111,block,signal);return snapshot;
  }
  async function preflight(value,options={}){
    const input=inputFor(value),signal=signalFor(options.signal),block=await pinnedBlock(84532,'latest',signal),ref={blockHash:block.hash,requireCanonical:true};
    const [pinned,balance,nonce,senderCode,snapshot]=await Promise.all([sourcePins(block,signal),rpc(84532,'eth_getBalance',[input.plan.sender,ref],signal),rpc(84532,'eth_getTransactionCount',[input.plan.sender,'pending'],signal),rpc(84532,'eth_getCode',[input.plan.sender,ref],signal),destination(input,signal)]);
    check(quantity(balance)&&quantity(nonce)&&senderCode==='0x','The source wallet balance, nonce or account type changed.');
    const quoted=input.quote.steps[0].items[0].data,call={from:input.plan.sender,to:pins.depository,data:quoted.data,value:hex(quoted.value),gas:hex(quoted.gas),maxFeePerGas:hex(quoted.maxFeePerGas),maxPriorityFeePerGas:hex(quoted.maxPriorityFeePerGas),nonce};
    const [estimate,simulation]=await Promise.all([rpc(84532,'eth_estimateGas',[call],signal),rpc(84532,'eth_call',[call,ref],signal)]);
    check(quantity(estimate)&&simulation==='0x','The exact original source payment did not simulate.');await canonical(84532,block,signal);
    return{observedAt:now(),source:{chainId:84532,sender:input.plan.sender,nonce:BigInt(nonce).toString(),balance:BigInt(balance).toString(),gasEstimate:BigInt(estimate).toString(),senderCode,simulated:true,block,...pinned},destination:snapshot};
  }
  function originalTransaction(value,review){
    if(value===null)return null;check(value&&value.type==='0x2'&&quantity(value.chainId)&&quantity(value.nonce)&&quantity(value.gas)&&quantity(value.value)&&quantity(value.maxFeePerGas)&&quantity(value.maxPriorityFeePerGas)&&hash(value.r)&&hash(value.s)&&quantity(value.v)&&Array.isArray(value.accessList),'The source transaction encoding is invalid.');
    const tx=Transaction.from({type:2,chainId:BigInt(value.chainId),nonce:Number(BigInt(value.nonce)),gasLimit:BigInt(value.gas),maxFeePerGas:BigInt(value.maxFeePerGas),maxPriorityFeePerGas:BigInt(value.maxPriorityFeePerGas),to:value.to,data:value.input,value:BigInt(value.value),accessList:value.accessList,signature:{r:value.r,s:value.s,v:Number(BigInt(value.v))}}),result={hash:value.hash,raw:tx.serialized};
    check(value.from?.toLowerCase()===tx.from.toLowerCase(),'The source transaction sender changed.');checkLendingCrosschainSourceTransaction(result,review);return result;
  }
  async function findOriginal(review,signal){
    const latest=await rpc(84532,'eth_getBlockByNumber',['latest',false],signal),nonce=await rpc(84532,'eth_getTransactionCount',[review.plan.sender,'latest'],signal);check(quantity(latest?.number)&&quantity(nonce)&&hash(latest.hash),'The source nonce lookup is unavailable.');
    if(BigInt(nonce)<=BigInt(review.transaction.nonce))return null;
    const end=BigInt(latest.number),start=BigInt(review.sourceBlock.number)>end-63n?BigInt(review.sourceBlock.number):end-63n;
    for(let at=end;at>=start;at--){const block=await rpc(84532,'eth_getBlockByNumber',[hex(at),true],signal);check(block?.number===hex(at)&&Array.isArray(block.transactions)&&block.transactions.length<=2000,'The bounded original source lookup is unavailable.');const found=block.transactions.filter(tx=>tx.from?.toLowerCase()===review.plan.sender&&tx.nonce===review.transaction.nonce);check(found.length<=1,'The original source nonce lookup conflicts.');if(found.length){await canonical(84532,{number:at.toString(),hash:block.hash},signal);return found[0];}}
    await canonical(84532,{number:end.toString(),hash:latest.hash},signal);return null;
  }
  async function observe(value,options={}){
    check(value&&Object.keys(value).sort().join()==='review,transactionHash'&&(value.transactionHash===null||hash(value.transactionHash)),'Choose the original funding transaction.');
    const review=checkLendingCrosschainReview(value.review,{config,allowExpired:true}),signal=signalFor(options.signal),block=await pinnedBlock(84532,'finalized',signal);
    const [pinned,raw,snapshot]=await Promise.all([sourcePins(block,signal),value.transactionHash?rpc(84532,'eth_getTransactionByHash',[value.transactionHash],signal):findOriginal(review,signal),destination(review,signal)]);
    const transaction=originalTransaction(raw,review),source={chainId:84532,block,...pinned,transaction,receipt:null,receiptBlock:null};
    if(transaction){source.receipt=await rpc(84532,'eth_getTransactionReceipt',[transaction.hash],signal);if(source.receipt){check(quantity(source.receipt.blockNumber),'The original source receipt block is invalid.');source.receiptBlock=await rpc(84532,'eth_getBlockByNumber',[source.receipt.blockNumber,false],signal);}}
    const deposit=snapshot.privatePool.deposits.find(row=>row.commitment===review.plan.commitment);let destinationReceipt=null,destinationReceiptBlock=null;
    if(deposit){destinationReceipt=await rpc(11155111,'eth_getTransactionReceipt',[deposit.transactionHash],signal);if(destinationReceipt){check(quantity(destinationReceipt.blockNumber),'The original destination receipt block is invalid.');destinationReceiptBlock=await rpc(11155111,'eth_getBlockByNumber',[destinationReceipt.blockNumber,false],signal);}}
    await canonical(84532,block,signal);return{observedAt:now(),source,destination:snapshot,destinationReceipt,destinationReceiptBlock};
  }
  return Object.freeze({preflight,observe});
}
