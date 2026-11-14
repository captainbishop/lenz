import {createHash} from 'node:crypto';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {AURORA_INTENT_DEPLOYMENT as deployment,AURORA_INTENT_UNAVAILABLE,AURORA_INTENT_PRIVACY} from './public/intent-aurora-config.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const address=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)&&value.length<=66;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const abi=new Interface([
 'function token() view returns(address)','function verifier() view returns(address)','function hasher() view returns(address)',
 'function denomination() view returns(uint256)','function levels() view returns(uint32)','function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)',
 'function inputToken() view returns(address)','function outputToken() view returns(address)','function adapter() view returns(address)','function pool() view returns(address)','function chainId() view returns(uint256)',
 'function numerator() view returns(uint256)','function denominator() view returns(uint256)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)',
 'event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)',
]);
const maxBytes=2*1024*1024,maxDeposits=4096;
export function auroraIntentReadSelection(value={}){
 check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(name=>['owner','beneficiary'].includes(name)),'Choose an Aurora source account.');
 for(const name of Object.keys(value))check(address(value[name]),'Choose a valid Aurora account.');
 check(!value.beneficiary||value.owner,'Choose the source before its result account.');
 return Object.fromEntries(Object.entries(value).map(([name,account])=>[name,account.toLowerCase()]));
}
export function createAuroraIntentReader({fetchImpl=fetch,now=Date.now}={}){
 let sequence=0;
 async function rpc(method,params,signal){
  signal.throwIfAborted();const id=++sequence;
  const response=await fetchImpl(deployment.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal});
  check(response.ok&&response.body,'The Aurora network is unavailable.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=maxBytes,'The Aurora response exceeds the read limit.');chunks.push(value);}
  }finally{await reader.cancel();reader.releaseLock();}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('The Aurora response cannot be read.');}
  check(body&&body.jsonrpc==='2.0'&&body.id===id&&!Object.hasOwn(body,'error')&&Object.hasOwn(body,'result'),'The Aurora read could not be verified.');return body.result;
 }
 async function contract(target,name,args,block,signal){
  const data=abi.encodeFunctionData(name,args),result=await rpc('eth_call',[{to:target,data},block],signal);
  check(typeof result==='string'&&/^0x[0-9a-fA-F]*$/.test(result)&&result.length<=1024,'The Aurora contract read is invalid.');
  try{return abi.decodeFunctionResult(name,result)[0];}catch{throw Error('The Aurora contract read cannot be decoded.');}
 }
 function configuration(){return {deployment:structuredClone(deployment),available:false,execute:false,privacy:'private',reason:AURORA_INTENT_UNAVAILABLE,privacyDisclosure:AURORA_INTENT_PRIVACY,venue:'Lenz funded fixed-rate test venue',supportedAssets:['LTS','LTT'],gasAsset:'Aurora testnet ETH',supportedActions:['fixed-pool-swap'],otherVenuesVerified:false};}
 async function snapshot(input={},options={}){
  const selected=auroraIntentReadSelection(input),signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  check(await rpc('eth_chainId',[],signal)===deployment.chainHex,'The Aurora RPC returned another chain.');
  const block=await rpc('eth_getBlockByNumber',['finalized',false],signal);
  check(block&&quantity(block.number)&&hash(block.hash)&&quantity(block.timestamp),'Aurora finality is unavailable.');
  const targets={input:deployment.inputToken,output:deployment.outputToken,...Object.fromEntries(['pool','adapter','factory','verifier','hasher'].map(name=>[name,deployment[name]]))},codes={};
  await Promise.all(Object.entries(targets).map(async([name,target])=>{
   const code=await rpc('eth_getCode',[target,block.number],signal);check(typeof code==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(code)&&code.length<maxBytes,'The selected Aurora code is unavailable.');
   const sha256=createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');check(sha256===deployment.codeSha256[name],'The selected Aurora code changed.');codes[name]=sha256;
  }));
  const read=(target,name,...args)=>contract(target,name,args,block.number,signal);
  const bindings=[
   [deployment.pool,'token',deployment.inputToken],[deployment.pool,'verifier',deployment.verifier],[deployment.pool,'hasher',deployment.hasher],
   ...['pool','inputToken','outputToken','adapter','verifier','hasher'].map(name=>[deployment.factory,name,deployment[name]]),
   [deployment.adapter,'inputToken',deployment.inputToken],[deployment.adapter,'outputToken',deployment.outputToken],
  ];
  await Promise.all(bindings.map(async([target,name,expected])=>{check((await read(target,name)).toLowerCase()===expected,'The selected Aurora route changed.');}));
  const [denomination,levels,nextIndex,root,factoryAmount,chainId,numerator,denominator,inputDecimals,outputDecimals,poolBalance,venueBalance]=await Promise.all([
   read(deployment.pool,'denomination'),read(deployment.pool,'levels'),read(deployment.pool,'nextIndex'),read(deployment.pool,'getLastRoot'),read(deployment.factory,'denomination'),read(deployment.factory,'chainId'),
   read(deployment.adapter,'numerator'),read(deployment.adapter,'denominator'),read(deployment.inputToken,'decimals'),read(deployment.outputToken,'decimals'),read(deployment.inputToken,'balanceOf',deployment.pool),read(deployment.outputToken,'balanceOf',deployment.adapter),
  ]);
  check(denomination===1000000n&&factoryAmount===denomination&&levels===20n&&chainId===BigInt(deployment.chainId)&&numerator===2n&&denominator===1n&&inputDecimals===6n&&outputDecimals===6n,'The selected Aurora denomination, assets or rate changed.');
  check(nextIndex<=BigInt(maxDeposits)&&hash(root)&&BigInt(root)<field,'The original pool exceeds the supported read boundary.');
  const logs=await rpc('eth_getLogs',[{address:deployment.pool,fromBlock:'0x0',toBlock:block.number}],signal);
  check(Array.isArray(logs)&&logs.length<=maxDeposits*2,'The original pool event list is unavailable.');
  const deposits=[],withdrawals=[];
  for(const log of logs){
   check(log&&log.address?.toLowerCase()===deployment.pool&&log.removed===false&&quantity(log.blockNumber)&&BigInt(log.blockNumber)<=BigInt(block.number)&&hash(log.blockHash)&&hash(log.transactionHash)&&quantity(log.logIndex),'The original pool event changed.');
   let parsed;try{parsed=abi.parseLog(log);}catch{throw Error('The original pool event cannot be decoded.');}
   if(parsed?.name==='Deposit'){
    const commitment=parsed.args.commitment.toLowerCase();check(hash(commitment)&&BigInt(commitment)<field&&parsed.args.leafIndex<BigInt(maxDeposits),'The original pool commitment is invalid.');
    deposits.push({commitment,index:Number(parsed.args.leafIndex),blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash,logIndex:log.logIndex});
   }else if(parsed?.name==='Withdrawal')withdrawals.push({recipient:parsed.args.to.toLowerCase(),nullifierHash:parsed.args.nullifierHash.toLowerCase(),relayer:parsed.args.relayer.toLowerCase(),fee:parsed.args.fee.toString(),blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash});
   else throw Error('The original pool emitted an unexpected event.');
  }
  deposits.sort((left,right)=>left.index-right.index);
  check(deposits.length===Number(nextIndex)&&deposits.every((entry,index)=>entry.index===index)&&new Set(deposits.map(entry=>entry.commitment)).size===deposits.length,'The original commitment history is incomplete.');
  let source=null,result=null;
  if(selected.owner){
   const beneficiary=selected.beneficiary??selected.owner;
   const [nativeBalance,inputBalance,outputBalance,resultBalance]=await Promise.all([rpc('eth_getBalance',[selected.owner,block.number],signal),read(deployment.inputToken,'balanceOf',selected.owner),read(deployment.outputToken,'balanceOf',selected.owner),read(deployment.outputToken,'balanceOf',beneficiary)]);
   check(quantity(nativeBalance),'The Aurora gas balance is unavailable.');source={owner:selected.owner,nativeWei:BigInt(nativeBalance).toString(),inputBalance:inputBalance.toString(),outputBalance:outputBalance.toString()};result={beneficiary,outputBalance:resultBalance.toString()};
  }
  const canonical=await rpc('eth_getBlockByNumber',[block.number,false],signal);check(canonical?.hash===block.hash,'The Aurora snapshot is no longer canonical.');
  return {routeId:deployment.routeId,network:'testnet',chainId:deployment.chainHex,observedAt:now(),block:{number:block.number,hash:block.hash,timestamp:Number(BigInt(block.timestamp))*1000},codes,
   pool:{address:deployment.pool,root,denomination:denomination.toString(),levels:Number(levels),nextIndex:Number(nextIndex),inputBalance:poolBalance.toString(),commitments:deposits.map(row=>row.commitment),deposits,withdrawals},
   venue:{address:deployment.adapter,inputAmount:denomination.toString(),outputAmount:deployment.outputAmount,outputBalance:venueBalance.toString(),funded:venueBalance>=2000000n},source,result,
   available:false,execute:false,privacy:'private',reason:AURORA_INTENT_UNAVAILABLE};
 }
 return Object.freeze({configuration,snapshot});
}
