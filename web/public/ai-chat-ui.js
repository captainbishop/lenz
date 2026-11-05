import {readState} from './chat-store.js';
import {signValue} from './peer-crypto.js';
import {aiConversation,aiIdentity,aiTerms} from './ai-conversation.js';

const $=s=>document.querySelector(s);
const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const entry=document.createElement('button');entry.type='button';entry.id='open-ai-chat';entry.className='secondary';entry.innerHTML='<span>NEAR AI</span>'+icon('M5 19 19 5M5 5h14v14');
$('#chat-wallet').before(entry);
const dialog=document.createElement('dialog');dialog.id='ai-chat-dialog';dialog.setAttribute('aria-labelledby','ai-chat-title');
dialog.innerHTML=`<div class="ai-chat-heading"><div><h2 id="ai-chat-title">NEAR AI</h2><p id="ai-availability" role="status">Checking connection…</p></div><button id="ai-clear" type="button" class="secondary" aria-label="Clear AI conversation" title="Clear conversation">${icon('M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7')}</button><button id="ai-close" type="button" class="secondary" aria-label="Close NEAR AI">${icon('m6 6 12 12M18 6 6 18')}</button></div>
<div id="ai-messages" role="log" aria-label="AI conversation"></div>
<form id="ai-compose"><label for="ai-message">Ask NEAR AI</label><textarea id="ai-message" rows="3" maxlength="2000" placeholder="Ask a question" required></textarea><label class="ai-consent"><input id="ai-consent" type="checkbox"> <span>Share this AI conversation with the Lenz server and NEAR AI. Private chats and wallet data aren’t included.</span></label><div class="ai-compose-actions"><span id="ai-feedback" role="status"></span><button id="ai-stop" type="button" class="secondary" hidden>Stop</button><button id="ai-send" type="submit" disabled>Send</button></div></form><p class="ai-session-note">Replies can be wrong. No access to funds. Cleared when you close.</p>`;
document.body.append(dialog);
let messages=[],account=null,available=false,busy=false,controller=null,generation=0;
function controls(){ $('#ai-send').disabled=!available||!account||!navigator.onLine||busy||!$('#ai-consent').checked;$('#ai-message').disabled=busy;$('#ai-stop').hidden=!busy; }
function reset(){generation++;controller?.abort();controller=null;messages=[];account=null;busy=false;$('#ai-messages').replaceChildren();$('#ai-message').value='';$('#ai-consent').checked=false;$('#ai-feedback').textContent='';controls();}
function bubble(role,content){const row=document.createElement('article'),label=document.createElement('small'),text=document.createElement('p');row.className='ai-message '+role;label.textContent=role==='user'?'You':'NEAR AI';text.textContent=content;row.append(label,text);$('#ai-messages').append(row);row.scrollIntoView({block:'nearest'});}
async function post(path,value,signal){const response=await fetch('/api/ai/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),cache:'no-store',signal});const data=await response.json();if(!response.ok)throw Error(response.status===503?'NEAR AI is not connected yet.':response.status===429?'AI limit reached or busy. Try again later.':'Could not send. AI access may not be enabled for this account.');return data;}
entry.onclick=async()=>{
 reset();dialog.showModal();$('#ai-message').focus();const version=generation;available=false;$('#ai-availability').textContent='Checking connection…';
 try{const state=await readState();if(version!==generation)return;account=state.identity?.profile.id??null;
  const response=await fetch('/api/ai/status',{cache:'no-store',signal:AbortSignal.timeout(5000)}),data=await response.json();if(version!==generation)return;
  available=response.ok&&data.available===true;$('#ai-availability').textContent=!navigator.onLine?'Offline':!available?'Not connected yet':account?'Connected':'Sign in to ask NEAR AI';
 }catch{if(version===generation)$('#ai-availability').textContent=navigator.onLine?'Connection unavailable':'Offline';}finally{if(version===generation)controls();}
};
$('#ai-close').onclick=()=>dialog.close();dialog.addEventListener('close',reset);
$('#ai-clear').onclick=()=>{const savedAccount=account;reset();account=savedAccount;$('#ai-message').focus();controls();};
$('#ai-consent').onchange=controls;
$('#ai-stop').onclick=()=>{generation++;controller?.abort();controller=null;busy=false;$('#ai-feedback').textContent='Stopped. A submitted request may still use allowance.';controls();};
addEventListener('offline',()=>{if(dialog.open){$('#ai-stop').click();$('#ai-availability').textContent='Offline';}});
addEventListener('online',()=>{if(dialog.open){$('#ai-availability').textContent=available?'Connected':'Not connected yet';controls();}});
$('#ai-compose').onsubmit=async event=>{
 event.preventDefault();if($('#ai-send').disabled)return;
 let input;try{input=aiConversation({messages:[...messages,{role:'user',content:$('#ai-message').value}]});}catch(error){$('#ai-feedback').textContent=error.message;return;}
 const version=generation,text=$('#ai-message').value,abort=new AbortController();controller=abort;busy=true;controls();$('#ai-feedback').textContent='Checking reply…';
 const timeout=setTimeout(()=>abort.abort(),55000);
 try{
  const state=await readState();if(state.identity?.profile.id!==account)throw Error('Account changed. Close and reopen NEAR AI.');
  const {nonce}=await post('challenge',{id:account},abort.signal);if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('Invalid AI challenge.');
  const signature=await signValue(state.identity,await aiTerms(location.origin,account,nonce,input));
  if(version!==generation||abort.signal.aborted)return;
  if((await readState()).identity?.profile.id!==account)throw Error('Account changed. Close and reopen NEAR AI.');
  const result=await post('chat',{identity:aiIdentity(state.identity.profile),nonce,input,signature},abort.signal);
  if(version!==generation||!dialog.open)return;
  if((await readState()).identity?.profile.id!==account){dialog.close();return;}
  if(result.verified!==true||result.executable!==false||typeof result.text!=='string'||!result.text.trim()||result.text.length>8000)throw Error('The AI reply could not be verified.');
  messages=[...input.messages,{role:'assistant',content:result.text}];bubble('user',text);bubble('assistant',result.text);$('#ai-message').value='';$('#ai-feedback').textContent='';
 }catch(error){if(version===generation)$('#ai-feedback').textContent=abort.signal.aborted?'Request stopped. No automatic retry.':error.message;}
 finally{clearTimeout(timeout);if(version===generation){busy=false;controller=null;controls();$('#ai-message').focus();}}
};
