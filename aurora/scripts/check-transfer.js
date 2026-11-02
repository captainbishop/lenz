// Read a transfer expectation and inspect receipts without signing or broadcasting.
import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {checkEngineTransfer} from '../engine-transfer.mjs';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
  console.log('Usage: npm run check:transfer -- <expected-transfer.json>\nRead-only Aurora testnet receipt lookup. See engine-transfers.md.');
}else{
  try{
    assert(args.length===1&&!args[0].startsWith('-'),'Expected a transfer reference file');
    assert((await stat(args[0])).size<=72*1024,'Reference is too large');
    const bytes=await readFile(args[0]);assert(bytes.length<=72*1024,'Reference is too large');
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    assert(input&&Object.keys(input).length===2&&Object.hasOwn(input,'reference')&&Object.hasOwn(input,'payment'),'Unexpected request fields');
    const result=await checkEngineTransfer(input.reference,input.payment);
    console.log(JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value,2));
    process.exitCode=result.transfer.state==='reported'?0:['pending','unavailable'].includes(result.execution.state)?2:1;
  }catch{
    console.error('Cannot inspect this transfer. Check its independent reference and payment expectations.');process.exitCode=1;
  }
}
