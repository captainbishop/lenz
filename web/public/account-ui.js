import {readState} from './chat-store.js';
import {useAccountPasskey} from './account-keys.js';
import {setUpAccount,retrieveAccount,backupNow,startAccountSync} from './account-sync.js';
import {privateName} from './profile-display.js';
import {themeIcon} from './theme-icon.js';
import {saveOffline} from './save-offline.js';
const $=s=>document.querySelector(s),next=new URLSearchParams(location.search).get('next')==='wallet'?'/money.html':'/chat.html';let busy=false;
$('.account-continue').href=next;$('.account-continue').firstChild.textContent=next==='/money.html'?'Open wallet ':'Open conversations ';
async function render(){const state=await readState(),sync=state.accountSync;$('#account-name').textContent=state.identity?.profile.name??'';$('#account-start').hidden=!!state.identity;$('#account-existing').hidden=!state.identity;$('#account-enroll').hidden=!!sync;$('#account-protected').hidden=!sync;
  if(sync){$('#account-backup-state').textContent=sync.status==='conflict'?'Needs attention':sync.status==='saved'&&sync.savedVersion===sync.version?'Backed up':sync.status==='uploading'?'Saving…':'Waiting to back up';$('#account-backup-detail').textContent=sync.status==='conflict'?'Another device has newer changes. Your changes remain saved here.':sync.savedAt?'Last backup '+new Date(sync.savedAt).toLocaleString():'Changes are saved on this device until backup completes.';$('#account-retry').hidden=sync.status==='saved'||sync.status==='conflict';}
}
async function action(fn){if(busy)return;busy=true;for(const button of document.querySelectorAll('main button'))button.disabled=true;$('#account-status').textContent='';try{await fn();}catch(e){$('#account-status').textContent=e.name==='NotAllowedError'?'Sign-in cancelled. You can try again.':e.message;}finally{busy=false;for(const button of document.querySelectorAll('main button'))button.disabled=false;await render();}}
async function create(){const state=await readState(),name=state.identity?.profile.name||$('#account-create-name').value.trim()||privateName();const material=await useAccountPasskey(true,name);try{await setUpAccount(material,state.identity?.profile.id??null);}finally{material.phrase='';}startAccountSync();await render();try{await saveOffline().catch(()=>{});await backupNow();$('#account-status').textContent=(await readState()).accountSync?.status==='saved'?'Automatic backup is on.':'Changes are saved on this device.';}catch{$('#account-status').textContent='Saved on this device. Backup will retry when connected.';}await render();}
$('#account-create-form').onsubmit=e=>{e.preventDefault();action(create);};$('#account-enable').onclick=()=>action(create);
$('#account-sign-in').onclick=()=>action(async()=>{const material=await useAccountPasskey(false);try{await retrieveAccount(material);}finally{material.phrase='';}await saveOffline().catch(()=>{});location.assign(next);});
$('#account-retry').onclick=()=>action(async()=>{await backupNow();});
const paint=()=>themeIcon($('#theme-toggle'),document.documentElement.dataset.theme==='dark');paint();$('#theme-toggle').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';paint();};
addEventListener('lenz-backup-status',()=>render());addEventListener('online',()=>render());addEventListener('offline',()=>render());
$('#account-development').hidden=!['localhost','127.0.0.1'].includes(location.hostname);
if(location.hostname==='127.0.0.1'){$('#account-start').hidden=true;$('#account-existing').hidden=true;$('#account-address-note').hidden=false;const url=new URL(location.href);url.hostname='localhost';$('#account-address').href=url.href;}
else{await render();startAccountSync();}
