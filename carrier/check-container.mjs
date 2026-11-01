import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import net from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createIdentity,sealMessage,openMessage} from '../web/public/peer-crypto.js';
import {wrapForCarrier,inboxRequest,carrierPost} from '../web/public/carrier-protocol.js';
const image=process.env.LENZ_CARRIER_IMAGE || 'lenz-carrier:local';
const docker=(...args)=>{const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin='http://127.0.0.1:'+port,name='lenz-carrier-smoke-'+Date.now(),volume=name+'-data';
const checks=[];let created=false,started=false;
try{
  docker('image','inspect',image);
  docker('volume','create','--label','lenz.test=carrier-smoke',volume);created=true;
  docker('run','--pull=never','-d','--name',name,'--label','lenz.test=carrier-smoke','--read-only','--cap-drop=ALL',
    '--security-opt=no-new-privileges:true','--pids-limit=64','--memory=256m','--cpus=1','--init',
    '-p',`127.0.0.1:${port}:4311`,'-e','CARRIER_ORIGIN='+origin,'-e','CARRIER_APP_ORIGINS=["http://127.0.0.1:4173"]',
    '-v',volume+':/data',image);started=true;
  const wait=async()=>{for(let i=0;i<40;i++){try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Container health deadline exceeded');};
  await wait();checks.push('container-health');
  const inspect=JSON.parse(docker('inspect',name))[0];assert.equal(inspect.Config.User,'node');assert(inspect.HostConfig.ReadonlyRootfs);assert.deepEqual(inspect.HostConfig.CapDrop,['ALL']);assert.equal(inspect.HostConfig.Memory,256*1024*1024);assert.equal(inspect.HostConfig.NanoCpus,1e9);assert.equal(inspect.HostConfig.PidsLimit,64);assert(inspect.HostConfig.SecurityOpt.includes('no-new-privileges:true'));checks.push('container-restrictions-configured');
  const files=JSON.parse(docker('exec',name,'node','-e',"console.log(JSON.stringify(require('fs').readdirSync('/app',{recursive:true}).filter(p=>require('fs').statSync('/app/'+p).isFile()).sort()))"));
  assert.deepEqual(files,['LICENSE','carrier/server.mjs','carrier/store.mjs','web/public/carrier-protocol.js','web/public/peer-crypto.js','web/public/profile-display.js']);checks.push('only-runtime-files-and-license');
  const sourceHashes={};
  for(const file of files){const expected=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
    const actual=docker('exec',name,'sha256sum','/app/'+file).split(' ')[0];assert.equal(actual,expected,file);sourceHashes[file]=expected;}
  checks.push('runtime-files-match-source');
  const a=await createIdentity('Container sender'),b=await createIdentity('Container recipient');
  const packet=await sealMessage(a,b.profile,{kind:'chat',text:'Container persistence check'}),envelope=await wrapForCarrier(a,packet);
  assert.equal((await carrierPost(origin,'/v1/store',envelope)).status,'stored');checks.push('signed-encrypted-custody');
  docker('restart',name);await wait();
  const inbox=(await carrierPost(origin,'/v1/inbox',await inboxRequest(b,origin))).envelopes;
  assert.deepEqual(inbox,[envelope]);assert.equal((await openMessage(b,a.profile,inbox[0].packet)).text,'Container persistence check');checks.push('persistent-volume-after-restart');
  await carrierPost(origin,'/v1/store',envelope);assert.equal((await carrierPost(origin,'/v1/inbox',await inboxRequest(b,origin))).envelopes.length,1);checks.push('duplicate-delivery-is-idempotent');
  const bad=await inboxRequest(b,origin);bad.signature='0'.repeat(128);await assert.rejects(carrierPost(origin,'/v1/inbox',bad));checks.push('unsigned-inbox-rejected');
  const report={checkedAt:new Date().toISOString(),engine:docker('version','--format','{{.Server.Version}}'),image:inspect.Image,sourceHashes,checks,passed:true,scope:'Disposable local Docker container and generated encrypted message. No user identity, wallet or financial transaction.'};
  await writeFile(new URL('./container-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
  if(started)docker('rm','-f',name);
  if(created)docker('volume','rm',volume);
}
