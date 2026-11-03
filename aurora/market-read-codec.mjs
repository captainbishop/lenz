import { Interface } from 'ethers';
// Fixed read/simulation ABI. All calls use eth_call; no transaction builder.
const abi = new Interface([
  'function decimals() view returns (uint8)',
  'function getPool(address,address,uint24) view returns (address)',
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function fee() view returns (uint24)', 'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function getReservesList() view returns (address[])',
  'function getConfiguration(address) view returns (uint256)',
  'function factory() view returns (address)', 'function WETH9() view returns (address)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)',
]);
export const readCalldata = (method,args=[]) => abi.encodeFunctionData(method,args);
export const readResult = (method,data) => {
  const decoded=abi.decodeFunctionResult(method,data);
  if(abi.encodeFunctionResult(method,decoded).toLowerCase()!==data.toLowerCase())throw Error('Noncanonical market result');
  return decoded;
};
