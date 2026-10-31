// A single fallback Sapling claim after the prior Orchard claim definitively failed.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const action=process.argv[2]??'status';
assert(['claim-sapling','status'].includes(action));
const file=new URL('./valar-sapling-a-results.json',import.meta.url);
const provider='https://faucet.testnet.valargroup.dev';
let record;
if(action==='claim-sapling'){
  const previous=JSON.parse(await readFile(new URL('./valar-faucet-a-results.json',import.meta.url)));
  assert.equal(previous.status.status,'failed','Do not duplicate an ambiguous claim');
  const {saplingAddress:address}=JSON.parse(await readFile(new URL('./sapling-address-a-results.json',import.meta.url)));
  assert(address.startsWith('ztestsapling1'));
  record={provider,network:'testnet',address,state:'submission_pending',checkedAt:new Date().toISOString()};
  await writeFile(file,JSON.stringify(record,null,2)+'\n',{flag:'wx',flush:true});
  const response=await fetch(provider+'/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address}),signal:AbortSignal.timeout(45000)});
  record.httpStatus=response.status;record.response=await response.json();
}else{
  record=JSON.parse(await readFile(file));
  assert(/^[0-9a-f]+$/.test(record.response?.id),'No claim ID; reconcile manually before retry');
  const response=await fetch(provider+'/api/claim/'+record.response.id,{signal:AbortSignal.timeout(20000)});
  record.httpStatus=response.status;record.status=await response.json();
}
record.checkedAt=new Date().toISOString();
await writeFile(file,JSON.stringify(record,null,2)+'\n',{flush:true});
console.log(JSON.stringify(record,null,2));
if(record.httpStatus>=400||record.status?.status==='failed')process.exitCode=1;
