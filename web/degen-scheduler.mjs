// Pace the shared public API budget instead of spending it in a burst.
export function createDegenScheduler({clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const sources=new Map([['geckoterminal',{spacing:2500,next:0,failures:0}],['dexscreener',{spacing:1500,next:0,failures:0}]]);
 const queue=[];let active=0,timer=null;
 const retry=(provider,message='Data queue busy')=>Object.assign(Error(message),{retryAfterMs:Math.max(1000,sources.get(provider).next-clock())});
 function remove(job){queue.splice(queue.indexOf(job),1);job.signal?.removeEventListener('abort',job.cancel);}
 function pump(){
  clearTimer(timer);timer=null;const now=clock();
  // Leave room for the upstream's 12s timeout inside the browser's 30s lifetime.
  for(const job of [...queue])if(now-job.created>=10000){remove(job);job.reject(retry(job.provider));}
  if(!queue.length)return;
  // Age waiting work so continuous chart selections cannot starve trade/history reads.
  const score=job=>now-job.created>=7500?-1:job.priority;
  const ready=active<4?queue.filter(job=>sources.get(job.provider).next<=now).sort((a,b)=>score(a)-score(b)||a.created-b.created):[];
  if(!ready.length){const wake=Math.min(...queue.map(job=>Math.min(job.created+10000,active<4?sources.get(job.provider).next:Infinity)));timer=setTimer(pump,Math.max(1,wake-now));return;}
  const job=ready[0],source=sources.get(job.provider);remove(job);
  source.next=now+source.spacing;active++;
  Promise.resolve().then(()=>{job.signal?.throwIfAborted();return job.work();}).then(value=>{source.failures=0;job.resolve(value);},error=>{
   if(error.retryAfterMs){source.failures++;const delay=error.providerRetryAfter===false?Math.min(60000,5000*2**Math.min(source.failures-1,4)):Math.max(1000,Math.min(300000,error.retryAfterMs));source.next=Math.max(source.next,clock()+delay);error.retryAfterMs=delay;}
   job.reject(error);
  }).finally(()=>{active--;pump();});
  pump();
 }
 return {
  delay:provider=>Math.max(0,sources.get(provider).next-clock()),
  run(provider,work,{signal,priority=1}={}){
   signal?.throwIfAborted();if(!sources.has(provider))throw Error('Unknown data provider');
   if(sources.get(provider).next-clock()>=10000)return Promise.reject(retry(provider,'Waiting for data'));
   if(queue.length>=32){const displaced=[...queue].reverse().sort((a,b)=>b.priority-a.priority)[0];if(displaced.priority<=priority)return Promise.reject(retry(provider));remove(displaced);displaced.reject(retry(displaced.provider));}
   return new Promise((resolve,reject)=>{
    const job={provider,work,signal,priority,created:clock(),resolve,reject};
    job.cancel=()=>{const index=queue.indexOf(job);if(index<0)return;queue.splice(index,1);signal.removeEventListener('abort',job.cancel);reject(signal.reason);pump();};
    queue.push(job);signal?.addEventListener('abort',job.cancel,{once:true});pump();
   });
  }
 };
}
