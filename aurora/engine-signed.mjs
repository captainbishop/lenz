// A bounded NEAR V0/Ed25519 decoder for one reviewed Aurora Engine call.
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {encodeBase58} from 'ethers';
import {encodeCall} from './engine-codec.mjs';
import {validateEngineReference} from './engine-receipt.mjs';

export const MAX_SIGNED_BYTES=34*1024;
class Reader {
  constructor(bytes){this.bytes=bytes;this.offset=0;}
  take(n){assert(Number.isSafeInteger(n)&&n>=0&&n<=this.bytes.length-this.offset,'Truncated signed transaction');const result=this.bytes.subarray(this.offset,this.offset+n);this.offset+=n;return result;}
  byte(){return this.take(1)[0];}
  count(max){const n=this.take(4).readUInt32LE();assert(n<=max,'Signed transaction vector limit');return n;}
  text(max){return new TextDecoder('utf-8',{fatal:true}).decode(this.take(this.count(max)));}
}
export function validateSignedEngineCall(reference,signedTxBase64){
  const ref=validateEngineReference(reference);
  assert(typeof signedTxBase64==='string'&&signedTxBase64.length<=4*Math.ceil(MAX_SIGNED_BYTES/3),'Signed transaction size limit');
  const bytes=Buffer.from(signedTxBase64,'base64');
  assert(bytes.length<=MAX_SIGNED_BYTES&&bytes.toString('base64')===signedTxBase64,'Noncanonical signed transaction');
  const r=new Reader(bytes);
  assert(bytes[0]!==1,'Only NEAR V0 transactions are supported');
  assert(r.text(64)===ref.sender,'Signed transaction has a different sender');
  assert(r.byte()===0,'Only Ed25519 access keys are supported');const publicKey=r.take(32);
  const nonce=r.take(8).readBigUInt64LE();assert(nonce>0n,'Nonce must be positive');
  assert(r.text(64)===ref.engine,'Signed transaction has a different receiver');const block=r.take(32);
  assert(r.count(1)===1&&r.byte()===2,'Expected exactly one FunctionCall action');
  assert(r.text(4)==='call','Expected the Engine call method');
  const args=r.take(r.count(32768+57));
  assert(args.equals(encodeCall({contract:ref.contract,value:BigInt(ref.value),input:Buffer.from(ref.input.slice(2),'hex')})),'Signed Engine arguments differ from the reviewed call');
  assert(r.take(8).readBigUInt64LE()===BigInt(ref.gas),'Signed gas differs from the reviewed call');
  assert(r.take(16).every(byte=>byte===0),'The Engine call must attach zero NEAR');
  const unsigned=bytes.subarray(0,r.offset),hash=createHash('sha256').update(unsigned).digest();
  assert(encodeBase58(hash)===ref.txHash,'Signed transaction hash differs from the reference');
  assert(r.byte()===0,'Only an Ed25519 signature is supported');const signature=r.take(64);
  assert(r.offset===bytes.length,'Trailing signed transaction bytes');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicKey]),type:'spki',format:'der'});
  assert(verify(null,hash,key,signature),'Invalid signed transaction signature');
  return {reference:Object.fromEntries(Object.keys(ref).sort().map(k=>[k,ref[k]])),signedTxBase64,
    nonce:nonce.toString(),publicKey:'ed25519:'+encodeBase58(publicKey),blockHash:encodeBase58(block)};
}
