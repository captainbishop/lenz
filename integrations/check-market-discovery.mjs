import {writeFile} from 'node:fs/promises';
import {discoverMarket} from './market-discovery.mjs';
import {MARKET_SOURCES} from '../web/public/evm-markets.js';
const providers=MARKET_SOURCES;
const results=await Promise.all(providers.map(async source=>{
  const provider=source.key;
  try {const observation=await discoverMarket(source.provider,source.network?{network:source.network}:{});return {provider,ok:true,count:observation.rows.length,observation:{...observation,rows:observation.rows.slice(0,5)}};}
  catch(error){return {provider,ok:false,error:error.message};}
}));
const report={checkedAt:new Date().toISOString(),scope:'Public mainnet reads only; no wallet identity, quote, signature or transaction',results};
await writeFile(new URL('./market-discovery-live.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(({provider,ok,count,error,observation})=>({provider,ok,count,error,block:observation?.evidence.blockNumber})),null,2));
if(results.some(r=>!r.ok))process.exitCode=1;
