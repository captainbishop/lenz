// Read-only Engine interface checks. No signer or transaction methods.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {encodeView,decodeViewResult,encodeTokenLookup,decodeTokenAddress} from '../engine-codec.mjs';
import {decodeEngineQuery,isMissingToken} from '../engine-query.mjs';
const endpoint='https://test.rpc.fastnear.com';
async function query(params){
  const signal=AbortSignal.timeout(20000);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'query',params}),redirect:'error',signal});
  if(!response.ok){await response.body?.cancel();throw Error('Engine RPC HTTP '+response.status);}
  assert(response.body,'Empty Engine RPC response');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;
    size+=value.length;assert(size<=128*1024,'Engine RPC reply too large');parts.push(value);}}
  finally{await reader.cancel();reader.releaseLock();}
  signal.throwIfAborted();
  const reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  assert(reply && !Array.isArray(reply) && reply.jsonrpc==='2.0' && reply.id===1 &&
    !Object.hasOwn(reply,'error') && reply.result, 'Invalid Engine RPC reply');
  return reply.result;
}
const account=await query({request_type:'view_account',account_id:'aurora',finality:'final'});
const hash=value=>typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
assert(hash(account.code_hash)&&hash(account.block_hash)&&Number.isSafeInteger(account.block_height)&&account.block_height>0);
const block={hash:account.block_hash,height:account.block_height},queries=[];
async function view(method,args){
  const argsBase64=Buffer.from(args).toString('base64');
  const result=await query({request_type:'call_function',account_id:'aurora',method_name:method,args_base64:argsBase64,block_id:block.hash});
  try{const bytes=decodeEngineQuery(result,block);queries.push({method,argsBase64,resultHex:bytes.toString('hex')});return bytes;}
  catch(error){if(isMissingToken(error))queries.push({method,argsBase64,contractError:error.message});throw error;}
}
const chainBytes=await view('get_chain_id',Buffer.alloc(0));assert.equal(chainBytes.length,32);
const chainId=BigInt('0x'+chainBytes.toString('hex'));assert.equal(chainId,1313161555n);
const zero='0x'+'00'.repeat(20),read=decodeViewResult(await view('view',encodeView({sender:zero,contract:zero})));assert(read.succeeded);
const config=JSON.parse(await readFile(new URL('../../web/public/near-config.json',import.meta.url)));
assert(config.network==='testnet'&&config.contract.endsWith('.testnet'));
let token;
try{token={account:config.contract,status:'mapped',address:decodeTokenAddress(await view('get_erc20_from_nep141',encodeTokenLookup(config.contract)))};}
catch(error){if(!isMissingToken(error))throw error;token={account:config.contract,status:'unmapped',error:'ERR_NEP141_NOT_FOUND'};}
const report={checkedAt:new Date().toISOString(),endpoint,engine:'aurora',block,codeHash:account.code_hash,
  chainId:chainId.toString(),view:read,token,queries,
  scope:'Read-only final-block RPC observations. No signing, funding, deployment or financial transaction. The observed code hash is not a source-revision attestation.'};
await writeFile(new URL('../engine-preflight-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
