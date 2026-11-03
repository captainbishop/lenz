import {writeFile} from 'node:fs/promises';
import {discoverHyperliquid} from './market-discovery.mjs';
import {quoteMarket} from './market-quotes.mjs';
import {QUOTE_POOL} from '../web/public/market-quote.js';
const inputs=[{provider:'uniswap',marketId:QUOTE_POOL,side:'usdc-to-weth',amount:'1',slippageBps:50,privacy:'public'},{provider:'uniswap',marketId:QUOTE_POOL,side:'weth-to-usdc',amount:'0.001',slippageBps:50,privacy:'public'}];
const results=[];
try{const observation=await discoverHyperliquid(),eth=observation.rows.find(row=>row.instrument==='ETH'&&row.status==='listed');if(!eth)throw Error('ETH market unavailable');for(const side of ['buy','sell'])inputs.push({provider:'hyperliquid',marketId:eth.id,side,amount:'0.001',privacy:'public'});}catch(error){results.push({provider:'hyperliquid',ok:false,error:error.message});}
for(const input of inputs){try{results.push({provider:input.provider,side:input.side,ok:true,quote:await quoteMarket(input)});}catch(error){results.push({provider:input.provider,side:input.side,ok:false,error:error.message});}}
await writeFile(new URL('./market-quotes-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),scope:'Public mainnet quote simulations/order-book reads; no account, signing, funds or transaction',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({provider,side,ok,error,quote})=>({provider,side,ok,error,result:quote?.result,sourceTime:quote?.sourceTime})),null,2));if(results.some(r=>!r.ok))process.exitCode=1;
