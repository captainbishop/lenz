const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

(async()=>{
  const root=path.join(__dirname,'public'),errors=[],checks=[],screens=path.join(os.tmpdir(),'lenz-shared-style-review');
  const server=http.createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://local').pathname;
    if(pathname.startsWith('/api/')){res.writeHead(503);res.end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep))throw Error();
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.mp4':'video/mp4'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
  await fs.mkdir(screens,{recursive:true});
  try{
    for(const width of [390,1440]){
      const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce',serviceWorkers:'block',colorScheme:'light'});
      await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      const surfaces=new Map();
      for(const url of ['/index.html','/markets.html','/markets.html?view=spot','/markets.html?view=perpetuals','/markets.html?view=predictions','/markets.html?view=credit','/markets.html?view=liquidity','/markets.html?view=degen','/money.html','/routes.html','/account.html','/recovery.html','/chat.html']){
        await page.goto(base+url);await page.locator('#theme-toggle').waitFor();
        for(const theme of ['light','dim','dark']){
          await page.locator('#theme-toggle').click();await page.getByRole('menuitemradio',{name:theme[0].toUpperCase()+theme.slice(1),exact:true}).click();
          await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
          await page.waitForFunction(()=>[...document.querySelectorAll('img[data-lenz-artwork]')].every(img=>img.complete&&img.naturalWidth>0));
          const result=await page.evaluate(()=>{
            const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
            const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
            const luminance=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
            const background=e=>{for(let n=e;n;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;if(b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b;const pseudo=getComputedStyle(n,'::before');if(pseudo.content!=='none'&&pseudo.backgroundColor!=='rgba(0, 0, 0, 0)')return pseudo.backgroundColor;}return 'rgb(255,255,255)';};
            const contrast=e=>{const a=luminance(getComputedStyle(e).color),b=luminance(background(e));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
            const selector='.chat-shell .conversation-top h2,.chat-shell .conversation-top p,.lenz-heading-copy h1,.lenz-heading-copy h2,.lenz-heading-copy p:not([hidden]),.overview-count-label,.overview-count small,.overview-section-heading h3,.overview-caption,.home-page .lede,.home-page .demo-note,.home-page .preview-top span,.home-page .recorded-top b,.home-page .recorded-top>span,.home-page .chapter-number,.home-page .gallery-summary p,.home-page #product-tabs strong,.home-page #product-tabs small,.home-page .program-copy>p,.home-page .program-example small,.home-page .programmability summary,.home-page .try-section p,.home-page .button';
            return {overflow:document.documentElement.scrollWidth>innerWidth+1,bg:getComputedStyle(document.querySelector('.lenz-heading:not([hidden])')||document.querySelector('.home-nav')||document.body).backgroundColor,low:[...document.querySelectorAll(selector)].filter(visible).map(e=>({text:e.textContent.slice(0,70),ratio:contrast(e)})).filter(x=>x.ratio<4.5),headers:[...document.querySelectorAll('.lenz-heading')].filter(visible).length,buttons:[...document.querySelectorAll('.lenz-heading-actions button')].filter(visible).map(e=>({name:e.getAttribute('aria-label'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),images:[...document.querySelectorAll('img[data-lenz-artwork]')].map(e=>e.getAttribute('src'))};
          });
          assert(!result.overflow,`${width} ${url} ${theme}: horizontal overflow`);
          assert.deepEqual(result.low,[],`${width} ${url} ${theme}: text contrast`);
          if(url!=='/index.html'&&url!=='/chat.html')assert.equal(result.headers,1,`${url}: exactly one section heading`);
          for(const b of result.buttons){assert(b.name);assert(b.width>=44&&b.height>=44,`${url}: utility target`);}
          for(const src of result.images)assert(theme==='light'?!/-(dim|dark)\.svg$/.test(src):src.endsWith('-'+theme+'.svg'));
          if(url==='/markets.html'){
            const card=page.locator('.overview-count').first();await card.hover();
            const hover=await card.evaluate(e=>{const s=getComputedStyle(e);return {shadow:s.boxShadow,border:s.borderTopWidth,outline:s.outlineStyle};});
            assert.deepEqual(hover,{shadow:'none',border:'0px',outline:'none'},'Pointer hover must not outline or frame the whole card');
          }
          surfaces.set(url+theme,result.bg);checks.push(`${width} ${url} ${theme}`);
          if(['/index.html','/markets.html','/markets.html?view=spot'].includes(url))await page.screenshot({path:path.join(screens,`${width}-${url.includes('spot')?'spot':url.includes('markets')?'overview':'home'}-${theme}.png`),fullPage:true});
        }
        if(url!=='/chat.html')assert.notEqual(surfaces.get(url+'dim'),surfaces.get(url+'dark'),`${url}: Dim and Dark surfaces must differ`);
      }
      await page.goto(base+'/markets.html');await page.emulateMedia({reducedMotion:'no-preference'});
      const card=page.locator('.overview-count').first(),box=await card.boundingBox();await page.mouse.move(box.x+20,box.y+20);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.overview-count-copy')).transform==='matrix(1, 0, 0, 1, 0, -4)');
      assert.deepEqual(await card.boundingBox(),box,'The visual lift preserves the entire card hit area');
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.overview-count .lenz-action-arrow')).transform==='matrix(1, 0, 0, 1, 3, -3)');
      await page.mouse.move(box.x+box.width/2,box.y+box.height-1);await page.mouse.down();await page.mouse.up();
      await page.locator('#hyperliquid-workspace').waitFor({state:'visible'});
      await page.goto(base+'/markets.html');const fresh=await page.locator('.overview-count').first().boundingBox();await page.mouse.move(fresh.x+20,fresh.y+20);await page.mouse.down();await page.mouse.move(1,1);await page.mouse.up();
      assert(await page.locator('#market-overview').isVisible(),'Dragging outside cancels card activation');
      await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.overview-count').first().hover();
      assert.equal(await page.locator('.overview-count-copy').first().evaluate(e=>getComputedStyle(e).transform),'none','Reduced motion prevents the visual lift');
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log(`${checks.length} responsive appearance checks passed; screenshots: ${screens}`);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
