import {readState} from './chat-store.js';
import {prepareChatBackup} from './recovery-service.js';
import {stageChatRestore} from './chat-restore.js';
import {themeIcon} from './theme-icon.js';
import {saveOffline} from './save-offline.js';
import {isRecoveredChat} from './chat-access.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let generation=0,prepared=null,history=null,busy=false,restoreReview=null,installing=false;
const status=text=>{$('#backup-status').textContent=text;};
const count=(n,noun)=>`${n} ${noun}${n===1?'':'s'}`;
function clear(){if(installing)return;generation++;restoreReview?.cancel();restoreReview=null;$('#restore-chat-review').hidden=true;$('#restore-chat-consent').checked=false;prepared=null;history=null;busy=false;$('#saved-backup-phrase').value='';$('#backup-words').replaceChildren();$('#backup-challenge').querySelectorAll('label').forEach(n=>n.remove());$('#backup-phrase').value='';$('#backup-file').value='';$('#backup-prepared').hidden=true;$('#backup-history').hidden=true;$('#history-contacts').replaceChildren();$('#history-messages').replaceChildren();$('#open-backup-form').hidden=false;$('#prepare-backup').hidden=false;$('#prepare-backup').disabled=false;$('#open-backup').disabled=false;$('#download-status').textContent='';status('');}
function show(mode,focus=true){if(installing)return;clear();const create=mode==='create';$('#create-panel').hidden=!create;$('#open-panel').hidden=create;$('#create-tab').setAttribute('aria-pressed',String(create));$('#open-tab').setAttribute('aria-pressed',String(!create));if(focus)$(create?'#create-title':'#open-title').focus();}
$('#create-tab').onclick=()=>show('create');$('#open-tab').onclick=()=>show('open');$('#close-history').onclick=()=>show('open');
$('#prepare-backup').onclick=async()=>{
  if(busy)return;busy=true;const own=++generation;$('#prepare-backup').disabled=true;status('Preparing encrypted backup…');
  try{
    const result=await prepareChatBackup($('#saved-backup-phrase').value);if(own!==generation)return;prepared=result;$('#saved-backup-phrase').value='';
    $('#backup-counts').textContent=`${result.name} · ${count(result.contacts,'contact')} · ${count(result.messages,'text message')}`+(result.excluded?` · ${count(result.excluded,'payment record')} excluded`:'');
    $('#backup-words').replaceChildren(...result.phrase.split(' ').map(w=>el('li',w)));
    for(const position of [1,9,17]){const label=el('label','Word '+(position+1)),input=el('input');input.id='backup-word-'+position;input.dataset.position=position;input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;input.required=true;input.maxLength=20;label.append(input);$('#backup-challenge').append(label);}
    $('#backup-prepared').hidden=false;$('#prepare-backup').hidden=true;status('');$('#backup-word-1').focus();
  }catch(error){if(own===generation)status(error.message);}finally{if(own===generation){busy=false;$('#prepare-backup').disabled=false;}}
};
$('#confirm-backup-form').onsubmit=event=>{
  event.preventDefault();if(!prepared)return;
  const words=prepared.phrase.split(' '),inputs=[...$('#backup-challenge').querySelectorAll('input')];
  const wrong=inputs.find(n=>n.value.trim().toLowerCase()!==words[Number(n.dataset.position)]);
  if(wrong){status('That word does not match. Check your saved phrase.');wrong.focus();return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(prepared.archive)],{type:'application/json'}));
  const a=el('a');a.href=url;a.download='lenz-chat-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('#download-status').textContent='Download requested. Open the saved file with your phrase to verify it.';status('');
};
function selectContact(id){
  if(!history)return;for(const b of $('#history-contacts').children)b.setAttribute('aria-pressed',String(b.dataset.id===id));
  const peer=history.contacts.find(p=>p.id===id),rows=history.history.filter(r=>r.packet.from===id||r.packet.to===id),panel=$('#history-messages');panel.replaceChildren();
  for(const row of rows){const p=el('p');p.append(el('small',history.ownIds.includes(row.packet.from)?'You':peer.name),document.createTextNode(row.payload.text));panel.append(p);}
  if(!rows.length)panel.append(el('p','No text messages in this backup.'));
  panel.scrollTop=0;
}
function clearOpened(){generation++;history=null;busy=false;$('#open-backup').disabled=false;$('#backup-history').hidden=true;$('#history-contacts').replaceChildren();$('#history-messages').replaceChildren();status('');}
$('#backup-file').onchange=clearOpened;$('#backup-phrase').oninput=clearOpened;
$('#open-backup-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;const file=$('#backup-file').files[0],phrase=$('#backup-phrase').value,own=++generation;busy=true;$('#open-backup').disabled=true;status('Checking backup…');
  try{
    const result=await stageChatRestore(phrase,file);if(own!==generation){result.cancel();return;}
    restoreReview=result;history=result.preview;
    $('#backup-phrase').value='';$('#backup-file').value='';$('#open-backup-form').hidden=true;$('#backup-history').hidden=false;
    $('#history-name').textContent=history.sourceProfile.name;$('#history-counts').textContent=`${count(history.contacts.length,'contact')} · ${count(history.history.length,'text message')}`;
    for(const peer of history.contacts){const b=el('button',peer.name);b.type='button';b.dataset.id=peer.id;b.onclick=()=>selectContact(peer.id);$('#history-contacts').append(b);}
    selectContact(history.contacts[0]?.id);status('Backup checked. Your chats are open on this device.');$('#close-history').focus();
    $('#restore-chat-review').hidden=false;$('#restore-chat-consent').checked=false;$('#restore-chat').disabled=true;
    $('#restore-chat-fields p').textContent=result.identityChanged?'Restore your chats with a new Lenz ID. Send the account update to your contacts. Funds will not be restored.':'Continue with the same Lenz ID and conversations. New messages save automatically on this device. Funds are not restored.';
    $('#restore-chat-fields').hidden=!result.canInstall;$('#restore-existing').hidden=result.canInstall;
  }catch(error){if(own===generation)status(error instanceof SyntaxError?'This file is not a Lenz chat backup.':error.message);}finally{if(own===generation){busy=false;$('#open-backup').disabled=false;}}
};
$('#restore-chat-consent').onchange=()=>{$('#restore-chat').disabled=!restoreReview?.canInstall||!$('#restore-chat-consent').checked;};
$('#restore-chat').onclick=async()=>{
  if(installing||!restoreReview||!$('#restore-chat-consent').checked)return;installing=true;
  for(const id of ['restore-chat','close-history','create-tab','open-tab'])$('#'+id).disabled=true;
  status('Restoring your chats…');
  try{await restoreReview.install();restoreReview=null;location.assign('/chat.html');}
  catch(error){status(error.message);}
  finally{installing=false;for(const id of ['close-history','create-tab','open-tab'])$('#'+id).disabled=false;$('#restore-chat').disabled=!restoreReview||!$('#restore-chat-consent').checked;}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden){const open=!$('#open-panel').hidden;show(open?'open':'create',false);}});
addEventListener('pagehide',()=>{restoreReview?.cancel();clear();});addEventListener('keydown',event=>{if(event.key==='Escape')show($('#open-panel').hidden?'create':'open');});
themeIcon(document.querySelector('#theme-toggle'));
$('#save-backup-offline').onclick=async()=>{
  $('#save-backup-offline').disabled=true;$('#backup-cache-status').textContent='Saving…';
  try{await saveOffline();$('#backup-cache-status').textContent='Page saved for offline use.';}
  catch{$('#backup-cache-status').textContent='Could not save offline. Retry when connected.';}finally{$('#save-backup-offline').disabled=false;}
};
try{const state=await readState();$('#backup-account').textContent=state.identity?.profile.name??'No account in this browser';$('#saved-phrase-field').hidden=!isRecoveredChat(state.identity);if(!state.identity)show('open',false);}catch{show('open',false);status('Could not read the account in this browser. You can still open a backup.');}
