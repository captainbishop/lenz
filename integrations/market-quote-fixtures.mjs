import {createRequire} from 'node:module';
import {MARKET_READS} from './market-discovery.mjs';
import {BASE_QUOTER} from './market-quotes.mjs';
import {QUOTE_POOL} from '../web/public/market-quote.js';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const abi=new Interface(['function decimals() view returns(uint8)','function getPool(address,address,uint24) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function factory() view returns(address)','function WETH9() view returns(address)','function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
export const NOW=1800000000000;
export const SWAP={provider:'uniswap',marketId:QUOTE_POOL,side:'usdc-to-weth',amount:'2',privacy:'public',slippageBps:50};
export const PERP={provider:'hyperliquid',marketId:'hyperliquid:0:ETH',side:'buy',amount:'1.5',privacy:'public'};
export function quoteMock(edit=()=>{}){
  const calls=[],block={number:'0x1234',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+BigInt((NOW-1000)/1000).toString(16)};
  const meta=[{collateralToken:0,universe:[{name:'ETH',szDecimals:3,maxLeverage:25}]},[{markPx:'1001',oraclePx:'1001',funding:'0.0001',openInterest:'100'}]];
  const book={coin:'ETH',time:NOW-500,levels:[[{px:'1000.1',sz:'1',n:2},{px:'1000',sz:'2',n:1}],[{px:'1001',sz:'1',n:2},{px:'1001.1',sz:'2',n:1}]]};
  const fetcher=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,options,request});
    if(url===MARKET_READS.hyperliquid){const value=structuredClone(request.type==='l2Book'?book:meta);edit({request,value});return Response.json(value);}
    let result;
    if(request.method==='eth_chainId')result='0x2105';
    else if(request.method==='eth_getBlockByNumber')result={...block};
    else if(request.method==='eth_getCode')result='0x6001';
    else if(request.method==='eth_call'){
      const tx=request.params[0],parsed=abi.parseTransaction({data:tx.data}),name=parsed.name;
      const state={request,name,parsed,values:{decimals:[tx.to===MARKET_READS.tokens[0].id?18:6],getPool:[QUOTE_POOL.slice(8)],token0:[MARKET_READS.tokens[0].id],token1:[MARKET_READS.tokens[1].id],fee:[500],liquidity:[1000],slot0:[2n**96n,0,0,1,1,0,true],factory:[MARKET_READS.factory],WETH9:[MARKET_READS.tokens[0].id],quoteExactInputSingle:[777777777n,2n**96n,1,120000]}[name]};
      edit(state);result=abi.encodeFunctionResult(name,state.values);
    }else throw Error('Unexpected RPC method '+request.method);
    const response={jsonrpc:'2.0',id:request.id,result};edit({request,response});return Response.json(response);
  };
  return {fetcher,clock:()=>NOW,calls,block,quoter:BASE_QUOTER};
}
