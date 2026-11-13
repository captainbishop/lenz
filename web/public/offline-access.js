const targets=[['/sw.js','/','home-status'],...['/chat.html','/money.html','/swap-tools.html','/recovery.html','/account.html'].map(scope=>['/chat-sw.js',scope,'offline-status'])];
let pending;
function activated(worker) {
 if(!worker)throw Error('Offline files are not saved yet.');
 if(worker.state==='activated')return Promise.resolve(worker);
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);error?reject(error):resolve(worker);};
  const changed=()=>{if(worker.state==='activated')finish();else if(worker.state==='redundant')finish(Error('Offline saving was interrupted.'));};
  const timer=setTimeout(()=>finish(Error('Offline saving is taking longer than expected.')),60000);
  worker.addEventListener('statechange',changed);changed();
 });
}
function complete(worker,type,field='complete') {
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),finish=error=>{clearTimeout(timer);channel.port1.close();error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(Error('Offline files could not be checked.')),type.startsWith('prepare')?60000:10000);
  channel.port1.onmessage=({data})=>finish(data?.[field]===true?null:Error('Some offline files are missing.'));
  worker.postMessage({type},[channel.port2]);
 });
}
export function ensureOfflineAccess() {
 if(pending)return pending;
 pending=(async()=>{
  if(!('serviceWorker' in navigator))throw Error('This browser cannot save Lenz for offline use.');
  const installed=await navigator.serviceWorker.getRegistrations();
  for(const [script,scope,type]of targets){
   const existing=installed.find(r=>r.scope===new URL(scope,location.origin).href);
   // Opening saved files never waits for the server or an update check.
   if(existing?.active?.scriptURL===new URL(script,location.origin).href){
    try{await complete(existing.active,type);if(navigator.onLine)void existing.update().catch(()=>{});continue;}catch{}
   }
   if(!navigator.onLine)throw Error('Some offline files are missing.');
   const registration=await navigator.serviceWorker.register(script,{scope});
   // An existing registration can return its old worker before checking the new script.
   if(registration.active&&!registration.installing&&!registration.waiting)await registration.update();
   const worker=await activated(registration?.installing??registration?.waiting??registration?.active);
   if(worker.scriptURL!==new URL(script,location.origin).href)throw Error('Offline files need updating.');
   try{await complete(worker,type);}
   catch{await complete(worker,type==='home-status'?'prepare-home':'prepare',type==='home-status'?'complete':'ok');await complete(worker,type);}
  }
 })().finally(()=>{pending=null;});
 return pending;
}
export function startOfflineAccess(node) {
 let generation=0;
 async function check(){
  const ticket=++generation,online=navigator.onLine;
  if(node){node.dataset.offlineState='saving';node.textContent=online?'Saving for offline use…':'Checking offline files…';}
  try{await ensureOfflineAccess();if(ticket===generation&&node){node.dataset.offlineState='ready';node.textContent='Ready offline';node.title='Lenz is saved on this device.';}}
  catch{if(ticket===generation&&node){node.dataset.offlineState='unavailable';node.textContent=navigator.onLine?'Offline save incomplete. Reload to retry.':'Connect once to finish saving Lenz.';node.title='Your saved account data has not been changed.';}}
  if(ticket===generation&&online!==navigator.onLine)void check();
 }
 addEventListener('online',check);addEventListener('offline',check);addEventListener('lenz-offline-files',check);void check();
}
