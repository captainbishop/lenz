import {Interface,keccak256} from 'ethers';

// Tornado Classic native-asset withdrawal ABI. No signer or RPC access.
const abi=new Interface(['function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)']);
export function decodeTornadoWithdrawal(data){
  const decoded=abi.decodeFunctionData('withdraw',data);
  if(abi.encodeFunctionData('withdraw',decoded)!==data)throw Error('Noncanonical withdrawal data');
  const [proof,root,nullifierHash,recipient,relayer,fee,refund]=decoded;
  return {proof,proofHash:keccak256(proof),root,nullifierHash,recipient:recipient.toLowerCase(),relayer:relayer.toLowerCase(),fee:fee.toString(),refund:refund.toString()};
}
