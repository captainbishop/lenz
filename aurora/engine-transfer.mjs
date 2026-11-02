// Strict direct ERC-20 receipt interpretation. No token trust or ledger credit.
import assert from 'node:assert/strict';
import {id} from 'ethers';
import {nearImplicitAddress} from './engine-codec.mjs';
import {validateEngineReference,inspectEngineTransaction,checkEngineTransaction} from './engine-receipt.mjs';
const TRANSFER=id('Transfer(address,address,uint256)');
const TRUE='0x'+'0'.repeat(63)+'1',FALSE='0x'+'0'.repeat(64),ZERO='0x'+'0'.repeat(40);
const word=address=>'0x'+'0'.repeat(24)+address.slice(2);
function expected(reference,payment){
  const ref=validateEngineReference(reference);
  const fields=['version','network','engine','token','from','to','amount'];
  assert(payment&&typeof payment==='object'&&!Array.isArray(payment)&&Object.keys(payment).length===fields.length&&fields.every(k=>Object.hasOwn(payment,k)),'Unexpected transfer fields');
  const p={...payment};
  assert(p.version===1&&p.network==='testnet'&&p.engine==='aurora','Unsupported transfer domain');
  for(const field of ['token','from','to'])assert(typeof p[field]==='string'&&/^0x[0-9a-f]{40}$/.test(p[field])&&p[field]!==ZERO,'Expected a nonzero lowercase address');
  assert(p.from!==p.to,'Self transfers are outside this payment check');
  assert(typeof p.amount==='string'&&/^[1-9][0-9]{0,77}$/.test(p.amount)&&BigInt(p.amount)<(1n<<256n),'Expected a positive uint256 amount');
  assert(ref.contract.toLowerCase()===p.token&&ref.value==='0','Different token or attached EVM value');
  assert(nearImplicitAddress(ref.sender)===p.from,'Different Engine caller');
  const calldata='0xa9059cbb'+word(p.to).slice(2)+BigInt(p.amount).toString(16).padStart(64,'0');
  assert(ref.input.toLowerCase()===calldata,'Different transfer calldata');
  return {ref,p};
}
function report(p,execution){
  const result=(state,reason)=>({execution,transfer:{state,...(reason?{reason}:{})}});
  if(execution.state!=='evm_succeeded')return result('unconfirmed',execution.state);
  if(execution.evm.output===FALSE)return result('not_reported','false_return');
  if(execution.evm.output!==TRUE)return result('unverified','unsupported_return');
  const transfers=execution.evm.logs.filter(log=>log.topics[0]===TRANSFER);
  if(transfers.length!==1)return result('unverified','transfer_log_count');
  const log=transfers[0],amount='0x'+BigInt(p.amount).toString(16).padStart(64,'0');
  if(log.address!==p.token||log.topics.length!==3||log.topics[1]!==word(p.from)||log.topics[2]!==word(p.to)||log.data!==amount)
    return result('unverified','transfer_log_mismatch');
  return {execution,transfer:{state:'reported',token:p.token,from:p.from,to:p.to,amount:p.amount}};
}
export function inspectEngineTransfer(reference,payment,transaction){
  const {ref,p}=expected(reference,payment);
  return report(p,inspectEngineTransaction(ref,transaction));
}
export async function checkEngineTransfer(reference,payment,options={}){
  const {ref,p}=expected(reference,payment);
  return report(p,await checkEngineTransaction(ref,options));
}
