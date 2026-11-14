import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {createLendingSupplyReader} from './intent-lending-supply-read.mjs';
import {checkLendingFundingRequest} from './intent-lending-funding.mjs';

const check=(value,reason)=>{if(!value)throw Error(reason);};
const abi=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function commitments(bytes32) view returns(bool)']);
function abortable(work,signal){signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
export function createLendingFundingReader({deployment={},sponsorAddress,fetchImpl=fetch,now=Date.now,readSnapshot,timeoutMs=60000}={}){
  check(typeof sponsorAddress==='string'&&/^0x[0-9a-f]{40}$/.test(sponsorAddress)&&!/^0x0{40}$/.test(sponsorAddress)&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Pin the Lenz faucet sponsor and read timeout.');
  const config={...LENDING_TESTNET,...deployment};
  const readers=Object.fromEntries(['finalized','latest'].map(blockTag=>[blockTag,createLendingSupplyReader({deployment,fetchImpl,now,readSnapshot,timeoutMs,blockTag})]));
  let sequence=0;
  async function rpc(method,params,signal){
    const id=++sequence,response=await abortable(fetchImpl(config.rpc,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})}),signal);
    check(response.ok&&!response.redirected&&response.body,'The Lenz faucet network is unavailable.');const stream=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await abortable(stream.read(),signal);if(done)break;size+=value.byteLength;check(size<=1048576,'The faucet read response is too large.');chunks.push(value);}}finally{stream.cancel().catch(()=>{});stream.releaseLock();}
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Error('The faucet read response cannot be decoded.');}
    check(body?.jsonrpc==='2.0'&&body.id===id&&!Object.hasOwn(body,'error')&&Object.hasOwn(body,'result'),'The faucet RPC evidence is invalid.');return body.result;
  }
  async function fundingSnapshot(value,options={}){
    const input=checkLendingFundingRequest(value),blockTag=options.blockTag??'finalized';check(['finalized','latest'].includes(blockTag),'Choose a canonical faucet observation tag.');
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
    const snapshot=await readers[blockTag].snapshot({owner:input.ownerAddress,account:input.account},{signal}),block=snapshot.block,ref={blockHash:block.hash,requireCanonical:true};
    check(block.finality===blockTag&&await rpc('eth_chainId',[],signal)===config.chainHex,'The faucet observation network or finality changed.');
    async function read(target,name,args){
      const result=await rpc('eth_call',[{to:target,data:abi.encodeFunctionData(name,args)},ref],signal);check(typeof result==='string'&&/^0x[0-9a-f]{64}$/.test(result),'The faucet contract result is invalid.');
      const decoded=abi.decodeFunctionResult(name,result);check(abi.encodeFunctionResult(name,decoded)===result,'The faucet contract result is noncanonical.');return decoded[0];
    }
    const [inputBalance,allowance,deposited]=await Promise.all([read(config.link,'balanceOf',[sponsorAddress]),read(config.link,'allowance',[sponsorAddress,config.privacyPool]),read(config.privacyPool,'commitments',[input.commitment])]);
    const deposits=snapshot.privatePool.deposits.filter(row=>row.commitment===input.commitment);check(deposits.length<=1&&deposited===(deposits.length===1),'The original faucet commitment and complete pool history disagree.');
    const canonical=await rpc('eth_getBlockByNumber',['0x'+BigInt(block.number).toString(16),false],signal);check(canonical?.hash===block.hash&&BigInt(canonical.number)===BigInt(block.number)&&BigInt(canonical.timestamp)===BigInt(block.timestamp),'The faucet snapshot is no longer canonical.');
    return{snapshot,operator:{address:sponsorAddress,inputBalance:inputBalance.toString(),allowance:allowance.toString()},deposited,deposit:deposits[0]??null};
  }
  return Object.freeze({fundingSnapshot});
}
