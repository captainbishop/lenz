// Synthetic NEAR receipts around explicit ERC-20 event fixtures. Never broadcast.
import {Interface} from 'ethers';
import {nearImplicitAddress} from './engine-codec.mjs';
import {fixture,finalTransaction} from './engine-submission-fixtures.mjs';
export const abi=new Interface(['function transfer(address,uint256) returns (bool)','event Transfer(address indexed from,address indexed to,uint256 amount)']);
export function transferFixture(amount='1000000'){
  const payment={version:1,network:'testnet',engine:'aurora',token:'0x'+'12'.repeat(20),from:nearImplicitAddress('relay.testnet'),to:'0x'+'34'.repeat(20),amount};
  const signed=fixture({reference:{contract:payment.token,input:abi.encodeFunctionData('transfer',[payment.to,BigInt(amount)])}});
  const event=abi.encodeEventLog(abi.getEvent('Transfer'),[payment.from,payment.to,BigInt(amount)]);
  return {...signed,payment,log:{address:payment.token,...event}};
}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const vector=bytes=>Buffer.concat([u32(bytes.length),bytes]);
export function transferReceipt(ref,{logs=[],output=abi.encodeFunctionResult('transfer',[true]),tag=0,sideFailure=false}={}){
  const tx=finalTransaction(ref,{sideFailure}),gas=Buffer.alloc(8);gas.writeBigUInt64LE(50000n);
  const encoded=Buffer.concat([Buffer.from([7,tag]),vector(Buffer.from(output.slice(2),'hex')),gas,u32(logs.length),
    ...logs.flatMap(log=>[Buffer.from(log.address.slice(2),'hex'),u32(log.topics.length),...log.topics.map(t=>Buffer.from(t.slice(2),'hex')),vector(Buffer.from(log.data.slice(2),'hex'))])]);
  const status={SuccessValue:encoded.toString('base64')};tx.status=status;tx.receipts_outcome[0].outcome.status=status;return tx;
}
