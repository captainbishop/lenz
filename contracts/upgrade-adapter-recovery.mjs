// Defaults to a read-only plan. --apply upgrades only the configured testnet adapter.
import assert from 'node:assert/strict';
import {readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {Account,baseEncode} from 'near-api-js';
import {provider} from './client.mjs';
import {sha,applyAdapterUpgrade} from './adapter-upgrade.mjs';
const base=new URL('./adapter/redemption-recovery/',import.meta.url),configFile=new URL('../web/public/rhea-config.json',import.meta.url);
const planFile=new URL('rollout-plan.json',base),journalFile=new URL('rollout.json',base),lockFile=new URL('rollout.lock',base);
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const optional=async file=>{try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function save(file,value){const tmp=new URL(file.href+'.tmp');await writeFile(tmp,JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v,2)+'\n',{flush:true});await rename(tmp,file);}
assert(process.argv.slice(2).every(x=>x==='--apply'),'Only --apply is supported');
const [c,review,rehearsal,wasm,old,source,oldSource]=await Promise.all([
  json(configFile),json(new URL('verification.json',base)),json(new URL('rehearsal-verification.json',base)),
  readFile(new URL('candidate.wasm',base)),readFile(new URL('deployed-v1.wasm',base)),
  readFile(new URL('./adapter/src/lib.rs',import.meta.url),'utf8'),readFile(new URL('lib-before.rs',base),'utf8')]);
assert(c.ready&&c.network==='testnet'&&c.adapter==='lenz-rhea-1792987934062.testnet');
assert.equal(sha(wasm),review.candidate.sha256);assert.equal(sha(old),review.deployedBaseline.sha256);
for(const file of ['contracts/adapter/src/lib.rs','contracts/adapter/src/tests.rs','contracts/adapter/Cargo.lock','contracts/src/lib.rs']){
  assert.equal(sha(await readFile(new URL('../'+file,import.meta.url))),review.files.find(f=>f.file===file).sha256,'Reviewed source changed: '+file);
}
const start=source.indexOf('    /// Reconcile only a lost redemption callback'),end=source.indexOf('    #[private]\n    pub fn on_note',start);
assert(start>0&&end>start);assert.equal(source.slice(0,start)+source.slice(end),oldSource,'Existing methods or state changed');
assert(rehearsal.ok&&rehearsal.stepCount===27&&rehearsal.transactionCount===28);
assert.equal(sha(await readFile(new URL('rehearsal.json',base))),rehearsal.rehearsalSha256);
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,init={})=>nativeFetch(url,{...init,signal:AbortSignal.any([AbortSignal.timeout(15000),...(init.signal?[init.signal]:[])])});
async function rpc(label,method,args){try{return await provider.sendJsonRpc(method,args);}catch(e){throw new Error(label+': '+e.message,{cause:e});}}
console.log('Reading testnet network and configured adapter snapshot');
assert.equal((await rpc('Network status','status',[])).chain_id,'testnet');
const newCodeHash=baseEncode(Buffer.from(review.candidate.sha256,'hex'));
const expectedConfig={network:c.network,adapter:c.adapter,reserve:c.reserve,exchange:c.exchange,poolId:c.poolId,tokenOut:c.tokenOut};
async function snapshot(){
  const code=await rpc('Adapter code','query',{request_type:'view_code',finality:'final',account_id:c.adapter});
  const block={block_id:code.block_hash};
  const query=(account_id,request_type,extra={})=>rpc(request_type+' '+account_id,'query',{request_type,account_id,...block,...extra});
  const [state,config,reserve,exchange,keys]=await Promise.all([
    query(c.adapter,'view_state',{prefix_base64:'',include_proof:false}),
    query(c.adapter,'call_function',{method_name:'configuration',args_base64:'e30='}),
    query(c.reserve,'view_code'),query(c.exchange,'view_account'),query(c.adapter,'view_access_key_list')]);
  assert.deepEqual(JSON.parse(Buffer.from(config.result).toString()),expectedConfig,'Adapter configuration differs');
  assert.equal(sha(Buffer.from(reserve.code_base64,'base64')),'be94412f5384d3a291874696e568f943219f7b99cd88084544849e2fd4d97aa8','Reserve code differs from reviewed redemption semantics');
  assert.equal(exchange.code_hash,c.exchangeCodeHash,'Exchange code changed');
  const values=state.values.sort((a,b)=>a.key.localeCompare(b.key));
  const orders=[];
  for(const entry of values){const key=Buffer.from(entry.key,'base64');if(key[0]!==111)continue;
    assert(key.length===69&&key.readUInt32LE(1)===64,'Unknown order key layout');const id=key.subarray(5).toString();
    const r=await query(c.adapter,'call_function',{method_name:'get_order',args_base64:Buffer.from(JSON.stringify({id})).toString('base64')});
    const order=JSON.parse(Buffer.from(r.result).toString());assert.equal(order.id,id);
    orders.push({id,stage:order.stage});
  }
  return {blockHash:code.block_hash,blockHeight:code.block_height,codeSha256:sha(Buffer.from(code.code_base64,'base64')),values,orders,accessKeys:keys.keys};
}
if(!process.argv.includes('--apply')){
  assert(!(await optional(journalFile)),'Existing rollout journal: resume with --apply instead of replacing its plan');
  const before=await snapshot();assert.equal(before.codeSha256,review.deployedBaseline.sha256,'Adapter differs from rehearsed baseline');
  assert(before.orders.every(o=>['complete','refunded','rejected','attention','redeeming'].includes(o.stage)),'Active orders need review before upgrade');
  const plan={network:'testnet',target:c.adapter,oldSha256:review.deployedBaseline.sha256,newSha256:review.candidate.sha256,newCodeHash,wasmBytes:wasm.length,sourceSha256:sha(source),config:c,before,
    action:'One DeployContract action. No initializer, funding, token call, key change or storage migration.',plannedAt:new Date().toISOString(),rehearsalSha256:rehearsal.rehearsalSha256};
  await save(planFile,plan);console.log(JSON.stringify({...plan,before:{...before,values:before.values.length}},null,2));
}else{
  const plan=await json(planFile);assert.equal(plan.newSha256,sha(wasm));assert.equal(plan.sourceSha256,sha(source));assert.equal(plan.target,c.adapter);
  assert.equal(plan.oldSha256,review.deployedBaseline.sha256);assert.equal(plan.rehearsalSha256,rehearsal.rehearsalSha256);
  const currentConfig={...c};for(const k of ['wasmSha256','codeHash','recoverRedemption','upgradeTx'])delete currentConfig[k];
  const plannedConfig={...plan.config};for(const k of ['wasmSha256','codeHash','recoverRedemption','upgradeTx'])delete plannedConfig[k];assert.deepEqual(currentConfig,plannedConfig,'Configured route changed');
  const lock=await open(lockFile,'wx');
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));await lock.sync();
    const result=await applyAdapterUpgrade(plan,wasm,{
      snapshot,readJournal:()=>optional(journalFile),saveJournal:j=>save(journalFile,j),
      openAccount:async()=>{const key=await json(new URL('./.testnet/adapter.json',import.meta.url));assert.equal(key.accountId,plan.target);return new Account(key.accountId,provider,key.privateKey);},
      transactionStatus:p=>provider.sendJsonRpc('tx',{tx_hash:p.txHash,sender_account_id:p.sender,wait_until:'FINAL'}),
      enable:async txHash=>{const now=await json(configFile);assert.deepEqual(now,c,'Config changed while applying');await save(configFile,{...c,wasmSha256:plan.newSha256,codeHash:newCodeHash,recoverRedemption:true,upgradeTx:txHash});}
    });
    console.log(JSON.stringify({ok:result.ok,target:plan.target,txHash:result.pending.txHash,stateEntries:result.stateVerified.entries,codeHash:newCodeHash}));
  }finally{await lock.close();await unlink(lockFile);}
}
