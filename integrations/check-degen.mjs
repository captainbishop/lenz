import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkedDiscovery,checkedCandles} from '../web/public/degen-model.js';
const files=['integrations/degen-discovery.mjs','web/degen-relay.mjs','web/public/degen-model.js','integrations/check-degen.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),sources=await hashes();
async function read(request){const res=await fetch('http://127.0.0.1:4173/api/degen/read',{method:'POST',headers:{origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});assert.equal(res.status,200,await res.clone().text());const value=await res.json();return request.kind==='candles'?checkedCandles(value,request):checkedDiscovery(value,request);}
const results=[];
for(const request of [{provider:'geckoterminal',kind:'feed',feed:'trending'},{provider:'geckoterminal',kind:'feed',feed:'new'},{provider:'dexscreener',kind:'search',query:'pepe'},{provider:'geckoterminal',kind:'search',query:'pepe'}]){const value=await read(request);assert(value.rows.length>0);results.push(value);console.log(request.provider,request.kind,value.rows.length,'pools');}
const row=results[0].rows[0];const candles=await read({provider:'geckoterminal',kind:'candles',network:row.network,pool:row.pool,address:row.address,interval:'5m'});assert(candles.candles.length>0);console.log(candles.candles.length,'candles');
assert.deepEqual(await hashes(),sources);await writeFile('integrations/degen-live-results.json',JSON.stringify({checkedAt:new Date().toISOString(),sources,results,candles,scope:'Public read-only discovery through the local app HTTP route. No wallet, signing, trading or user account access.'},null,2)+'\n');
