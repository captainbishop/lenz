// Operate a local journal of already signed testnet calls; never read signing keys.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EngineJournal} from '../engine-journal.mjs';
const argv=process.argv.slice(2),usage='Usage: node scripts/engine-submission.js <record|inspect|check|send|retry> <request.json|operation-id> [--journal directory]\nrecord only saves a reviewed reference and signed bytes. send transmits once; subsequent sends check status. retry explicitly resends the same saved bytes after checking. Testnet only.';
if(argv.length===1&&argv[0]==='--help'){console.log(usage);}
else{
  let journal;
  try{
    const [command,input,...rest]=argv;
    assert(['record','inspect','check','send','retry'].includes(command)&&typeof input==='string'&&!input.startsWith('-'),'Invalid command');
    assert(rest.length===0||(rest.length===2&&rest[0]==='--journal'&&rest[1]),'Invalid journal option');
    let request;
    if(command==='record'){
      assert((await stat(input)).size<=128*1024,'Request file too large');
      const bytes=await readFile(input);assert(bytes.length<=128*1024,'Request file too large');
      request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      assert(request&&Object.keys(request).length===3&&['operationId','reference','signedTxBase64'].every(k=>Object.hasOwn(request,k)),'Unexpected request fields');
    }else assert(/^[0-9a-f]{64}$/.test(input),'Invalid operation ID');
    journal=new EngineJournal(rest[1]??fileURLToPath(new URL('../.testnet/engine-submissions/',import.meta.url)));
    const result=command==='record'?journal.record(request.operationId,request.reference,request.signedTxBase64):
      command==='inspect'?journal.inspect(input):command==='check'?await journal.check(input):await journal.send(input,{retry:command==='retry'});
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.preflight?(result.preflight.state==='unavailable'?2:1):['record','inspect'].includes(command)||result.outcome.state==='evm_succeeded'?0:['pending','unavailable'].includes(result.outcome.state)?2:1;
  }catch{console.error('Cannot complete this journal action. Check the local request, journal and testnet connection. No replacement transaction is signed.');process.exitCode=1;}
  finally{journal?.close();}
}
