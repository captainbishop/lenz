import {drawContact} from './contact-card.js';
import {paintAvatar} from './profile-display.js';
import {readState} from './chat-store.js';

const $=s=>document.querySelector(s);
export const walletIcon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
export function iconButton(button,label,path){button.innerHTML=walletIcon(path);button.setAttribute('aria-label',label);button.title=label;}
const scan='M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z';

// These controls use the existing wallet, contact verification and delivery services.
export function mountWalletActions({addRecipient}){
 for(const [id,label,path] of [['near-send','Send','M6 18 18 6M6 6h12v12'],['near-receive','Receive','M18 6 6 18M6 6v12h12'],['near-fund','Add tUSD','M4 11h4V8h8v3h4v5h-4v-2H4zM12 8V5M8 5h8M18 20c0-1 2-3 2-3s2 2 2 3a2 2 0 0 1-4 0']])iconButton($('#'+id),label,path);
 document.querySelectorAll('.dialog-top button[data-close]').forEach(button=>{
  iconButton(button,button.getAttribute('aria-label')||'Close','m6 6 12 12M18 6 6 18');button.classList.add('wallet-close');
 });
 $('#near-send-title').textContent='Send';
 const form=$('#near-send-form'),select=$('#near-recipient');
 select.hidden=true;select.tabIndex=-1;document.querySelector('label[for="near-recipient"]').hidden=true;
 const chooser=document.createElement('section');chooser.id='wallet-recipient-picker';
 chooser.innerHTML=`<div class="recipient-heading"><span>To</span><div><button id="wallet-paste-recipient" type="button" class="secondary">Lenz ID</button><button id="wallet-scan-recipient" type="button" class="secondary" aria-label="Scan wallet" title="Scan wallet">${walletIcon(scan)}</button></div></div><div id="wallet-recipient-list"></div><p id="wallet-recipient-empty" class="quiet">Scan their Lenz QR or paste their ID.</p>`;
 form.prepend(chooser);
 const selected=document.createElement('button');selected.id='wallet-recipient-selected';selected.type='button';selected.className='secondary';selected.hidden=true;form.prepend(selected);
 const entry=$('#near-send-form .payment-entry');
 const choose=async id=>{select.value=id;select.dispatchEvent(new Event('change'));await paint();$('#near-send-amount').focus();};
 selected.onclick=()=>{select.value='';paint();};
 $('#wallet-paste-recipient').onclick=()=>addRecipient(false);
 $('#wallet-scan-recipient').onclick=()=>addRecipient(true);
 const paint=async()=>{
  const state=await readState(),contact=state.contacts.find(c=>c.id===select.value),list=$('#wallet-recipient-list');list.replaceChildren();
  for(const person of state.contacts){
   const button=document.createElement('button'),avatar=document.createElement('span'),name=document.createElement('span');
   button.type='button';button.className='wallet-person';button.dataset.contactId=person.id;avatar.className='avatar';avatar.setAttribute('aria-hidden','true');paintAvatar(avatar,person);name.textContent=person.name;
   button.append(avatar,name);button.onclick=()=>choose(person.id);list.append(button);
  }
  $('#wallet-recipient-empty').hidden=state.contacts.length>0;chooser.hidden=!!contact;selected.hidden=!contact;entry.hidden=!contact;
  for(const node of form.querySelectorAll(':scope>p,:scope>button[type=submit]'))node.hidden=!contact;
  selected.replaceChildren();if(contact){const avatar=document.createElement('span'),name=document.createElement('span'),label=document.createElement('small');avatar.className='avatar';paintAvatar(avatar,contact);name.textContent=contact.name;label.textContent='To';selected.append(label,avatar,name);selected.insertAdjacentHTML('beforeend',walletIcon('m9 6 6 6-6 6'));}
 };
 select.addEventListener('change',paint);
 new MutationObserver(()=>{if($('#near-send-dialog').open)paint();}).observe($('#near-send-dialog'),{attributes:true,attributeFilter:['open']});
 $('#near-send-form>p.quiet:last-of-type').textContent='Pending until confirmed. Settlement amounts and accounts are public on NEAR testnet. Competing spends cannot both confirm.';

 const receive=$('#near-receive-dialog');$('#near-fund-title').textContent='Add tUSD';$('#near-receive-title').textContent='Receive';
 const receiving=document.createElement('div');receiving.className='wallet-receiving';
 receiving.innerHTML='<p class="receive-asset">Lenz · tUSD</p><canvas id="wallet-receive-qr" role="img" aria-label="Your receiving Lenz QR"></canvas><strong id="wallet-receive-name"></strong><p class="quiet">For offline tUSD payments.</p><div class="receive-tools"><button id="wallet-receive-share" type="button"></button><button id="wallet-receive-copy" type="button" class="secondary"></button></div><p id="wallet-receive-feedback" class="quiet" role="status"></p>';
 receive.querySelector('.dialog-top').after(receiving);
 iconButton($('#wallet-receive-share'),'Share receiving ID','M12 16V3m-4 4 4-4 4 4M5 11v10h14V11');
 iconButton($('#wallet-receive-copy'),'Copy receiving ID','M8 8h12v13H8zM16 8V3H3v13h5');
 $('#wallet-receive-share').onclick=async()=>{try{if(navigator.share)await navigator.share({title:'Lenz',text:$('#my-lenz-id').value});else{await navigator.clipboard.writeText($('#my-lenz-id').value);$('#wallet-receive-feedback').textContent='ID copied.';}}catch(error){$('#wallet-receive-feedback').textContent=error.name==='AbortError'?'':'Could not share. Open My Lenz ID to copy it.';}};
 $('#wallet-receive-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#my-lenz-id').value);$('#wallet-receive-feedback').textContent='ID copied.';}catch{$('#wallet-receive-feedback').textContent='Could not copy. Open My Lenz ID to select it.';}};
 const incoming=document.createElement('details');incoming.className='wallet-incoming';incoming.innerHTML='<summary>Open a received payment</summary>';
 for(const node of [document.querySelector('label[for="near-payment-file"]'),$('#near-payment-file'),$('#near-import')])incoming.append(node);
 incoming.querySelector('label').textContent='Choose payment';incoming.querySelector('#near-import').textContent='Open payment';receive.append(incoming);
 $('#near-share-card').textContent='My Lenz ID';
 new MutationObserver(async()=>{if(!receive.open)return;const state=await readState();if(!state.identity)return;$('#wallet-receive-feedback').textContent='';$('#wallet-receive-name').textContent=state.identity.profile.name;await drawContact($('#wallet-receive-qr'),state.identity.profile);}).observe(receive,{attributes:true,attributeFilter:['open']});
 return {paint};
}
