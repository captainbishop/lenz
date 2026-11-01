// Inspect a public call reference. This command has no signing or broadcast path.
import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {checkEngineTransaction} from '../engine-receipt.mjs';
const args=process.argv.slice(2);
if(args.length===1 && args[0]==='--help'){
  console.log('Usage: npm run check:transaction -- <reference.json>\nRead-only Aurora testnet lookup. See engine-transactions.md for the reference format.');
}else{
  try{
    assert(args.length===1 && !args[0].startsWith('-'),'Expected a reference file');
    assert((await stat(args[0])).size<=70*1024,'Reference is too large');
    const bytes=await readFile(args[0]);assert(bytes.length<=70*1024,'Reference is too large');
    const reference=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const result=await checkEngineTransaction(reference);
    console.log(JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value,2));
    process.exitCode=result.state==='evm_succeeded'?0:['pending','unavailable'].includes(result.state)?2:1;
  }catch{
    console.error('Cannot inspect this reference. Check the file and the format in engine-transactions.md.');process.exitCode=1;
  }
}
