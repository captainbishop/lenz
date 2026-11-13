import {startOfflineAccess} from './offline-access.js';
import {readState,updateState} from './chat-store.js';
import {createIdentity} from './peer-crypto.js';
import {useAccountPasskey} from './account-keys.js';
import {setUpAccount,retrieveAccount,backupNow,startAccountSync} from './account-sync.js';
import {privateName} from './profile-display.js';
import {themeIcon} from './theme-icon.js';
import {saveOffline} from './save-offline.js';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),next=params.get('next')==='wallet'?'/money.html':'/chat.html',localAddress=location.hostname==='127.0.0.1';let busy=false,renderedIdentity=null;
$('.account-continue').href=next;$('.account-continue').firstChild.textContent=next==='/money.html'?'Open wallet ':'Open conversations ';
if(new URLSearchParams(location.search).has('next'))$('.account-heading').after($('#account-settings'));
async function render(){const state=await readState(),sync=state.accountSync,entry=params.has('next'),signIn=params.get('mode')==='signin'&&!state.identity;$('#account-name').textContent=state.identity?.profile.name??'';$('#account-start').hidden=!!state.identity;$('#account-existing').hidden=!state.identity;$('#account-enroll').hidden=!!sync;$('#account-protected').hidden=!sync;
  document.body.classList.toggle('account-entry-mode',entry);$('#account-welcome').hidden=!entry;
  $('#account-back').href=next;$('#account-back').lastChild.textContent=next==='/money.html'?' Back to wallet':' Back to conversations';
  $('#account-welcome-title').textContent=state.identity?'Welcome back, '+state.identity.profile.name+'.':signIn?'Welcome back.':'A name to call you.';
  $('#account-welcome-copy').textContent=state.identity?'Your profile is ready. Continue when you are.':signIn?'Open your account with your passkey.':'Choose a name you feel at home with.';
  $('#account-create-form').hidden=signIn;$('#account-sign-in-copy').hidden=signIn;
  $('#account-sign-in').classList.toggle('welcome-primary',signIn);$('#account-sign-in').classList.toggle('welcome-text',!signIn);
  $('#account-switch-mode').hidden=!signIn;$('#account-switch-mode').href='/account.html?next='+(next==='/money.html'?'wallet':'chat');$('#account-switch-mode').textContent='Create an account or start on this device';
  $('#account-access-note').textContent=navigator.onLine?'':'You are offline. Use this device only to continue. Passkey sign-in and backup need a connection.';
  const identity=state.identity?.profile.id??null;if(identity!==renderedIdentity){renderedIdentity=identity;dispatchEvent(new Event('lenz-account-identity'));}
  if(!state.identity||new URLSearchParams(location.search).has('next'))$('#account-settings').open=true;
  if(sync){$('#account-backup-state').textContent=sync.status==='conflict'?'Needs attention':sync.status==='saved'&&sync.savedVersion===sync.version?'Backed up':sync.status==='uploading'?'Saving…':'Waiting to back up';$('#account-backup-detail').textContent=sync.status==='conflict'?'Another device has newer changes. Your changes remain saved here.':sync.savedAt?'Last backup '+new Date(sync.savedAt).toLocaleString():'Changes are saved on this device until backup completes.';$('#account-retry').hidden=sync.status==='saved'||sync.status==='conflict';}
  for(const id of ['account-create','account-sign-in','account-enable','account-passkey-copy'])$('#'+id).hidden=localAddress;
  if(!navigator.onLine){$('#account-create').hidden=true;$('#account-passkey-copy').hidden=true;}
  $('#account-local').classList.toggle('welcome-primary',!navigator.onLine||localAddress);
  $('#account-local').classList.toggle('welcome-secondary',navigator.onLine&&!localAddress);
  $('#account-create-form .welcome-divider').hidden=!navigator.onLine||localAddress;
  if(localAddress){$('#account-local-detail').textContent='Start without internet or a passkey. Your profile stays in this browser; clearing its data loses access. Automatic backup is unavailable at this address. You can save a manual chat backup.';$('#account-enroll-detail').textContent='Automatic backup is unavailable at this address. Save a manual chat backup under More recovery options.';}
}
async function action(fn){if(busy)return;busy=true;$('#account-settings').setAttribute('aria-busy','true');for(const button of document.querySelectorAll('#account-settings button'))button.disabled=true;$('#account-status').textContent='';try{await fn();}catch(e){$('#account-status').textContent=e.name==='NotAllowedError'?'Sign-in cancelled. You can try again.':e instanceof SyntaxError?'Account access is unavailable at this address. Start on this device or try again when connected.':e.message;}finally{busy=false;$('#account-settings').setAttribute('aria-busy','false');for(const button of document.querySelectorAll('#account-settings button'))button.disabled=false;await render();}}
async function create(){if(!navigator.onLine)throw Error('You are offline. Use this device only to continue, then turn on backup when connected.');const state=await readState(),name=state.identity?.profile.name||$('#account-create-name').value.trim()||privateName();$('#account-status').textContent='Confirm your passkey to create your account…';const material=await useAccountPasskey(true,name);try{await setUpAccount(material,state.identity?.profile.id??null);}finally{material.phrase='';}startAccountSync();await render();void saveOffline().catch(()=>{});try{$('#account-status').textContent='Saving your account…';await backupNow();$('#account-status').textContent=(await readState()).accountSync?.status==='saved'?'Automatic backup is on.':'Changes are saved on this device.';}catch{$('#account-status').textContent='Saved on this device. Backup will retry when connected.';}await render();if(params.has('next'))location.assign(next);}
async function createLocal(){
  const name=$('#account-create-name').value.trim()||privateName();
  await updateState(async state=>{
    if(state.identity||state.accountSync||state.recoveredChat)throw new Error('This browser already has an account. Reload to see it.');
    state.identity=await createIdentity(name);
  });
  walletUpdates?.postMessage('changed');
  $('#account-status').textContent=localAddress?'Profile saved on this device. Manual chat backup is available under More recovery options.':'Profile saved on this device. You can turn on backup when connected.';
  if(params.has('next'))location.assign(next);
}
$('#account-create-form').onsubmit=e=>{e.preventDefault();action(localAddress||!navigator.onLine?createLocal:create);};$('#account-enable').onclick=()=>action(create);
$('#account-local').onclick=()=>action(createLocal);
$('#account-sign-in').onclick=()=>action(async()=>{if(!navigator.onLine)throw Error('Sign in when connected. Use this device only to start an offline profile.');$('#account-status').textContent='Confirm your passkey to open your account…';const material=await useAccountPasskey(false);try{await retrieveAccount(material);}finally{material.phrase='';}void saveOffline().catch(()=>{});location.assign(next);});
$('#account-retry').onclick=()=>action(async()=>{await backupNow();});
themeIcon($('#theme-toggle'));
addEventListener('lenz-backup-status',()=>render());addEventListener('online',()=>render());addEventListener('offline',()=>render());
const walletUpdates=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
walletUpdates?.addEventListener('message',()=>render());
$('#account-development').hidden=!['localhost','127.0.0.1'].includes(location.hostname);
await render();
if(location.hostname==='127.0.0.1'){$('#account-address-note').hidden=false;const url=new URL(location.href);url.hostname='localhost';$('#account-address').href=url.href;}
else{startAccountSync();}
startOfflineAccess();
