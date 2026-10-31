const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const withoutCsp=process.argv.includes('--without-csp');
const offline=process.argv.includes('--offline');
const diagnostic=process.argv.includes('--diagnostic');
const timeoutMs=Number(process.env.LENZ_PROOF_TEST_TIMEOUT_MS??90000);
assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=10000&&timeoutMs<=600000);
if(offline && withoutCsp)throw Error('The offline check must keep the real security policy');
(async()=>{
  const runId=new Date().toISOString().replace(/[:.]/g,'-');
  const filename=diagnostic?`security-proof-${offline?'offline':'online'}-${runId}.json`:withoutCsp?'security-proof-control.json':offline?'security-proof-offline-results.json':'security-proof-results.json';
  const browser=await chromium.launch({channel:'msedge',headless:true});const diagnostics=[],samples=[],resources=[],workers=[];let report,violations=[],runtime;
  const started=Date.now(),elapsed=()=>Date.now()-started;
  const cdp=diagnostic?await browser.newBrowserCDPSession():null;
  try{
    const ctx=await browser.newContext(),page=await ctx.newPage();
    if(diagnostic){
      ctx.on('response',response=>{
        if(response.url().startsWith('http://127.0.0.1:4173/assets/'))resources.push({kind:'asset-response',url:response.url(),ms:elapsed(),status:response.status(),fromServiceWorker:response.fromServiceWorker()});
      });
      ctx.on('requestfinished',request=>{
        if(request.url().startsWith('http://127.0.0.1:4173/'))resources.push({url:request.url(),ms:elapsed(),timing:request.timing(),serviceWorker:!!request.serviceWorker()});
      });
      page.on('worker',worker=>{const record={url:worker.url(),openedMs:elapsed()};workers.push(record);worker.on('close',()=>{record.closedMs=elapsed();});});
    }
    if(withoutCsp)await ctx.route('http://127.0.0.1:4173/**',async route=>{const response=await route.fetch();const headers=response.headers();delete headers['content-security-policy'];await route.fulfill({response,headers});});
    page.on('pageerror',e=>diagnostics.push({kind:'pageerror',message:e.message}));
    page.on('console',m=>{if(m.type()==='error')diagnostics.push({kind:'console',message:m.text()});});
    page.on('requestfailed',r=>diagnostics.push({kind:'requestfailed',url:r.url(),error:r.failure()?.errorText}));
    await page.addInitScript(()=>{window.proofPolicyViolations=[];document.addEventListener('securitypolicyviolation',e=>window.proofPolicyViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
    let response=await page.goto('http://127.0.0.1:4173/tests.html');
    if(offline){
      await page.evaluate(async()=>{
        const registration=await navigator.serviceWorker.register('/sw.js');
        const worker=registration.installing??registration.waiting??registration.active;
        if(worker.state!=='activated')await new Promise((resolve,reject)=>{
          const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);resolve();}else if(worker.state==='redundant'){worker.removeEventListener('statechange',changed);reject(Error('Offline worker installation failed'));}};
          worker.addEventListener('statechange',changed);changed();
        });
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>finish(Error('Proof cache preparation timed out')),30000);
          function finish(error){clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',onMessage);error?reject(error):resolve();}
          function onMessage({data}){if(data.type==='ready')finish();else if(data.type==='error')finish(Error(data.message));}
          navigator.serviceWorker.addEventListener('message',onMessage);worker.postMessage({type:'prepare'});
        });
      });
      await ctx.setOffline(true);response=await page.reload();assert(response.fromServiceWorker());
      await page.locator('#require-offline').check();
    }
    if(!withoutCsp){
      const csp=response.headers()['content-security-policy'];
      assert(csp?.includes("script-src 'self' 'wasm-unsafe-eval'"));
      assert(csp.includes("worker-src 'self' blob:"));assert(!csp.includes("'unsafe-eval'"));
    }
    if(diagnostic)runtime=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,visibility:document.visibilityState}));
    const sample=async()=>{
      const snapshot=await page.evaluate(()=>({progress:document.querySelector('#progress').textContent,lastRow:document.querySelector('#results li:last-child')?.textContent,partial:window.proofTestProgress}));
      samples.push({ms:elapsed(),freeMemoryBytes:os.freemem(),processes:(await cdp.send('SystemInfo.getProcessInfo')).processInfo,...snapshot});
    };
    await page.locator('#run').click();
    if(diagnostic)await sample();
    for(let n=0;n<Math.ceil(timeoutMs/10000);n++){
      try{await page.waitForFunction(()=>document.querySelector('#report').textContent.length>0,{},{timeout:10000});break;}
      catch(e){if(e.name!=='TimeoutError')throw e;if(diagnostic)await sample();console.log(`Proof progress after ${(n+1)*10}s: `+await page.locator('#results li').last().innerText());}
    }
    const text=await page.locator('#report').innerText();
    report=text?JSON.parse(text):{failed:1,error:`Proof suite did not complete in ${timeoutMs/1000} seconds`,progress:await page.locator('#progress').innerText(),rows:await page.locator('#results').innerText()};
    violations=await page.evaluate(()=>window.proofPolicyViolations);
    if(diagnostic){await sample();report.partial=await page.evaluate(()=>window.proofTestProgress);}
    const result={runId,withoutCsp,offline,timeoutMs,diagnostics,violations,...report,...(diagnostic?{runtime,samples,resources,workers}:{})};
    await fs.writeFile(path.join(__dirname,filename),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(diagnostic?{file:filename,passed:report.passed,failed:report.failed,elapsedMs:report.elapsedMs,timings:report.timings,error:report.error}:result,null,2));assert.equal(report.failed,0);assert.equal(report.passed,offline?25:23);
    assert.deepEqual(violations,[]);assert.deepEqual(diagnostics.filter(d=>d.kind==='pageerror'),[]);
  }catch(error){
    if(diagnostic){
      await fs.writeFile(path.join(__dirname,filename),JSON.stringify({runId,withoutCsp,offline,timeoutMs,diagnostics,violations,...report,failed:Math.max(1,report?.failed??0),error:report?.error??error.message,runnerError:error.message,runtime,samples,resources,workers},null,2)+'\n');
      console.error(`Failure diagnostics: ${filename}`);
    }
    throw error;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
