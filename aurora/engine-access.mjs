// Current NEAR key permissions for a saved signed call; not Lenz payment approval.
import assert from 'node:assert/strict';
import {decodeBase58,encodeBase58} from 'ethers';
import {validateSignedEngineCall} from './engine-signed.mjs';
import {rpcOptions,submissionRpc} from './engine-submit-rpc.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function keys(value,expected){assert(object(value)&&Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k)),'Unexpected access-key fields');}
function blockHash(value){
  assert(typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),'Invalid access-key block hash');
  const hex=decodeBase58(value).toString(16);assert(hex.length<=64&&encodeBase58(Buffer.from(hex.padStart(64,'0'),'hex'))===value,'Invalid access-key block hash');
}
function inspect(artifact,key){
  keys(key,['nonce','permission','block_hash','block_height']);blockHash(key.block_hash);
  assert(Number.isSafeInteger(key.block_height)&&key.block_height>0,'Invalid access-key height');
  assert(Number.isSafeInteger(key.nonce)&&key.nonce>=0,'Unsafe access-key nonce');
  const base={txHash:artifact.reference.txHash,publicKey:artifact.publicKey,block:{hash:key.block_hash,height:key.block_height},accessKeyNonce:String(key.nonce)};
  const blocked=reason=>({...base,state:'blocked',reason});
  const nonce=BigInt(artifact.nonce),ceiling=BigInt(key.block_height)*1000000n,max=(1n<<64n)-1n;
  if(nonce<=BigInt(key.nonce))return blocked('nonce_used');
  if(nonce>=(ceiling>max?max:ceiling))return blocked('nonce_too_large');
  let permission='FullAccess',allowance=null;
  if(key.permission!=='FullAccess'){
    keys(key.permission,['FunctionCall']);const fc=key.permission.FunctionCall;
    keys(fc,['allowance','receiver_id','method_names']);
    assert(typeof fc.receiver_id==='string'&&fc.receiver_id.length<=64,'Invalid permission receiver');
    assert(Array.isArray(fc.method_names)&&fc.method_names.length<=128&&fc.method_names.every(m=>typeof m==='string'&&Buffer.byteLength(m)<=256),'Invalid permission methods');
    assert(fc.allowance===null||(typeof fc.allowance==='string'&&/^(?:0|[1-9][0-9]{0,38})$/.test(fc.allowance)&&BigInt(fc.allowance)<(1n<<128n)),'Invalid permission allowance');
    if(fc.receiver_id!==artifact.reference.engine)return blocked('receiver_not_permitted');
    if(fc.method_names.length>0&&!fc.method_names.includes('call'))return blocked('method_not_permitted');
    if(fc.allowance==='0')return blocked('allowance_exhausted');
    permission='FunctionCall';allowance=fc.allowance;
  }
  return {...base,state:'permitted',permission,allowance};
}
export async function checkEngineAccessKey(reference,signedTxBase64,options={}){
  const artifact=validateSignedEngineCall(reference,signedTxBase64),opts=rpcOptions(options);
  try{
    const key=await submissionRpc('query',{request_type:'view_access_key',finality:'final',
      account_id:artifact.reference.sender,public_key:artifact.publicKey},opts);
    return inspect(artifact,key);
  }catch(error){
    return {state:error.code==='ERR_ASSERTION'?'unverified':'unavailable',txHash:artifact.reference.txHash};
  }
}
