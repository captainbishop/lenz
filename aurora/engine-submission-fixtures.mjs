// Disposable signatures and synthetic receipts. Never broadcast these fixtures.
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {encodeBase58} from 'ethers';
import {encodeCall} from './engine-codec.mjs';
export const operation='a'.repeat(64);
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const vector=b=>Buffer.concat([u32(b.length),b]),text=s=>vector(Buffer.from(s));
export function fixture({reference:changes={},wire={}}={}){
  const reference={version:1,network:'testnet',engine:'aurora',sender:'relay.testnet',gas:'250000000000000',contract:'0x'+'12'.repeat(20),value:'0',input:'0xaabb',...changes};
  const keys=generateKeyPairSync('ed25519'),publicBytes=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const args=encodeCall({contract:reference.contract,value:BigInt(reference.value),input:Buffer.from(reference.input.slice(2),'hex')});
  const w={sender:reference.sender,receiver:'aurora',keyTag:0,nonce:1n,block:Buffer.alloc(32,17),count:1,tag:2,method:'call',args,gas:BigInt(reference.gas),deposit:Buffer.alloc(16),signatureTag:0,...wire};
  const unsigned=Buffer.concat([text(w.sender),Buffer.from([w.keyTag]),publicBytes,u64(w.nonce),text(w.receiver),w.block,u32(w.count),Buffer.from([w.tag]),text(w.method),vector(w.args),u64(w.gas),w.deposit]);
  const hash=createHash('sha256').update(unsigned).digest();reference.txHash=encodeBase58(hash);
  const bytes=Buffer.concat([unsigned,Buffer.from([w.signatureTag]),sign(null,hash,keys.privateKey)]);
  return {reference,signedTxBase64:bytes.toString('base64'),unsigned,publicBytes};
}
export function finalTransaction(ref,{tag=0,output=Buffer.alloc(0),sideFailure=false}={}){
  const u=Buffer.alloc(8);u.writeBigUInt64LE(21000n);
  const encoded=Buffer.concat([Buffer.from([7,tag]),vector(output),u,u32(0)]).toString('base64');
  const status={SuccessValue:encoded},id=n=>'1'.repeat(31)+n;
  return {final_execution_status:'FINAL',transaction:{hash:ref.txHash,signer_id:ref.sender,receiver_id:'aurora',
    actions:[{FunctionCall:{method_name:'call',args:encodeCall({contract:ref.contract,value:BigInt(ref.value),input:Buffer.from(ref.input.slice(2),'hex')}).toString('base64'),gas:Number(ref.gas),deposit:'0'}}]},
    transaction_outcome:{id:ref.txHash,outcome:{executor_id:ref.sender,receipt_ids:[id('2')],status:{SuccessReceiptId:id('2')}}},
    receipts_outcome:[{id:id('2'),outcome:{executor_id:'aurora',receipt_ids:[id('3')],status}},
      {id:id('3'),outcome:{executor_id:ref.sender,receipt_ids:[],status:sideFailure?{Failure:{ActionError:{kind:'refund failed'}}}:{SuccessValue:''}}}],status};
}
export const accessKey=()=>({nonce:0,permission:'FullAccess',block_hash:'1'.repeat(31)+'2',block_height:1000});
export const response=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200});
export function rpcFixture({read={final_execution_status:'NONE'},send={final_execution_status:'NONE'},chain='testnet',access=accessKey()}={}){
  const requests=[];
  const fetchImpl=async(url,init)=>{
    if(url!=='https://test.rpc.fastnear.com'||init.redirect!=='error')throw Error('Unexpected RPC destination');
    const body=JSON.parse(init.body);requests.push(body);
    if(body.method==='status')return response({chain_id:chain});
    if(body.method==='query'){if(access instanceof Error)throw access;return response(typeof access==='function'?access(body):access);}
    if(body.method==='tx')return response(typeof read==='function'?read(body):read);
    if(body.method==='send_tx'){if(send instanceof Error)throw send;return response(typeof send==='function'?send(body):send);}
    throw Error('Unexpected RPC method');
  };
  return {fetchImpl,requests};
}
