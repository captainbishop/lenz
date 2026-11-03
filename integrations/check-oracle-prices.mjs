import {readOraclePrices} from './oracle-prices.mjs';
import {ORACLE_NETWORKS} from '../web/public/oracle-feeds.js';
import {writeFile} from 'node:fs/promises';
const results=await Promise.all(Object.keys(ORACLE_NETWORKS).map(async network=>{
  const started=Date.now();try{const snapshot=await readOraclePrices({network});console.log(network, snapshot.feeds.filter(f=>f.status==='current').length+'/'+snapshot.feeds.length,Date.now()-started+'ms');return {network,snapshot};}
  catch(error){const message=error.message||error.code||error.name;console.error(network,message);return {network,error:message};}
}));
await writeFile(new URL('./oracle-prices-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results,scope:'Public mainnet eth_call reads only. No account access, signature or transaction.'},null,2)+'\n');
if(results.some(r=>!r.snapshot||r.snapshot.feeds.some(f=>f.status!=='current')))process.exitCode=1;
