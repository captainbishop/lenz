const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const reportDirectory=process.env.LENZ_ZCASH_MEMO_REPORT_DIR;
if(!reportDirectory)throw Error('Set a private memo report directory.');
const checks=[],requests=[],errors=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
(async()=>{
  const {createPaymentReviewService}=await import('../zcash/payment-review.mjs');
  const {createHash}=require('node:crypto'),sha=x=>createHash('sha256').update(x).digest('hex');
  const address=require('../zcash/address-b-results.json').orchardAddress;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lenz-memo-browser-'));
  const memoBytes=Buffer.alloc(512);memoBytes.write('<img src=x onerror="window.memoExecuted=true">\nPublic fixture');const memo=memoBytes.toString('hex');
  const effects={status:'verified',version:6,pool:'ironwood',amount:'1000000',fee:'10000',change:'98990000',inputValue:'100000000',recipient:address,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:true,canSign:false,canSend:false};
  let release,delay=false,alter=null;
  const service=createPaymentReviewService({directory,prepare:async(_,value,file)=>{await fs.writeFile(file,'unsigned');return{fee:'10000',change:'98990000',totalDebit:'1010000',recipient:'b',address,txid:'a'.repeat(64),walletHeight:10};},memos:async()=>{
    if(delay)await new Promise(resolve=>release=resolve);
    return{...effects,pcztSha256:sha('unsigned'),memos:{recipient:{hex:memo},change:{hex:'f6'+'00'.repeat(511)}}};
  }});
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost').pathname;
    if(url.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));requests.push({url,keys:Object.keys(input).sort()});
      const action=({'/api/zcash/review':'prepare','/api/zcash/review-status':'status','/api/zcash/review-memos':'memos','/api/zcash/review-memo-confirm':'memo-confirm','/api/zcash/review-discard':'discard'})[url];
      let result=await service(action,input);if(alter)result=alter(result);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(url)]??'application/octet-stream');res.end(await fs.readFile(path.join(__dirname,'public',url)));
  }catch(error){res.writeHead(error.status??503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'The memo review could not be completed.'}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const ready=()=>page.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
    const click=async selector=>{await page.locator(selector).click();await ready();};
    await page.goto('http://127.0.0.1:'+server.address().port+'/zcash-lab.html');await ready();
    await check('memo inspection is explicit and older amount reviews have no memo confirmation',async()=>{
      assert.equal(requests.length,0);await click('#zc-review-prepare');
      assert((await page.locator('#zc-review-memo-status').innerText()).includes('have not been reviewed'));
      assert(await page.locator('#zc-review-memo-confirm').isDisabled());assert(await page.locator('#zc-memo-panel').isHidden());
    });
    await check('authenticated memos display as inert text and explicit confirmation submits only the exact fingerprint',async()=>{
      await click('#zc-review-memos');assert(await page.locator('#zc-memo-panel').isVisible(),await page.locator('#zc-review-status').innerText());
      assert.equal(await page.locator('#zc-memo-panel img').count(),0);assert.equal(await page.evaluate(()=>window.memoExecuted),undefined);
      assert((await page.locator('#zc-memo-panel').innerText()).includes('No memo (canonical'));
      const hex=await page.locator('.zc-memo-hex').allTextContents();assert.deepEqual(hex.map(value=>value.length),[1024,1024]);
      assert(await page.locator('#zc-review-memo-confirm').isEnabled());await click('#zc-review-memo-confirm');
      assert((await page.locator('#zc-review-memo-status').innerText()).includes('Exact payment and change memos were reviewed'));
      const status=await page.locator('#zc-review-memo-status').innerText();assert(!/[0-9a-f]{64}/.test(status));
      assert((await page.locator('.zc-memo-review').innerText()).includes('Signing and sending remain unavailable'));
      const evidence=await page.locator('#zc-review-details').textContent();assert(evidence.includes('Memo file '+sha('unsigned')));assert(/Memo binding [0-9a-f]{64}/.test(evidence));assert(await page.locator('#zc-review-details').isHidden());
      assert(await page.locator('#zc-memo-panel').isHidden());assert.deepEqual(requests.at(-1).keys,['binding','id','wallet']);
    });
    await check('reload restores saved confirmation without exposing memo bytes or automatically inspecting again',async()=>{
      const count=requests.length;await page.reload();await ready();assert.equal(requests.length,count);await click('#zc-review-check');
      assert((await page.locator('#zc-review-memo-status').innerText()).includes('were reviewed'));assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());
      const storage=await page.evaluate(()=>({local:Object.values(localStorage),session:Object.values(sessionStorage)}));
      assert(!JSON.stringify(storage).includes('Public fixture'));assert(!JSON.stringify(storage).includes(memo));assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);
    });
    await check('changed raw bytes or swapped role descriptors cannot be presented as the inspected saved memos',async()=>{
      for(const change of [result=>{result.memoInspection.recipient.hex=result.memoInspection.recipient.hex.slice(0,-2)+'01';return result;},result=>{const x=result.review.memos.recipient;result.review.memos.recipient=result.review.memos.change;result.review.memos.change=x;return result;}]) {
        alter=change;await click('#zc-review-memos');assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());
        assert((await page.locator('#zc-review-memo-status').innerText()).includes('did not complete'));
      }
      alter=null;await click('#zc-review-memos');assert(await page.locator('#zc-review-memo-confirm').isEnabled());
    });
    const pendingMemo=async()=>{delay=true;release=null;await page.locator('#zc-review-memos').click();await page.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='true');while(!release)await new Promise(resolve=>setTimeout(resolve,5));};
    const finish=async()=>{delay=false;release();await new Promise(resolve=>setTimeout(resolve,50));};
    await check('cancelling inspection clears content and a late authenticated reply cannot re-enable confirmation',async()=>{
      await pendingMemo();await page.locator('#zc-review-memo-cancel').click();await ready();await finish();
      assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());assert((await page.locator('#zc-review-memo-status').innerText()).includes('cancelled'));
    });
    await check('account changes invalidate a pending memo response and preserve account selection',async()=>{
      await pendingMemo();await page.evaluate(()=>{const select=document.querySelector('#zc-wallet');select.value='b';select.dispatchEvent(new Event('change'));});await ready();await finish();
      assert.equal(await page.locator('#zc-wallet').inputValue(),'b');assert(await page.locator('#zc-review-result').isHidden());assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());
      await page.locator('#zc-wallet').selectOption('a');await click('#zc-review-check');
    });
    await check('going offline clears the pending memo review and reconnecting never approves or reloads it',async()=>{
      await pendingMemo();await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);await ready();await finish();
      assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());const count=requests.length;
      await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);assert.equal(requests.length,count);assert(await page.locator('#zc-review-memo-confirm').isDisabled());
    });
    await check('memo controls fit phone and landscape with 48 pixel targets and no raw memo retained in saved records',async()=>{
      await click('#zc-review-memos');
      for(const[width,height]of[[375,812],[812,375],[1280,1000]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const id of ['#zc-review-memos','#zc-review-memo-confirm'])assert((await page.locator(id).boundingBox()).height>=48);}
      await page.locator('#zc-review-memo-confirm').click();await ready();
      const saved=await fs.readFile(path.join(directory,'current.json'),'utf8');assert(!saved.includes(memo));assert(!saved.includes('Public fixture'));assert.deepEqual(errors,[]);assert(!requests.some(x=>/sign|send|prove/.test(x.url)));
    });
    await check('the actual app worker keeps the memo shell available offline without retaining the memo response',async()=>{
      await page.evaluate(async()=>{
        await navigator.serviceWorker.register('/chat-sw.js',{scope:'/'});
        await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('App worker did not activate')),20000))]);
      });
      const cached=await page.evaluate(async()=>({module:!!await caches.match('/zcash-memos.js'),api:!!await caches.match('/api/zcash/review-memos')}));
      assert.equal(cached.module,true);assert.equal(cached.api,false);await page.reload();await ready();
      const count=requests.length;await context.setOffline(true);await page.reload();await ready();assert.equal(requests.length,count);
      assert(await page.locator('#zc-review-memos').isDisabled());assert(await page.locator('#zc-memo-panel').isHidden());assert(await page.locator('#zc-review-memo-confirm').isDisabled());
      await context.setOffline(false);
    });
    await fs.mkdir(reportDirectory,{recursive:true});
    await fs.writeFile(path.join(reportDirectory,'browser-results.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,requests,errors,scope:'Synthetic public fixture with actual memo review surface in isolated Edge. No native account or financial action.'},null,2)+'\n');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
