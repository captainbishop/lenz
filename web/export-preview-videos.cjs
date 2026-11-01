// Export checked local Hyperframes compositions and verify the decoded output.
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process');
const {promisify}=require('node:util'),run=promisify(execFile),assert=require('node:assert/strict'),sharp=require('sharp'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),media=process.env.LENZ_MEDIA_WORKSPACE,sha=b=>createHash('sha256').update(b).digest('hex');
const cli=process.env.LENZ_HYPERFRAMES_ENTRY,ffmpeg=process.env.HYPERFRAMES_FFMPEG_PATH,ffprobe=process.env.HYPERFRAMES_FFPROBE_PATH;
assert(media&&cli&&ffmpeg&&ffprobe,'Set the external media workspace, Hyperframes entry, FFmpeg and FFprobe paths.');
async function command(file,args){return run(file,args,{windowsHide:true,maxBuffer:32*1024*1024,encoding:'buffer'});}
(async()=>{
 const build=JSON.parse(await fs.readFile(path.join(media,'build.json'))),videos=[];
 for(const [file,expected]of Object.entries(build.sourceFiles))assert.equal(sha(await fs.readFile(path.join(root,file))),expected,'Stale video source: '+file);
 const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
 for(const project of build.projects){
  const name=`${project.view}-${project.theme}`;if(only&&name!==only)continue;
  const check=JSON.parse((await fs.readFile(path.join(media,name+'-check.json'),'utf8')).replace(/^\uFEFF/,''));
  assert(check.ok&&!check.browserSkipped,`Composition check failed: ${name}`);
  for(const file of ['index.html',...project.states.map(s=>'compositions/'+project.view+'-'+s.id+'.html')]) {
   const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(path.join(project.directory,file)));
   assert(!/[\u00c2\u00c3\ufffd]|\u00e2[\u0080-\u00ff]/.test(text),'Corrupt text encoding: '+name+'/'+file);
  }
  const destination=path.join(media,name+'.mp4');
  if(!process.argv.includes('--collect')){
   console.log('Rendering '+name);
   const result=await command(process.execPath,[cli,'render',project.directory,'--quality','delivery','--fps','30','--workers','2','--output',destination]);
   await fs.writeFile(path.join(media,name+'-render.log'),Buffer.concat([result.stdout,result.stderr]));
  }
  const probe=JSON.parse((await command(ffprobe,['-v','error','-show_streams','-show_format','-of','json',destination])).stdout);
  const stream=probe.streams.find(s=>s.codec_type==='video');assert(stream);assert.equal(stream.width,1200);assert.equal(stream.height,1320);assert.equal(stream.r_frame_rate,'30/1');assert(!probe.streams.some(s=>s.codec_type==='audio'));assert(Math.abs(Number(probe.format.duration)-project.seconds)<.08);
  const decoded=(await command(ffmpeg,['-v','error','-i',destination,'-map','0:v:0','-f','framemd5','-'])).stdout.toString();
  const unique=new Set(decoded.split(/\r?\n/).filter(l=>/^0,/.test(l)).map(l=>l.split(',').at(-1).trim()));assert(unique.size>90,`Frozen motion: ${name}`);
  const review=path.join(media,'decoded',name);await fs.mkdir(review,{recursive:true});const sceneHashes=[];
  for(const [i,state]of project.states.entries()){
   const time=state.start+Math.min(state.duration-.3,2.8),buffer=(await command(ffmpeg,['-v','error','-ss',String(time),'-i',destination,'-frames:v','1','-f','image2pipe','-vcodec','png','-'])).stdout;
   await fs.writeFile(path.join(review,`${i}-${state.id}.png`),buffer);
   // Compare the central product area, independently of headings and the progress strip.
   sceneHashes.push(sha(await sharp(buffer).extract({left:76,top:320,width:1048,height:800}).resize(262,200).raw().toBuffer()));
   if(i===0)await sharp(buffer).webp({quality:95}).toFile(path.join(media,name+'.webp'));
  }
  assert.equal(new Set(sceneHashes).size,project.states.length,`Repeated product scenes: ${name}`);
  const images=await Promise.all(project.states.map(async(s,i)=>({input:await sharp(path.join(review,`${i}-${s.id}.png`)).resize(375,413).toBuffer(),left:i*375,top:0})));
  await sharp({create:{width:375*images.length,height:413,channels:3,background:'#ffffff'}}).composite(images).png().toFile(path.join(review,'phone-sheet.png'));
  const file=`web/public/previews/${name}.mp4`,poster=`web/public/previews/${name}.webp`;
  await fs.copyFile(destination,path.join(root,file));await fs.copyFile(path.join(media,name+'.webp'),path.join(root,poster));
  videos.push({view:project.view,theme:project.theme,seconds:project.seconds,fps:30,width:1200,height:1320,changingFrames:unique.size,states:project.states,sceneHashes,file,sha256:sha(await fs.readFile(path.join(root,file))),poster,posterSha256:sha(await fs.readFile(path.join(root,poster)))});
  console.log(`Verified ${name}: ${project.seconds}s, ${unique.size} changing decoded frames, ${project.states.length} distinct product scenes`);
 }
 if(only){await fs.writeFile(path.join(media,only+'-verified.json'),JSON.stringify(videos[0],null,2)+'\n');return;}
 assert.equal(videos.length,6);await fs.writeFile(path.join(__dirname,'public/previews/timelines.json'),JSON.stringify(Object.fromEntries(build.projects.filter(p=>p.theme==='light').map(p=>[p.view,p.states])),null,2)+'\n');const sourceFiles={...build.sourceFiles,'web/public/previews/timelines.json':sha(await fs.readFile(path.join(__dirname,'public/previews/timelines.json')))};for(const f of ['web/export-preview-videos.cjs','web/record-preview-videos.cjs'])sourceFiles[f]=sha(await fs.readFile(path.join(root,f)));
 await fs.writeFile(path.join(__dirname,'preview-recording.json'),JSON.stringify({recordedAt:new Date().toISOString(),renderer:'Hyperframes 0.8.226 / FFmpeg 9.0.2',sourceFiles,videos,apiRequests:build.apiRequests,errors:build.errors,scope:build.scope},null,2)+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
