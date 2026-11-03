// Disposable browser-service tests. No production profile or financial requests.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const modules=['defi-route-drafts.js','defi-route-quote.js','defi-route-plan.js','defi-catalog.js','market-quote.js','chat-store.js','peer-crypto.js','profile-display.js'];
async function run({draftSource,filter,record=true}={}){
  const {routeQuoteFixture,NOW}=await import(pathToFileURL(path.join(__dirname,'../integrations/route-quote-fixtures.mjs')));
  const fixture=await routeQuoteFixture(),sources=Object.fromEntries(await Promise.all(modules.map(async f=>['/'+f,await fs.readFile(path.join(__dirname,'public',f),'utf8')])));
  if(draftSource!==undefined)sources['/defi-route-drafts.js']=draftSource;
  const results=[],errors=[];let browser,requests=0;
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'||file.startsWith('/api/')){requests++;res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',file==='/'?'text/html':'text/javascript');
    res.writeHead(file==='/'||Object.hasOwn(sources,file)?200:404);res.end(file==='/'?'<!doctype html><title>Route draft service test</title>':sources[file]??'');
  });
  async function boot(page){
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(async({fixture,NOW})=>{
      window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');window.d=await import('/defi-route-drafts.js');window.f=fixture;window.t=NOW;window.clock=Date.now;Date.now=()=>t;
      window.snapshot=async()=>JSON.stringify(await store.readState());
    },{fixture,NOW});
  }
  async function check(name,fn){
    if(filter&&!name.startsWith(filter))return;
    const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
    try{
      for(const page of [a,b])page.on('pageerror',e=>errors.push(e.message));await boot(a);await boot(b);
      await a.evaluate(async()=>store.updateState(async s=>{s.identity=await p.createIdentity('Draft owner');s.contacts=[{name:'Existing contact'}];s.messages=[{text:'Keep history'}];s.nearBox={iv:'unchanged',ciphertext:'unchanged-reservation'};}));
      await fn({a,b,context});results.push({name,pass:true});console.log('PASS '+name);
    }finally{await context.close();}
  }
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:true});
    await check('encrypted drafts preserve wallet state and expose no execution authority',async({a})=>{
      const r=await a.evaluate(async()=>{const before=await store.readState(),draft=await d.saveRouteDraft(f.objective),saved=await d.attachRouteQuote(draft.objective.id,draft.revision,f.quote),after=await store.readState();return {before:JSON.stringify(before),after:JSON.stringify(after),draft,saved,extractable:after.routeDraftKey.extractable,nearBox:after.nearBox};});
      assert.equal(r.draft.status,'needs-quote');assert.equal(r.saved.status,'estimate-saved');assert.equal(r.saved.executable,false);assert.equal(r.extractable,false);assert(!r.after.includes('fixture-route-uniswap'));assert(!r.after.includes(fixture.objective.recipient.address));
      const state=JSON.parse(r.after);delete state.routeDraftKey;delete state.routeDraftBox;assert.deepEqual(state,JSON.parse(r.before));
    });
    await check('reload and offline reads retain expired estimates without approving or deleting them',async({a,context})=>{
      const first=await a.evaluate(async()=>{const r=await d.saveRouteDraft(f.objective);await d.attachRouteQuote(r.objective.id,r.revision,f.quote);return await snapshot();});
      await boot(a);await context.setOffline(true);
      const r=await a.evaluate(async()=>{t=f.quote.expiresAt;const expired=await d.listRouteDrafts();t=f.objective.limits.deadline;const objectiveExpired=await d.listRouteDrafts();t=f.quote.observedAt-1;const clockChanged=await d.listRouteDrafts();return {expired,objectiveExpired,clockChanged,after:await snapshot()};});
      assert.equal(r.expired[0].status,'quote-expired');assert.equal(r.objectiveExpired[0].status,'objective-expired');assert.equal(r.clockChanged[0].status,'clock-changed');assert(r.expired[0].estimate);assert.equal(r.after,first);
    });
    await check('two tabs use revision checks and preserve one immutable objective',async({a,b})=>{
      const first=await Promise.all([a.evaluate(()=>d.saveRouteDraft(f.objective)),b.evaluate(()=>d.saveRouteDraft(f.objective))]);assert.deepEqual(first[0],first[1]);
      const results=await Promise.allSettled([a.evaluate(()=>d.attachRouteQuote(f.objective.id,1,f.quote)),b.evaluate(()=>d.attachRouteQuote(f.objective.id,1,f.quote))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const r=await a.evaluate(async()=>{const before=await snapshot();f.objective.recipient.address='0x'+'44'.repeat(20);let rejected=false;try{await d.saveRouteDraft(f.objective);}catch{rejected=true;}return {rejected,before,after:await snapshot(),rows:await d.listRouteDrafts()};});assert(r.rejected);assert.equal(r.before,r.after);assert.equal(r.rows.length,1);assert.equal(r.rows[0].revision,2);
    });
    await check('failed IndexedDB writes return no draft or quote and preserve ciphertext',async({a})=>{
      const r=await a.evaluate(async()=>{const before=await snapshot(),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};let created=false;
        try{await d.saveRouteDraft(f.objective);created=true;}catch{}finally{IDBObjectStore.prototype.put=put;}
        const after=await snapshot();const draft=await d.saveRouteDraft(f.objective),saved=await snapshot();let attached=false;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw Error('disk full');};
        try{await d.attachRouteQuote(draft.objective.id,1,f.quote);attached=true;}catch{}finally{IDBObjectStore.prototype.put=put;}
        return {before,after,saved,final:await snapshot(),created,attached};});assert.equal(r.created,false);assert.equal(r.attached,false);assert.equal(r.before,r.after);assert.equal(r.saved,r.final);
    });
    await check('expiry during encryption leaves the draft and quote unchanged',async({a})=>{
      const r=await a.evaluate(async()=>{const before=await snapshot(),encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let rejected=false;
        crypto.subtle.encrypt=async(...args)=>{const x=await encrypt(...args);t=f.objective.limits.deadline;return x;};
        try{await d.saveRouteDraft(f.objective);}catch{rejected=true;}finally{crypto.subtle.encrypt=encrypt;t=f.quote.observedAt;}
        const after=await snapshot();await d.saveRouteDraft(f.objective);const saved=await snapshot();let attached=false;
        crypto.subtle.encrypt=async(...args)=>{const x=await encrypt(...args);t=f.quote.expiresAt;return x;};
        try{await d.attachRouteQuote(f.objective.id,1,f.quote);attached=true;}catch{}finally{crypto.subtle.encrypt=encrypt;}
        return {before,after,saved,final:await snapshot(),rejected,attached};});assert(r.rejected);assert.equal(r.attached,false);assert.equal(r.before,r.after);assert.equal(r.saved,r.final);
    });
    await check('caller mutations cannot change queued objective or quote terms',async({a})=>{
      const r=await a.evaluate(async()=>{const pending=d.saveRouteDraft(f.objective);f.objective.source.amount='1';const draft=await pending;const attaching=d.attachRouteQuote(draft.objective.id,1,f.quote);f.quote.result.minOutputUnits='1';return {draft,saved:await attaching};});assert.equal(r.draft.objective.source.amount,fixture.objective.source.amount);assert.equal(r.saved.estimate.quote.result.minOutputUnits,fixture.quote.result.minOutputUnits);
    });
    await check('ciphertext corruption and cross-identity copies are rejected without wallet changes',async({a})=>{
      const r=await a.evaluate(async()=>{await d.saveRouteDraft(f.objective);const original=await store.readState(),rejected=[];
        await store.updateState(s=>{const c=s.routeDraftBox.ciphertext;s.routeDraftBox.ciphertext=(c[0]==='a'?'b':'a')+c.slice(1);});try{await d.listRouteDrafts();rejected.push(false);}catch{rejected.push(true);}
        await store.updateState(async s=>{s.routeDraftBox=original.routeDraftBox;s.identity=await p.createIdentity('Different owner');});try{await d.listRouteDrafts();rejected.push(false);}catch{rejected.push(true);}
        return {rejected,nearBox:(await store.readState()).nearBox};});assert.deepEqual(r.rejected,[true,true]);assert.deepEqual(r.nearBox,{iv:'unchanged',ciphertext:'unchanged-reservation'});
    });
    await check('quoted draft save is atomic, idempotent and leaves no partial draft on failure',async({a})=>{
      const r=await a.evaluate(async()=>{const before=await snapshot(),encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let expired=false;
        crypto.subtle.encrypt=async(...args)=>{const x=await encrypt(...args);t=f.quote.expiresAt;return x;};try{await d.saveRouteDraft(f.objective,{quote:f.quote});}catch{expired=true;}finally{crypto.subtle.encrypt=encrypt;t=f.quote.observedAt;}
        const after=await snapshot(),saved=await d.saveRouteDraft(f.objective,{quote:f.quote}),box=await snapshot(),repeated=await d.saveRouteDraft(f.objective,{quote:f.quote});
        return {expired,before,after,saved,repeated,box,final:await snapshot()};});assert(r.expired);assert.equal(r.before,r.after);assert.equal(r.saved.status,'estimate-saved');assert.equal(r.saved.revision,1);assert.deepEqual(r.saved,r.repeated);assert.equal(r.box,r.final);
    });
    await check('deletion requires current revision and a late estimate cannot restore the draft',async({a})=>{
      const r=await a.evaluate(async()=>{await d.saveRouteDraft(f.objective,{quote:f.quote});const before=await snapshot();let stale=false,late=false;
        try{await d.removeRouteDraft(f.objective.id,2);}catch{stale=true;}const after=await snapshot();try{await d.removeRouteDraft(f.objective.id,1);}catch{}
        try{await d.attachRouteQuote(f.objective.id,1,f.quote);}catch{late=true;}return {stale,late,before,after,rows:await d.listRouteDrafts(),nearBox:(await store.readState()).nearBox};});assert(r.stale);assert(r.late);assert.equal(r.before,r.after);assert.deepEqual(r.rows,[]);assert.deepEqual(r.nearBox,{iv:'unchanged',ciphertext:'unchanged-reservation'});
    });
    assert.equal(requests,0);assert.deepEqual(errors,[]);assert(results.length>0);
    const sourceFiles={};for(const [f,source]of Object.entries(sources))sourceFiles['web/public'+f]=createHash('sha256').update(source).digest('hex');
    for(const f of ['web/route-drafts-browser.test.cjs','integrations/route-quote-fixtures.mjs'])sourceFiles[f]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',f))).digest('hex');
    const report={checkedAt:new Date().toISOString(),passed:results.length,failed:0,requests,results,sourceFiles,scope:'Disposable Edge service tests with real IndexedDB, Web Locks and WebCrypto; online reload and loaded offline reads. No product controls, user profile, financial endpoint or physical-device test.'};
    if(record)await fs.writeFile(path.join(__dirname,'route-drafts-browser-results.json'),JSON.stringify(report,null,2)+'\n');return report;
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
module.exports={run};
if(require.main===module)run().then(r=>console.log(JSON.stringify({passed:r.passed,failed:r.failed}))).catch(e=>{console.error(e);process.exitCode=1;});
