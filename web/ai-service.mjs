import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {nearAIOptions} from '../integrations/chart-analysis.mjs';

// Only counters are stored. A failed or interrupted request still uses its allowance.
export class AIUsageStore{
  constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL,id TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,id));');}
  consume(id,now,{perAccount=20,total=100}={}){
    const day=new Date(now).toISOString().slice(0,10);this.db.exec('BEGIN IMMEDIATE');
    try{
      const count=this.db.prepare('SELECT count FROM ai_usage WHERE day=? AND id=?').get(day,id)?.count??0;
      const sum=this.db.prepare('SELECT COALESCE(SUM(count),0) AS n FROM ai_usage WHERE day=?').get(day).n;
      if(count>=perAccount||sum>=total)throw Error('AI daily limit reached.');
      this.db.prepare('INSERT INTO ai_usage VALUES (?,?,1) ON CONFLICT(day,id) DO UPDATE SET count=count+1').run(day,id);
      this.db.prepare('DELETE FROM ai_usage WHERE day<?').run(new Date(now-7*86400000).toISOString().slice(0,10));this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
export function aiConfigured(config,ids,{nodeVersion=process.versions.node}={}){
  try{nearAIOptions(config,{nodeVersion});return Array.isArray(ids)&&ids.length>0&&ids.length<=32&&ids.every(id=>/^[a-f0-9]{64}$/.test(id));}catch{return false;}
}
export function runAIWorker(config,input,{signal,timeoutMs=45000,WorkerClass=Worker}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('AI request cancelled.'));return;}
    const worker=new WorkerClass(new URL('./ai-worker.mjs',import.meta.url),{workerData:{config,input},stdout:true,stderr:true});
    // Never forward SDK diagnostics: they can contain request or credential data.
    worker.stdout?.resume();worker.stderr?.resume();let settled=false;
    const finish=async(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);await worker.terminate();error?reject(Error('NEAR AI could not verify a reply.')):resolve(result);};
    const abort=()=>void finish(true),timer=setTimeout(abort,timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',message=>void finish(!!message.error,message.result));worker.once('error',()=>void finish(true));worker.once('exit',()=>{if(!settled)void finish(true);});
    if(signal?.aborted)abort();
  });
}
