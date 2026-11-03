// Bounded guard-removal checks in disposable profiles; never changes product files.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{run}=require('./route-drafts-ui.test.cjs');
(async()=>{
  const baseline=await run(),results=[];
  const mutations=[
    ['changed quote review','route-draft-ui.js','if(saving||!consent.checked||!isCurrent())return;','if(saving||!consent.checked)return;','changed market terms'],
    ['late revoked refresh','routes.js','if(ticket!==generation||!consent.checked||!navigator.onLine||!controls.isConnected)return;','if(false)return;','refresh requires consent'],
    ['exact saved amounts','routes.js',"const value=units.padStart(decimals+1,'0');","return String(Number(units)/10**decimals);const value=units.padStart(decimals+1,'0');",'older private drafts'],
    ['unreadable state','routes.js',"$('#route-detail').replaceChildren(el('h2','Drafts unavailable'));","render();",'unreadable storage'],
    ['focused control after resize','route-draft-ui.js',"addEventListener('resize',revealFocus);",'', 'review reflows'],
  ];
  for(const [guard,file,from,to,filter]of mutations){
    const source=await fs.readFile(path.join(__dirname,'public',file),'utf8');assert.equal(source.split(from).length,2,guard);let failure;
    try{await run({overrides:{[file]:source.replace(from,to)},filter,record:false});}catch(error){failure=error;}
    assert.equal(failure?.code,'ERR_ASSERTION',`${guard} was not independently detected: ${failure?.message}`);results.push({guard,detected:true});console.log('DETECTED '+guard);
  }
  const sourceFiles={...baseline.sourceFiles};sourceFiles['web/verify-route-drafts-ui.cjs']=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const report={checkedAt:new Date().toISOString(),tests:baseline.passed,guardAlterations:results.length,results,sourceFiles,scope:'Product controls with fixture public APIs and disposable Edge storage. Non-cooperative fetch tests stale replies even when abort is ignored. No signing, transaction, user profile or physical-device test.'};
  await fs.writeFile(path.join(__dirname,'route-drafts-ui-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:report.tests,guardAlterations:results.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
