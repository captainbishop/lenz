import assert from 'node:assert/strict';
import {keccak256,toUtf8Bytes} from 'ethers';

export const ENGINE_SOURCE = 'f296f06ab618468dff58cbef81732b1d0ee1782e';
export const MAX_ENGINE_BYTES = 65536;
const MAX_INPUT_BYTES = 32768;
const statusNames = ['Succeed','Revert','OutOfGas','OutOfFund','OutOfOffset','CallTooDeep','StackUnderflow','StackOverflow','InvalidJump','InvalidRange','DesignatedInvalid','CreateCollision','CreateContractLimit','InvalidCode','PCUnderflow','CreateEmpty','MaxNonce','UsizeOverflow','Other','CreateContractStartingWithEF'];

function address(value){
  assert(typeof value==='string' && /^0x[0-9a-fA-F]{40}$/.test(value),'Expected a 20-byte EVM address.');
  return Buffer.from(value.slice(2),'hex');
}
function account(value){
  assert(typeof value==='string'&&value.length>=2&&value.length<=64&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value),'Invalid NEAR account ID.');
  return Buffer.from(value,'ascii');
}
function uint256(value){
  assert(typeof value==='bigint'&&value>=0n&&value<(1n<<256n),'Value must be an unsigned 256-bit bigint.');
  return Buffer.from(value.toString(16).padStart(64,'0'),'hex');
}
function vector(bytes){const length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes]);}
function inputBytes(value){assert(value instanceof Uint8Array&&value.byteLength<=MAX_INPUT_BYTES,'Expected bounded calldata bytes.');return Buffer.from(value);}
export function nearImplicitAddress(accountId){return '0x'+keccak256(toUtf8Bytes(account(accountId).toString('ascii'))).slice(-40);}
export function encodeCall({contract,value=0n,input=new Uint8Array()}){
  // Borsh enum V2 = 0. WeiU256 is a raw big-endian byte array, not a Borsh integer.
  return Buffer.concat([Buffer.from([0]),address(contract),uint256(value),vector(inputBytes(input))]);
}
export function encodeView({sender,contract,value=0n,input=new Uint8Array()}){
  return Buffer.concat([address(sender),address(contract),uint256(value),vector(inputBytes(input))]);
}
export const encodeTokenLookup = accountId => vector(account(accountId));
export const encodeTokenDeployment = accountId => Buffer.concat([Buffer.from([1]),vector(account(accountId))]);
export function decodeTokenAddress(bytes){
  assert(bytes instanceof Uint8Array&&bytes.byteLength===20,'Expected a raw 20-byte token mapping.');
  return '0x'+Buffer.from(bytes).toString('hex');
}
class Reader{
  constructor(input){assert(input instanceof Uint8Array&&input.byteLength<=MAX_ENGINE_BYTES,'Engine response too large or not bytes.');this.bytes=Buffer.from(input);this.offset=0;}
  take(n){assert(Number.isSafeInteger(n)&&n>=0&&n<=this.bytes.length-this.offset,'Truncated Engine response.');const data=this.bytes.subarray(this.offset,this.offset+n);this.offset+=n;return data;}
  byte(){return this.take(1)[0];}
  count(max){const n=this.take(4).readUInt32LE();assert(n<=max,'Engine vector limit exceeded.');return n;}
  vector(){return this.take(this.count(MAX_ENGINE_BYTES));}
  end(){assert(this.offset===this.bytes.length,'Trailing Engine response bytes.');}
}
function readStatus(reader){
  const tag=reader.byte();assert(tag<statusNames.length,'Unknown Engine transaction status.');
  const result={status:statusNames[tag],succeeded:tag===0};
  if(tag<=1)result.output='0x'+reader.vector().toString('hex');
  if(tag===13)result.opcode=reader.byte();
  if(tag===18)result.error=new TextDecoder('utf-8',{fatal:true}).decode(reader.vector());
  return result;
}
export function decodeViewResult(bytes){const reader=new Reader(bytes),status=readStatus(reader);reader.end();return status;}
export function decodeSubmitResult(bytes){
  const reader=new Reader(bytes);assert(reader.byte()===7,'Unsupported Engine SubmitResult version.');
  const result=readStatus(reader);result.gasUsed=reader.take(8).readBigUInt64LE();result.logs=[];
  const length=reader.count(128);
  for(let i=0;i<length;i++){
    const log={address:'0x'+reader.take(20).toString('hex'),topics:[]};
    const topics=reader.count(4);for(let j=0;j<topics;j++)log.topics.push('0x'+reader.take(32).toString('hex'));
    log.data='0x'+reader.vector().toString('hex');result.logs.push(log);
  }
  reader.end();return result;
}
