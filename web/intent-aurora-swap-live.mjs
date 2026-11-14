import {createHash} from 'node:crypto';
import {Interface,keccak256} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {createAuroraIntentReader} from './intent-aurora-read.mjs';
import {createAuroraSwapService,emptyAuroraSwapJournal,auroraSwapCall} from './intent-aurora-swap.mjs';
import {openAuroraPrivateJournal,openAuroraSponsorRuntime} from './intent-aurora-sponsor-live.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const tuple='(address beneficiary,address refundRecipient,address relayer,uint256 relayerFee,uint256 minOutput,uint256 deadline,bytes32 salt)';
const abi=new Interface([`function vaultAddress(${tuple}) view returns(address)`,'function isKnownRoot(bytes32) view returns(bool)','function isSpent(bytes32) view returns(bool)','function verifyProof(bytes,uint256[6]) view returns(bool)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)',...['pool','input','output','adapter','verifier','hasher'].map(name=>`function ${name}CodeHash() view returns(bytes32)`),...['inputToken','outputToken','adapter','beneficiary','refundRecipient'].map(name=>`function ${name}() view returns(address)`),...['inputAmount','minOutput','deadline','chainId','status'].map(name=>`function ${name}() view returns(uint256)`)]);
export function createAuroraSwapReader({fetchImpl=fetch,now=Date.now,operatorAddress,snapshotReader=createAuroraIntentReader({fetchImpl,now})}={}){
 check(/^0x[0-9a-f]{40}$/.test(operatorAddress),'Pin the public sponsor address.');let sequence=0;
 async function rpc(method,params,signal){
  const id=++sequence,response=await fetchImpl(d.rpc,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal});check(response.ok&&response.body,'The private swap read is unavailable.');
  const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;check(size<=2_000_000,'The private swap read exceeds its limit.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));check(body?.jsonrpc==='2.0'&&body.id===id&&!Object.hasOwn(body,'error')&&Object.hasOwn(body,'result'),'The private swap read cannot be verified.');return body.result;
 }
 async function swapState(request,{operation='fulfill'}={}){
  const snapshot=await snapshotReader.snapshot({owner:request.plan.beneficiary}),block=snapshot.block.number,signal=AbortSignal.timeout(60000);check(await rpc('eth_chainId',[],signal)===d.chainHex,'The private swap RPC returned another chain.');
  async function read(target,name,args=[]){const encoded=await rpc('eth_call',[{to:target,data:abi.encodeFunctionData(name,args)},block],signal);check(typeof encoded==='string'&&/^0x[0-9a-fA-F]*$/.test(encoded)&&encoded.length<=2048,'The private swap contract read is invalid.');return abi.decodeFunctionResult(name,encoded)[0];}
  const codeHashes={};await Promise.all(Object.entries({pool:d.pool,input:d.inputToken,output:d.outputToken,adapter:d.adapter,verifier:d.verifier,hasher:d.hasher,factory:d.factory}).map(async([name,target])=>{const code=await rpc('eth_getCode',[target,block],signal);check(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(code)&&createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex')===d.codeSha256[name],'The original private route code changed.');codeHashes[name]=keccak256(code);}));
  await Promise.all(['pool','input','output','adapter','verifier','hasher'].map(async name=>check((await read(d.factory,name+'CodeHash')).toLowerCase()===codeHashes[name],'The factory immutable code binding changed.')));
  const [factoryVault,knownRoot,spent,vaultCode,inputBalance,outputBalance,allowance,beneficiaryOutputBalance,beneficiaryInputBalance]=await Promise.all([read(d.factory,'vaultAddress',[request.plan]),read(d.pool,'isKnownRoot',[request.root]),read(d.pool,'isSpent',[request.nullifierHash]),rpc('eth_getCode',[request.vault,block],signal),read(d.inputToken,'balanceOf',[request.vault]),read(d.outputToken,'balanceOf',[request.vault]),read(d.inputToken,'allowance',[request.vault,d.adapter]),read(d.outputToken,'balanceOf',[request.plan.beneficiary]),read(d.inputToken,'balanceOf',[request.plan.refundRecipient])]);
  check(typeof vaultCode==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(vaultCode),'The deterministic vault code is unavailable.');const vault={deployed:vaultCode!=='0x',status:null,inputBalance:inputBalance.toString(),outputBalance:outputBalance.toString(),allowance:allowance.toString()};
  if(vault.deployed){
   await Promise.all(['inputToken','outputToken','adapter','beneficiary','refundRecipient','inputAmount','minOutput','deadline','chainId','status'].map(async name=>{const value=await read(request.vault,name);vault[name]=typeof value==='bigint'?name==='status'?Number(value):value.toString():value.toLowerCase();}));
   check([0,1,2,3].includes(vault.status),'The original vault status is invalid.');await Promise.all(['input','output','adapter'].map(async name=>check((await read(request.vault,name+'CodeHash')).toLowerCase()===codeHashes[name],'The original vault immutable code binding changed.')));vault.bindingsVerified=true;
  }
  let proofValid=null,simulateValid=null;
  if(request.proof){
   proofValid=await read(d.verifier,'verifyProof',[request.proof,request.publicSignals]);
   if(proofValid===true&&((operation==='fulfill'&&!spent&&BigInt(request.plan.deadline)*1000n>BigInt(now()))||(operation==='withdrawRefund'&&!spent&&BigInt(request.plan.deadline)*1000n<=BigInt(now()))||(operation==='recover'&&vault.deployed&&vault.status===0))){
    const call=auroraSwapCall(request,operation),bytes=Buffer.from(call.args,'base64'),result=await rpc('eth_call',[{from:operatorAddress,to:d.factory,data:'0x'+bytes.subarray(57).toString('hex'),value:'0x0'},block],signal);check(result==='0x','The original private factory simulation changed its result.');simulateValid=true;
   }
  }
  const canonical=await rpc('eth_getBlockByNumber',[block,false],signal);check(canonical?.hash===snapshot.block.hash,'The private swap snapshot is no longer canonical.');
  return {snapshot,factoryVault:factoryVault.toLowerCase(),factoryBindingsVerified:true,knownRoot,spent,vault,proofValid,simulateValid,beneficiaryOutputBalance:beneficiaryOutputBalance.toString(),beneficiaryInputBalance:beneficiaryInputBalance.toString()};
 }
 return Object.freeze({snapshot:()=>snapshotReader.snapshot({}),swapState});
}
export async function openAuroraSwapService({stateDir,deployerKeyFile,operatorId,engineCodeHash,maxRequests=5,fetchImpl=fetch}={}){
 const journal=await openAuroraPrivateJournal({stateDir,fileName:'swap-state.json',initial:emptyAuroraSwapJournal});let runtime;
 try{
  runtime=await openAuroraSponsorRuntime({deployerKeyFile,operatorId,engineCodeHash});const reader=createAuroraSwapReader({fetchImpl,operatorAddress:runtime.operatorAddress});
  const rpc={...reader,operatorState:runtime.operatorState,send:runtime.send,transaction:runtime.transaction,settle:runtime.settle};
  const service=createAuroraSwapService({rpc,signer:runtime,journal,operatorId,operatorAddress:runtime.operatorAddress,maxRequests,serialize:runtime.serialize});let closed=false;
  return Object.freeze({...service,async close(){if(closed)return;closed=true;await runtime.close();await journal.close();}});
 }catch(error){await runtime?.close();await journal.close();throw error;}
}
