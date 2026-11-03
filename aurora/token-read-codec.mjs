import {Interface} from 'ethers';
const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
export const tokenCalldata=(method,args=[])=>abi.encodeFunctionData(method,args);
export function tokenResult(method,data){
 const result=abi.decodeFunctionResult(method,data);
 if(abi.encodeFunctionResult(method,result).toLowerCase()!==data.toLowerCase())throw Error('Noncanonical token response');
 return result[0];
}
