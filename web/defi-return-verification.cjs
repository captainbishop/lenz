// Alter only modules served to disposable browser contexts.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {run}=require('./defi-return-browser.test.cjs');
(async()=>{
 const names=['carrier-client.js','defi-wallet.js','chat-store.js','defi-request.js'],sources={};
 for(const name of names)sources[name]=await fs.readFile(path.join(__dirname,'public',name),'utf8');
 const baseline=await run(),mutations=[];
 const variants=[
  ['automatic-reply','carrier-client.js','if(await acceptDefiReply(s,swapConfig,envelope.packet))','if(false && await acceptDefiReply(s,swapConfig,envelope.packet))','automatic delivery'],
  ['durable-cancellation','chat-store.js','await saveState(state,signal);','await saveState(state);','pausing at the durable'],
  ['retry-fairness','carrier-client.js','.sort((a,b)=>next(a)-next(b))','','slow unavailable',[["finally{checks.set(item.requestId,now()+30000);}","finally{}"]]],
  ['update-version','defi-wallet.js','if(updateId && entry.defi.executorUpdate?.id===updateId)entry.defi.checkedUpdateId=updateId;','if(updateId)entry.defi.checkedUpdateId=entry.defi.executorUpdate.id;','a newer reply'],
 ];
 for(const [name,file,from,to,filter,additional=[]]of variants){
  assert.equal(sources[file].split(from).length,2,'Unique guard: '+name);
  let altered=sources[file].replace(from,to);
  for(const [old,replacement]of additional){assert.equal(altered.split(old).length,2,'Unique guard: '+name);altered=altered.replace(old,replacement);}
  let failure;try{await run({filter,overrides:{[file]:altered}});}catch(error){failure=error;}
  assert(failure,'Guard alteration survived: '+name);assert.equal(failure.code,'ERR_ASSERTION',name+': '+failure.message);
  mutations.push({name,detected:true});console.log('Detected '+name);
 }
 const sourceFiles={};
 for(const [name,source]of Object.entries(sources)){assert.equal(await fs.readFile(path.join(__dirname,'public',name),'utf8'),source);sourceFiles['web/public/'+name]=createHash('sha256').update(source).digest('hex');}
 for(const name of ['defi-return-browser.test.cjs','defi-return-verification.cjs'])sourceFiles['web/'+name]=createHash('sha256').update(await fs.readFile(path.join(__dirname,name))).digest('hex');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-return-verification-')),output=path.join(directory,'results.json');
 await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),...baseline,mutations,sourceFiles,scope:'Disposable Edge storage and loopback encrypted delivery. Chain status is synthetic; no live financial execution.'},null,2)+'\n');
 console.log(JSON.stringify({passed:baseline.passed,detected:mutations.length,report:output}));
})().catch(error=>{console.error(error);process.exitCode=1;});
