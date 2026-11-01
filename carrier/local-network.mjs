import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origins=[4311,4312,4313].map(port=>'http://127.0.0.1:'+port),children=[];
let closing=false;
function close(){if(closing)return;closing=true;for(const child of children)child.kill();}
for(const [i,origin]of origins.entries()){
  const child=spawn(process.execPath,['carrier/server.mjs'],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,
    CARRIER_ORIGIN:origin,CARRIER_HOST:'127.0.0.1',CARRIER_PORT:String(4311+i),CARRIER_DATA_DIR:resolve(root,'carrier/.data/local-'+i),
    CARRIER_PEERS:JSON.stringify([origins[(i+1)%origins.length]]),CARRIER_APP_ORIGINS:JSON.stringify(['http://127.0.0.1:4173'])}});
  children.push(child);child.on('error',error=>{console.error(error.message);process.exitCode=1;close();});
  child.on('exit',code=>{if(!closing){process.exitCode=code||1;close();}});
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,close);
console.log('Three local carriers. Configure the app with LENZ_CARRIERS='+JSON.stringify(origins));
