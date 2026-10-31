// Disposable browser contexts only. No funded action or external RPC is needed.
const {chromium}=require('playwright');
const http=require('node:http'),assert=require('node:assert/strict');
const {writeFile}=require('node:fs/promises');
const base='http://127.0.0.1:4173',baseline=process.argv.includes('--baseline');
const checks=[];
(async()=>{
  const attacker=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<iframe src="${base}/money.html" style="width:100%;height:900px"></iframe>`);});
  await new Promise(r=>attacker.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${attacker.address().port}`);
    if(baseline){
      await page.frameLocator('iframe').getByRole('button',{name:'Continue privately',exact:true}).click();
      await page.frameLocator('iframe').locator('#wallet-content').waitFor();
      checks.push('baseline: foreign-origin frame can display wallet and activate disposable profile creation');
    }else{
      // Completion of the iframe load is awaited by goto; a rejected document has no app DOM.
      assert.equal(await page.frameLocator('iframe').locator('#wallet-name').count(),0);
      assert.equal(await page.frameLocator('iframe').getByRole('button',{name:'Continue privately',exact:true}).count(),0);
      checks.push('foreign-origin framing cannot display or activate the wallet');
    }
    await page.goto(base+'/money.html');
    if(await page.getByRole('button',{name:'Continue privately',exact:true}).count())await page.getByRole('button',{name:'Continue privately',exact:true}).click();
    await page.locator('#wallet-content').waitFor();
    const injection=await page.evaluate(async()=>{
      const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));
      const script=document.createElement('script');script.textContent='window.securityProbe = true';document.head.append(script);
      let remoteBlocked=false;try{await fetch('https://example.invalid/lenz-exfiltration-probe')}catch{remoteBlocked=true;}
      await new Promise(r=>setTimeout(r,50));
      return {inlineRan:window.securityProbe===true,remoteBlocked,violations};
    });
    if(baseline){assert.equal(injection.inlineRan,true);checks.push('baseline: injected inline JavaScript executes (defense probe, not a demonstrated XSS entry)');}
    else{
      assert.equal(injection.inlineRan,false);assert.equal(injection.remoteBlocked,true);
      assert(injection.violations.includes('script-src-elem'));assert(injection.violations.includes('connect-src'));
      checks.push('browser enforces inline-script and unapproved connection restrictions');
      const identity=await page.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.identity;});
      await page.evaluate(async()=>{await(await import('/save-offline.js')).saveOffline();});
      await ctx.setOffline(true);await page.reload();await page.locator('#wallet-content').waitFor();
      const restored=await page.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.identity;});
      assert.deepEqual(restored,identity);
      assert((await page.evaluate(()=>document.documentElement.outerHTML)).includes('tUSD'));
      const offlineInline=await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.offlineProbe=true';document.head.append(s);return window.offlineProbe===true;});
      assert.equal(offlineInline,false);checks.push('offline cached wallet keeps identity and enforces its saved script policy');
    }
    assert.deepEqual(errors,[]);
    const result={checkedAt:new Date().toISOString(),browser:await browser.version(),baseline,passed:checks.length,checks};
    await writeFile(new URL(baseline?'./security-baseline.json':'./security-browser-results.json',`file:///${__filename.replaceAll('\\','/')}`),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();await new Promise(r=>attacker.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
