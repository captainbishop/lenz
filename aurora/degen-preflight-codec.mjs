import {Interface,Transaction} from 'ethers';
const abi=new Interface([
 'function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)','function factory() view returns(address)',
 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
 'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])',
 'function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)',
]);
export const preflightCalldata=(method,args=[])=>abi.encodeFunctionData(method,args);
export function preflightResult(method,data){const value=abi.decodeFunctionResult(method,data);if(abi.encodeFunctionResult(method,value).toLowerCase()!==data.toLowerCase())throw Error('Noncanonical simulation result.');return value;}
export function unsignedSize(tx){return (Transaction.from({type:0,chainId:8453,...tx}).unsignedSerialized.length-2)/2;}
