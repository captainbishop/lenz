const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {run,upgrade}=require('./offline-launch.test.cjs');
const files=['offline-access.js','home.js','money.js','chat.js','markets.js','routes.js','account-ui.js','account-activity-ui.js','recovery-ui.js','save-offline.js','chat-sw.js','sw.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const sources={};for(const file of files)sources['web/public/'+file]=await fs.readFile(path.join(__dirname,'public',file));
 for(const file of ['offline-launch.test.cjs','offline-launch-verification.cjs'])sources['web/'+file]=await fs.readFile(path.join(__dirname,file));
 const cases=[];
 cases.push(await run());
 cases.push(await run({entry:'/money.html',interrupted:true,record:false}));
 cases.push(await run({entry:'/money.html',evicted:true,record:false}));
 cases.push(await upgrade({record:false}));
 const mutations=[];
 const variants=[
  ['wallet-scope','offline-access.js',"'/chat.html','/money.html','/swap-tools.html'","'/chat.html','/swap-tools.html'",()=>({entry:'/money.html'})],
  ['cache-completeness','chat-sw.js','{complete:await complete(await caches.open(CACHE))}','{complete:true}',()=>({entry:'/money.html',evicted:true})],
  ['offline-existing-copy','offline-access.js',"if(existing?.active?.scriptURL===new URL(script,location.origin).href)","if(false)",()=>({})],
  ['old-scope-retention','chat-sw.js',"  // Other document scopes may still run an older worker while an update is interrupted.","  for(const name of await caches.keys())if(name.startsWith('proof-u-chat-')&&name!==CACHE)await caches.delete(name);",null]
 ];
 for(const [name,file,from,to,options]of variants){
  const source=sources['web/public/'+file].toString();assert.equal(source.split(from).length,2,'Unique alteration '+name);
  let failure;try{const overrides={[file]:source.replace(from,to)};await(options?run({...options(),overrides,record:false}):upgrade({overrides,record:false}));}catch(error){failure=error;}
  assert(failure,'Surviving alteration '+name);assert.equal(failure.code,'ERR_ASSERTION',name+': '+failure.message);
  mutations.push({name,detected:true,assertion:failure.message});console.log('Detected '+name);
 }
 const sourceFiles={};for(const [file,bytes]of Object.entries(sources)){sourceFiles[file]=hash(bytes);assert.equal(hash(await fs.readFile(path.join(__dirname,'..',file))),sourceFiles[file],'Source changed during verification: '+file);}
 const report={checkedAt:new Date().toISOString(),browser:'Windows Edge',cases,mutations,sourceFiles,scope:'Persistent disposable browser profiles, real saved app and local profile operations. No physical phone, standalone OS installation, local wallet lock or financial settlement proof.'};
 const output=process.env.LENZ_OFFLINE_VERIFICATION??path.join(await fs.mkdtemp(path.join(os.tmpdir(),'lenz-offline-verification-')),'results.json');
 await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:cases.length,detectedAlterations:mutations.length,report:output}));
})().catch(error=>{console.error(error);process.exitCode=1;});
