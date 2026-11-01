import assert from 'node:assert/strict';
import {Interface,ensNormalize,dnsEncode,namehash,getAddress} from 'ethers';
import {nearImplicitAddress} from './engine-codec.mjs';

export const UNIVERSAL_RESOLVER='0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const endpoints={ens:'https://ethereum-rpc.publicnode.com',mainnet:'https://rpc.mainnet.near.org',testnet:'https://test.rpc.fastnear.com'};
const chains={mainnet:1313161554,testnet:1313161555};
const zero='0x'+'00'.repeat(20),maxBytes=128*1024;
const universal=new Interface(['function resolve(bytes name,bytes data) view returns(bytes result,address resolver)',
  'error ResolverNotFound(bytes name)','error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)']);
const addressRecord=new Interface(['function addr(bytes32 node,uint256 coinType) view returns(bytes)']);
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const hex=x=>typeof x==='string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(x) && x.length<=maxBytes*2+2;
const nearHash=x=>typeof x==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const quantity=x=>typeof x==='string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(x);
class TransportError extends Error{}
class RpcError extends Error{constructor(value){super('Name RPC error');this.value=value;}}

export function nameRequest(input){
  assert(object(input) && Object.keys(input).sort().join(',')==='name,network,system','Expected name, network and system');
  const {name,network,system}=input;
  assert(Object.hasOwn(chains,network) && ['ens','near'].includes(system),'Unsupported naming network');
  assert(typeof name==='string' && name.length>0 && name.length<=255 && name===name.trim(),'Enter a name without surrounding whitespace');
  let normalized;
  if(system==='near'){
    assert(name.length<=64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name),'Invalid NEAR account name');
    assert(name.endsWith(network==='mainnet'?'.near':'.testnet'),'Account suffix does not match the selected network');normalized=name;
  }else{
    normalized=ensNormalize(name);assert(normalized.includes('.') && normalized.length<=255,'Expected a full ENS name');dnsEncode(normalized,255);
  }
  return {name:normalized,requestedName:name,network,system,chainId:chains[network]};
}

// Public naming observations only. No keys, signatures, funds or contact writes.
export async function resolveName(input,{fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  const request=nameRequest(input),{name,network,system,chainId}=request;
  assert(typeof fetchImpl==='function' && Number.isSafeInteger(timeoutMs) && timeoutMs>0 && timeoutMs<=60000,'Invalid lookup options');
  const controller=new AbortController(),{signal}=controller;let timer,reader;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new TransportError('Name lookup timed out');controller.abort(error);reject(error);},timeoutMs);});
  const base={version:1,...request,identityBinding:'not_verified'};
  async function rpc(endpoint,method,params){
    let response;
    try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
    catch{throw new TransportError('Name provider unavailable');}
    if(signal.aborted || !response.ok){void response.body?.cancel().catch(()=>{});throw new TransportError('Name provider unavailable');}
    assert(response.body,'Empty name RPC response');const currentReader=response.body.getReader();reader=currentReader;
    const chunks=[];let size=0;
    try{
      for(;;){signal.throwIfAborted();let part;try{part=await currentReader.read();}catch{throw new TransportError('Interrupted response');}
        if(part.done)break;size+=part.value.byteLength;assert(size<=maxBytes,'Name RPC response too large');chunks.push(part.value);}
    }finally{void currentReader.cancel().catch(()=>{});currentReader.releaseLock();if(reader===currentReader)reader=null;}
    signal.throwIfAborted();
    const reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    assert(object(reply) && reply.jsonrpc==='2.0' && reply.id===1 && Object.hasOwn(reply,'result')!==Object.hasOwn(reply,'error'),'Invalid name RPC envelope');
    if(Object.hasOwn(reply,'error')){assert(object(reply.error) && Number.isInteger(reply.error.code) && typeof reply.error.message==='string','Invalid RPC error');throw new RpcError(reply.error);}
    return reply.result;
  }
  async function lookup(){
    if(system==='near'){
      const endpoint=endpoints[network],status=await rpc(endpoint,'status',[]);assert(status?.chain_id===network,'Different NEAR network');
      const block=await rpc(endpoint,'block',{finality:'final'}),header=block?.header;
      assert(nearHash(header?.hash) && Number.isSafeInteger(header.height) && header.height>0,'Invalid final NEAR block');
      const observation={...base,authority:'near:'+network,block:{hash:header.hash,height:header.height},checkedAt:new Date().toISOString()};
      let account;
      try{account=await rpc(endpoint,'query',{request_type:'view_account',account_id:name,block_id:header.hash});}
      catch(error){
        const cause=error instanceof RpcError?error.value.data?.cause:null;
        if(cause?.name==='UNKNOWN_ACCOUNT' && cause.info?.requested_account_id===name)return {...observation,state:'not_found'};
        throw error;
      }
      assert(object(account) && account.block_hash===header.hash && account.block_height===header.height,'NEAR account block mismatch');
      for(const key of ['amount','locked'])assert(typeof account[key]==='string' && /^(?:0|[1-9][0-9]{0,38})$/.test(account[key]) && BigInt(account[key])<(1n<<128n),'Invalid account amount');
      assert(nearHash(account.code_hash) && Number.isSafeInteger(account.storage_usage) && account.storage_usage>=0,'Invalid account response');
      return {...observation,state:'account_found',accountId:name,auroraAddress:nearImplicitAddress(name),addressKind:'derived-near-caller'};
    }
    const endpoint=endpoints.ens;
    assert(await rpc(endpoint,'eth_chainId',[])==='0x1','ENS must resolve from Ethereum mainnet');
    const block=await rpc(endpoint,'eth_getBlockByNumber',['finalized',false]);
    assert(object(block) && typeof block.hash==='string' && /^0x[0-9a-fA-F]{64}$/.test(block.hash) && quantity(block.number),'Invalid final Ethereum block');
    const coinType=(BigInt(chainId)|0x80000000n).toString(),dnsName=dnsEncode(name,255);
    const data=universal.encodeFunctionData('resolve',[dnsName,addressRecord.encodeFunctionData('addr',[namehash(name),coinType])]);
    const observation={...base,authority:'ethereum:mainnet',coinType,block:{hash:block.hash,height:BigInt(block.number).toString()},checkedAt:new Date().toISOString()};
    let encoded;
    try{encoded=await rpc(endpoint,'eth_call',[{to:UNIVERSAL_RESOLVER,data},{blockHash:block.hash,requireCanonical:true}]);}
    catch(error){
      if(error instanceof RpcError && hex(error.value.data)){
        let parsed;try{parsed=universal.parseError(error.value.data);}catch{}
        if(parsed && universal.encodeErrorResult(parsed.fragment,parsed.args).toLowerCase()===error.value.data.toLowerCase()){
          if(parsed.name==='ResolverNotFound' && parsed.args[0]===dnsName)return {...observation,state:'not_found'};
          if(parsed.name==='OffchainLookup' && parsed.args[0]===UNIVERSAL_RESOLVER)return {...observation,state:'offchain_required'};
        }
      }
      throw error;
    }
    assert(hex(encoded),'Invalid ENS return bytes');
    const decoded=universal.decodeFunctionResult('resolve',encoded);
    assert(universal.encodeFunctionResult('resolve',decoded).toLowerCase()===encoded.toLowerCase(),'Noncanonical ENS result');
    const [record,resolver]=decoded;assert(resolver!==zero,'Missing ENS resolver');
    const address=addressRecord.decodeFunctionResult('addr',record)[0];
    assert(addressRecord.encodeFunctionResult('addr',[address]).toLowerCase()===record.toLowerCase(),'Invalid address result');
    if(address==='0x' || address===zero)return {...observation,state:'no_address',resolver};
    assert(/^0x[0-9a-fA-F]{40}$/.test(address),'ENS returned a non-EVM address');
    return {...observation,state:'address_found',resolver,auroraAddress:getAddress(address),addressKind:'ens-aurora-record'};
  }
  try{return await Promise.race([lookup(),deadline]);}
  catch(error){return {...base,state:signal.aborted || error instanceof TransportError || error instanceof RpcError?'unavailable':'unverified'};}
  finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();reader=null;}}
}
