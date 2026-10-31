// Edited motion from actual UI evidence. This renderer makes no transactions.
const { chromium } = require('playwright'), sharp = require('sharp');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:4173', output = path.join(__dirname, 'public/previews');
const encoder = process.env.LENZ_FFMPEG || path.join(root, 'tooling/.preview-runtime/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const sha = b => createHash('sha256').update(b).digest('hex');
async function encode(page, file) {
  await page.bringToFront();
  const seconds = await page.evaluate(() => duration), frames = seconds * 30, unique = new Set();
  const child = spawn(encoder, ['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-an','-vf','sidedata=mode=delete:type=ICC_PROFILE,scale=in_range=pc:out_range=tv:out_color_matrix=bt709','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-map_metadata','-1','-movflags','+faststart',file], { windowsHide: true, stdio: ['pipe','ignore','pipe'] });
  let error = ''; child.stderr.on('data', b => error += b); child.stdin.on('error', e => error += e.message);
  const done = new Promise((resolve,reject) => { child.on('error',reject); child.on('close',code => code === 0 ? resolve() : reject(Error(error))); });
  try {
    for(let frame=0;frame<frames;frame++) {
      await page.evaluate(t=>window.render(t),frame/30);
      const data=await page.screenshot({type:'jpeg',quality:96}); unique.add(sha(data));
      if(!child.stdin.write(data))await new Promise(resolve=>child.stdin.once('drain',resolve));
    }
  } finally { child.stdin.end(); await done; }
  assert(unique.size > 90, `Insufficient distinct motion frames: ${unique.size}`);
  return { seconds, fps: 30, changingFrames: unique.size };
}
(async () => {
  const flow = JSON.parse(await fs.readFile(path.join(__dirname, 'preview-flow-results.json')));
  assert(flow.complete && flow.checks.length === 6 && flow.receipts.length === 2);
  assert.equal(flow.receipts[1].input, flow.receipts[0].id + ':0');
  const sourceFiles = { ...flow.sourceFiles }, errors = [], api = [], videos = [];
  for (const [file, expected] of Object.entries(sourceFiles)) assert.equal(sha(await fs.readFile(path.join(root,file))), expected, 'Captured source changed: '+file);
  for (const file of ['web/record-preview-videos.cjs','web/render-preview-stories.cjs','web/preview-scene.html','web/preview-flow-results.json']) sourceFiles[file] = sha(await fs.readFile(path.join(root,file)));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const theme of ['light','dark']) {
      const context = await browser.newContext({ viewport: { width: 600, height: 660 }, reducedMotion: 'reduce', colorScheme: theme });
      await context.addInitScript(t => localStorage.setItem('lenz-home-theme',t),theme);
      const p = await context.newPage(); p.on('pageerror',e=>errors.push(e.message));
      context.on('request',r=>{ const u=new URL(r.url()); if(u.origin!==base)return; if(u.pathname.startsWith('/api/'))api.push(u.pathname); if(/\.(js|css|html|json)$/.test(u.pathname))sourceFiles['web/public'+u.pathname]??=null; });
      const images = {};
      for (const [name, captures] of Object.entries(flow.captures)) {
        const shot = captures[theme], data=await fs.readFile(path.join(root,shot.file)); assert.equal(sha(data),shot.sha256); sourceFiles[shot.file]=shot.sha256;
        images[name]='data:image/png;base64,'+data.toString('base64');
      }
      // Profile edits use a new unfunded account, never an existing test wallet.
      await p.goto(base+'/money.html'); await p.locator('#wallet-private').click(); await p.locator('#wallet-content').waitFor();
      const identity=()=>p.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return {id:s.identity.profile.id,key:s.identity.profile.signingPublic};});
      const before=await identity(); await p.locator('#show-profile').click();
      await p.addStyleTag({content:`#edit-profile{width:520px!important;padding:24px!important;border-radius:0!important;max-height:none!important} #edit-profile .quiet,.profile-storage,.profile-privacy,.name-tools,#edit-profile .file-label,#remove-photo{display:none!important} #edit-profile .dialog-top h2{font-size:20px} .profile-photo-row{margin:8px 0!important} .profile-photo-row .avatar{width:48px;height:48px} .avatar-picker{margin:0 0 8px!important} .avatar-option{width:42px;height:42px} .avatar-option img{width:30px;height:30px} #profile-name{padding:6px} #save-profile{padding:8px;margin-top:12px} #edit-profile .dialog-top{margin:0} #edit-profile label{margin-top:8px}`});
      async function profileShot(name) {
        const data=await p.locator('#edit-profile').screenshot();
        images[name]='data:image/png;base64,'+(await sharp(data).resize(520,350,{fit:'contain',background:theme==='dark'?'#20382b':'#fff'}).png().toBuffer()).toString('base64');
      }
      await profileShot('profile-start'); await p.locator('#avatar-options button').nth(1).click(); await profileShot('profile-symbol');
      await p.locator('#profile-name').fill('Amina'); await p.locator('#save-profile').click(); await p.locator('#edit-profile').waitFor({state:'hidden'});
      await p.locator('#show-profile').click(); await profileShot('profile-name'); assert.deepEqual(await identity(),before); assert.equal(await p.locator('#near-total').textContent(),'0');
      const scene=await context.newPage(); scene.on('pageerror',e=>errors.push(e.message));
      await scene.setContent(await fs.readFile(path.join(__dirname,'preview-scene.html'),'utf8'));
      for (const view of ['chat','wallet','profile']) {
        await scene.evaluate(options=>window.setup(options),{view,theme,images});
        const name=`${view}-${theme}`;
        await scene.evaluate(()=>window.render(1.5));
        await sharp(await scene.screenshot()).webp({quality:90}).toFile(path.join(output,name+'.webp'));
        await fs.mkdir(path.join(__dirname,'.recordings/review'),{recursive:true});
        for(const t of view==='wallet'?[2,7,12,17]:view==='chat'?[2,6,10,15]:[2,6,10]){await scene.evaluate(t=>window.render(t),t);await scene.screenshot({path:path.join(__dirname,`.recordings/review/${name}-${t}.png`)});}
        if(process.argv.includes('--frames'))continue;
        await scene.evaluate(()=>window.render(0));
        const timing=await encode(scene,path.join(output,name+'.mp4'));
        videos.push({view,theme,...timing,width:600,height:660,file:'web/public/previews/'+name+'.mp4',sha256:sha(await fs.readFile(path.join(output,name+'.mp4'))),poster:'web/public/previews/'+name+'.webp',posterSha256:sha(await fs.readFile(path.join(output,name+'.webp')))});
        console.log(`Rendered ${name}: ${timing.seconds.toFixed(1)}s, ${timing.changingFrames} changing frames`);
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
    if(process.argv.includes('--frames')){console.log('Review frames generated; videos and recording manifest unchanged.');return;}
    for(const file of Object.keys(sourceFiles))sourceFiles[file]=sha(await fs.readFile(path.join(root,file)));
    await fs.writeFile(path.join(__dirname,'preview-recording.json'),JSON.stringify({recordedAt:new Date().toISOString(),browser:await browser.version(),encoder:'imageio-ffmpeg 0.6.0 / FFmpeg 7.1',sourceFiles,videos,apiRequests:0,errors,scope:'Edited motion sequences from actual isolated Edge UI captures. The chat/payment source run used existing backed testnet tUSD and final NEAR receipts; see preview-flow-results.json. Rendering repeats no financial action. Profile changes use a fresh zero-balance identity. Crops, explanatory graphics and timing are presentation edits, not live transactions or automatic mesh transport.'},null,2)+'\n');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
