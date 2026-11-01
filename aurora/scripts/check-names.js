// Public RPC observations only; no keys, signatures or financial methods.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolveName} from '../name-resolution.mjs';
const config=JSON.parse(await readFile(new URL('../../web/public/near-config.json',import.meta.url)));
assert(config.network==='testnet' && config.contract.endsWith('.testnet'));
const cases=[{system:'ens',name:'ur.integration-tests.eth',network:'mainnet'},
  {system:'near',name:'wrap.near',network:'mainnet'},{system:'near',name:config.contract,network:'testnet'}];
const results=[];
for(const input of cases){const result=await resolveName(input);assert.equal(result.state,input.system==='ens'?'address_found':'account_found',JSON.stringify(result));
  if(input.system==='ens')assert.equal(result.auroraAddress,'0x2222222222222222222222222222222222222222');
  results.push(result);console.log('PASS live name lookup: '+input.name);}
const source=await readFile(new URL('../name-resolution.mjs',import.meta.url));
await writeFile(new URL('../name-resolution-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),sourceSha256:createHash('sha256').update(source).digest('hex'),scope:'Read-only public RPC observations at final blocks; no identity ownership verification, signing, deployment or financial transaction.',results},null,2)+'\n');
