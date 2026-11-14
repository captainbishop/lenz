import {assetIcon} from './asset-icon.js';
import {walletTransferAssets} from './wallet-holdings.js';
import {prepareTransfer,amount,units,transferAssets,reviewToken,check} from './evm-transfer.js';
import {createTransferService} from './evm-transfer-service.js';
import {readTransfers,transferOpen} from './evm-transfer-store.js';
import {iconButton,walletIcon} from './wallet-actions.js';
import {paintAvatar} from './profile-display.js';
import {walletAmount} from './wallet-visibility.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {paymentRecipient,checkRecipientTransfer} from './payment-recipient.js';
import {readState} from './chat-store.js';
import {isRecoveredContact,isRecoveredChat} from './chat-access.js';
import {decodeLenzId,encodeLenzId} from './contact-card.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={awaiting_wallet:'Waiting for your wallet',unknown:'Wallet response lost · check before trying again',submitted:'Sent · waiting for confirmation',pending:'Waiting for confirmation',included:'Confirming transfer',confirmed:'Transfer confirmed',failed:'Transfer failed',declined:'Cancelled in wallet',not_sent:'Not sent'};
export function mountEvmTransfers(session,{connect,sendToContact,sendShielded}={}){
 const $=id=>document.getElementById(id),service=createTransferService(),button=el('button','Send');button.id='evm-send';button.type='button';$('evm-receive').before(button);
 const history=el('section');history.id='evm-transfers';history.hidden=true;history.innerHTML='<h3>Transfers</h3><div id="evm-transfer-list"></div><p id="evm-history-status" class="quiet" role="status"></p>';$('connected-wallet').append(history);
 const dialog=el('dialog');dialog.id='evm-send-dialog';dialog.setAttribute('aria-labelledby','evm-send-title');
 dialog.innerHTML=`<div class="dialog-top"><span class="send-direction" aria-hidden="true">${walletIcon('M5 19 19 5M5 5h14v14')}</span><h2 id="evm-send-title">Send</h2><button id="evm-send-close" type="button" class="secondary wallet-close"></button></div>
 <form id="evm-send-form">
  <div class="send-recipient"><label for="evm-send-recipient">To</label><div class="send-address"><input id="evm-send-recipient" required spellcheck="false" autocomplete="off" maxlength="6500" placeholder="Wallet address or Lenz ID"><button id="evm-send-paste" type="button" class="secondary"></button></div><div id="evm-send-people"></div></div>
  <section id="evm-send-lenz" hidden><p id="evm-send-lenz-name"></p><p class="quiet">Test dollars (tUSD) · Payments confirmed publicly</p><button id="evm-send-lenz-continue" type="button">Continue</button></section>
  <div id="evm-recipient-network-field"><label for="evm-recipient-network">Receiving network</label><select id="evm-recipient-network"><option value="">Choose network</option></select><p id="evm-recipient-detail" class="quiet" role="status"></p></div>
  <section class="send-value"><label for="evm-send-amount">Amount</label><div class="evm-transfer-amount"><input id="evm-send-amount" required inputmode="decimal" autocomplete="off" placeholder="0" maxlength="80"></div>
   <div class="send-asset-anchor"><button id="evm-send-asset-toggle" type="button" class="secondary" aria-label="Choose asset" aria-expanded="false" aria-controls="evm-send-asset-menu">${walletIcon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v10M9 10h6M9 14h6')}<span id="evm-send-symbol">ETH</span>${walletIcon('m8 10 4 4 4-4')}</button><span id="evm-send-network" class="quiet"></span>
    <div id="evm-send-asset-menu" hidden><label for="evm-send-asset-search" class="send-sr-only">Find asset</label><input id="evm-send-asset-search" type="search" placeholder="Find asset" autocomplete="off"><div id="evm-send-assets" aria-label="Assets"></div><p id="evm-send-asset-empty" class="quiet" hidden>No supported asset found.</p></div>
   </div>
  </section>
  <label class="check send-public"><input id="evm-send-consent" type="checkbox"><span>Public transfer. Your wallet and network provider can see the details.</span></label><button id="evm-send-review" type="submit" disabled>Choose funds</button>
 </form><dl id="evm-send-summary" hidden></dl><p id="evm-send-fee-note" class="quiet" hidden></p><button id="evm-send-approve" type="button" hidden>Approve in wallet</button><p id="evm-send-status" class="wallet-feedback" role="status"></p>`;
 document.body.append(dialog);iconButton($('evm-send-close'),'Close','m6 6 12 12M18 6 6 18');
 iconButton($('evm-send-paste'),'Paste recipient','M9 5H6v16h13V5h-3M9 3h7v5H9z');
 const destination=$('evm-recipient-network-field'),people=$('evm-send-people'),lenz=$('evm-send-lenz'),choices=$('evm-send-assets'),assetMenu=$('evm-send-asset-menu'),assetToggle=$('evm-send-asset-toggle');
 const shieldedDisclosure=el('p','Local native test wallet · Browser backup cannot restore these funds.');shieldedDisclosure.className='quiet';shieldedDisclosure.id='evm-send-shielded-disclosure';shieldedDisclosure.hidden=true;$('evm-send-consent').closest('label').before(shieldedDisclosure);
 for(const [id,network]of Object.entries(WALLET_NETWORKS)){const option=el('option',network.name);option.value=id;$('evm-recipient-network').append(option);}
 function closeAssets(){assetMenu.hidden=true;assetToggle.setAttribute('aria-expanded','false');}
 assetToggle.onclick=()=>{if(!assetMenu.hidden){closeAssets();return;}$('evm-send-asset-search').value='';filterAssets();assetMenu.hidden=false;assetToggle.setAttribute('aria-expanded','true');$('evm-send-asset-search').focus();};
 function filterAssets(){const query=$('evm-send-asset-search').value.trim().toLowerCase();for(const node of choices.children)node.hidden=!node.textContent.toLowerCase().includes(query)&&!node.dataset.asset.includes(query);$('evm-send-asset-empty').hidden=[...choices.children].some(n=>!n.hidden);}
 $('evm-send-asset-search').oninput=filterAssets;
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!assetMenu.hidden){event.preventDefault();event.stopPropagation();closeAssets();assetToggle.focus();}});
 dialog.addEventListener('click',event=>{if(!event.target.closest('.send-asset-anchor'))closeAssets();});
 $('evm-send-paste').onclick=async()=>{const ticket=version;try{const text=await navigator.clipboard.readText();if(ticket!==version||!dialog.open)return;check(text.length<=6500,'This payment link is too long.');$('evm-send-recipient').value=text;$('evm-send-recipient').dispatchEvent(new Event('input'));$('evm-send-recipient').focus();}catch{if(ticket===version&&dialog.open)$('evm-send-status').textContent='Paste into the recipient field using your keyboard.';}};
 const edit=el('button');edit.id='evm-send-edit';edit.type='button';edit.className='secondary wallet-close';edit.hidden=true;iconButton(edit,'Edit transfer','m4 16 12-12 4 4-12 12H4zM13 7l4 4');$('evm-send-close').before(edit);
 let available=[],assetGeneration=0,assetsLoading=false,assetsFailed=false;
 let incomingLink=null;
 const incoming=el('section');incoming.id='evm-incoming-link';incoming.hidden=true;incoming.innerHTML='<p class="quiet">Receiving link ready.</p><button id="evm-open-link" type="button" class="secondary">Review receiving link</button>';$('connected-wallet').prepend(incoming);
 if(location.hash.startsWith('#receive=')){
  incomingLink=location.hash.slice(9);incoming.hidden=false;
  historyReplace();
 }
 function historyReplace(){window.history.replaceState(window.history.state,'',location.pathname+location.search);}
 $('evm-open-link').onclick=()=>{if(!incomingLink)return;open();$('evm-send-recipient').value=incomingLink;$('evm-send-recipient').dispatchEvent(new Event('input'));};
 let identity=null,asset='native',review=null,lease=null,resolved=null,version=0,recipientVersion=0,busy=false,renderVersion=0,awaitingConnection=false,lenzRecipient=null;
 const chosenNetwork=()=>identity?.chainId||$('evm-recipient-network').value||'0x1';
 const shieldedRecipient=()=>$('evm-send-recipient').value.trim().startsWith('utest1');
 function reviewAvailability(){
  const shielded=shieldedRecipient();
  $('evm-send-review').disabled=busy||!navigator.onLine||(shielded?typeof sendShielded!=='function':assetsLoading||assetsFailed||!$('evm-send-consent').checked||!!identity&&(button.disabled||!Object.hasOwn(WALLET_NETWORKS,identity.chainId)));
  const next=$('evm-send-review');next.replaceChildren(el('span',shielded?'Review payment':identity?'Review transfer':'Choose funds'));next.insertAdjacentHTML('beforeend',walletIcon('M5 12h14m-5-5 5 5-5 5'));
 }
 function paintRecipientRoute(){
  const shielded=shieldedRecipient();destination.hidden=shielded;assetToggle.disabled=shielded||assetsLoading;$('evm-send-consent').closest('label').hidden=shielded;shieldedDisclosure.hidden=!shielded;
  if(shielded){closeAssets();$('evm-send-symbol').textContent='test ZEC';$('evm-send-network').textContent='Zcash testnet';assetToggle.querySelector('.asset-icon,svg:first-child')?.replaceWith(assetIcon({symbol:'ZEC',trusted:true}));if(typeof sendShielded!=='function')$('evm-send-status').textContent='Shielded payments are unavailable here.';}
  else paintAssets();reviewAvailability();
 }
 function invalidate(){version++;closeAssets();review=null;lease=null;resolved=null;$('evm-send-summary').hidden=true;$('evm-send-fee-note').hidden=true;$('evm-send-approve').hidden=true;edit.hidden=true;$('evm-send-form').hidden=false;reviewAvailability();}
 function paintAssets(symbol){
  choices.replaceChildren();const network=chosenNetwork();
  if(!Object.hasOwn(WALLET_NETWORKS,network))return;
  const tokens=available.length&&identity?.chainId===network?available:transferAssets(network),selected=tokens.find(t=>symbol?t.symbol===symbol:t.id===asset)||tokens[0];asset=selected.id;
  $('evm-send-symbol').textContent=selected.symbol;assetToggle.querySelector('.asset-icon,svg:first-child')?.replaceWith(assetIcon({symbol:selected.symbol,contract:selected.id==='native'?null:selected.id,network:WALLET_NETWORKS[network].key,image:selected.image,trusted:selected.id==='native'}));$('evm-send-network').textContent=identity?identity.network.name:'';
  for(const token of tokens){const choice=el('button');choice.type='button';choice.className='secondary';choice.setAttribute('aria-label',token.symbol);choice.setAttribute('aria-pressed',String(token.id===asset));choice.dataset.asset=token.id;const info=el('span');info.append(el('strong',token.symbol),el('small',token.id==='native'?'Native asset':token.id.slice(0,8)+'…'+token.id.slice(-6)));choice.append(assetIcon({symbol:token.symbol,contract:token.id==='native'?null:token.id,network:WALLET_NETWORKS[network].key,image:token.image,trusted:token.id==='native'}),info);choice.insertAdjacentHTML('beforeend',walletIcon('m5 12 4 4L19 6'));choice.onclick=()=>{asset=token.id;invalidate();paintAssets();assetToggle.focus();};choices.append(choice);}
 }
 function showPaymentFields(show){
  closeAssets();for(const node of [destination,dialog.querySelector('.send-value'),$('evm-send-consent').closest('label'),$('evm-send-review')])node.hidden=!show;shieldedDisclosure.hidden=true;
  if(show)reviewAvailability();
 }
 $('evm-send-lenz-continue').onclick=async()=>{
  if(!lenzRecipient||busy)return;const {profile,text}=lenzRecipient,ticket=version;busy=true;$('evm-send-lenz-continue').disabled=true;
  try{check(sendToContact,'Lenz payments are unavailable here.');await sendToContact(profile,text,()=>{check(dialog.open&&ticket===version,'Recipient changed. Open Send again.');close();},()=>{open();$('evm-send-recipient').value=text;$('evm-send-recipient').dispatchEvent(new Event('input'));});}
  catch(error){if(ticket===version&&dialog.open)$('evm-send-status').textContent=error.message;}
  finally{busy=false;$('evm-send-lenz-continue').disabled=false;reviewAvailability();}
 };
 edit.onclick=()=>{invalidate();$('evm-send-status').textContent='';$('evm-send-amount').focus();};
 const close=()=>{recipientVersion++;awaitingConnection=false;invalidate();dialog.close();};$('evm-send-close').onclick=close;dialog.addEventListener('cancel',()=>{recipientVersion++;awaitingConnection=false;invalidate();});dialog.addEventListener('close',()=>{if(!dialog.open){recipientVersion++;awaitingConnection=false;invalidate();}});
 for(const id of ['evm-send-recipient','evm-send-amount','evm-send-consent','evm-recipient-network'])$(id).addEventListener('input',()=>{invalidate();$('evm-send-status').textContent=identity&&button.disabled?$('evm-history-status').textContent:'';});
 $('evm-send-recipient').addEventListener('input',async()=>{
  const ticket=++recipientVersion,sourceIdentity=identity;lenzRecipient=null;lenz.hidden=true;showPaymentFields(true);people.hidden=!!$('evm-send-recipient').value;$('evm-recipient-network').value='';$('evm-recipient-network').disabled=false;$('evm-recipient-detail').textContent='';
  $('evm-recipient-network').dispatchEvent(new Event('change'));
  const text=$('evm-send-recipient').value.trim();paintRecipientRoute();if(!/^(lenz:|https?:|ethereum:|lenz1_)/.test(text))return;
  try{
   if(text.startsWith('lenz1_')){
    const profile=await decodeLenzId(text),state=await readState();if(ticket!==recipientVersion||!dialog.open)return;
    check(state.identity&&!isRecoveredChat(state.identity),'Open your original Lenz account to send offline payments.');check(profile.id!==state.identity.profile.id,'This is your own Lenz ID.');check(!isRecoveredContact(state,profile.id),'This contact changed accounts. Ask for their updated ID.');
    lenzRecipient={profile,text};$('evm-send-lenz-name').textContent=state.contacts.find(c=>c.id===profile.id)?.name||'New Lenz recipient';showPaymentFields(false);lenz.hidden=false;return;
   }
   const recipient=await paymentRecipient(text);if(ticket!==recipientVersion||identity!==sourceIdentity||!dialog.open)return;
   $('evm-recipient-network').value=recipient.chainId;$('evm-recipient-network').disabled=true;$('evm-recipient-network').dispatchEvent(new Event('change'));
   $('evm-recipient-detail').textContent=(recipient.profile?recipient.profile.name+' · Payment link':'Wallet payment link')+' · '+transferAssets(recipient.chainId).find(t=>t.id===recipient.asset).symbol;
   if(!identity||recipient.chainId===identity.chainId){asset=recipient.asset;paintAssets();}
  }catch(error){if(ticket===recipientVersion&&identity===sourceIdentity&&dialog.open)$('evm-recipient-detail').textContent=error.message;}
 });
 $('evm-recipient-network').addEventListener('input',()=>{if(!identity)paintAssets($('evm-send-symbol').textContent);});
 async function loadAssets(selectedAsset){
  const current=identity,generation=++assetGeneration;available=[];assetsLoading=false;assetsFailed=false;
  if(!current||!Object.hasOwn(WALLET_NETWORKS,current.chainId)){reviewAvailability();return;}
  assetsLoading=true;if(selectedAsset)asset=selectedAsset;assetToggle.disabled=true;reviewAvailability();
  try{const tokens=await walletTransferAssets(current);if(generation!==assetGeneration||identity!==current||!dialog.open)return;available=tokens;check(tokens.some(t=>t.id===asset),'Imported token unavailable. Open Send again.');paintAssets();}
  catch(error){if(generation===assetGeneration&&dialog.open){assetsFailed=true;$('evm-send-status').textContent='Imported assets unavailable. '+error.message;return;}}
  finally{if(generation===assetGeneration){assetsLoading=false;paintRecipientRoute();}}
 }
 function open(selectedAsset='native'){
  recipientVersion++;available=[];identity=session.snapshot;asset=selectedAsset;lenzRecipient=null;lenz.hidden=true;awaitingConnection=false;$('evm-send-form').reset();$('evm-recipient-network').disabled=false;$('evm-recipient-detail').textContent='';invalidate();showPaymentFields(true);paintAssets();people.replaceChildren();people.hidden=false;$('evm-send-status').textContent=identity&&!Object.hasOwn(WALLET_NETWORKS,identity.chainId)?'Send is unavailable on this custom network.':identity&&button.disabled?$('evm-history-status').textContent:'';
  dialog.showModal();$('evm-send-recipient').focus();loadAssets(selectedAsset);
  const ticket=version;readState().then(async state=>{if(ticket!==version||!dialog.open||!state.identity||isRecoveredChat(state.identity))return;
   for(const contact of state.contacts){if(isRecoveredContact(state,contact.id))continue;const pick=el('button');pick.type='button';pick.className='secondary';const avatar=el('span');avatar.className='send-person-avatar';paintAvatar(avatar,contact);pick.append(avatar,el('span',contact.name));pick.onclick=async()=>{const current=version;try{const text=await encodeLenzId(contact);if(!dialog.open||current!==version)return;$('evm-send-recipient').value=text;$('evm-send-recipient').dispatchEvent(new Event('input'));}catch(error){if(dialog.open&&current===version)$('evm-send-status').textContent=error.message;}};people.append(pick);}
  }).catch(()=>{});
 }
 button.onclick=()=>open();
 $('evm-send-form').onsubmit=async event=>{
  event.preventDefault();if(busy||!shieldedRecipient()&&(assetsLoading||assetsFailed))return;invalidate();const ticket=version;busy=true;$('evm-send-review').disabled=true;$('evm-send-status').textContent='Checking balance and fees…';
  try{
   if(shieldedRecipient()){
    check(typeof sendShielded==='function','Shielded payments are unavailable here.');
    await sendShielded({recipient:$('evm-send-recipient').value.trim(),amount:$('evm-send-amount').value.trim(),isCurrent:()=>dialog.open&&ticket===version,proceed:()=>{check(dialog.open&&ticket===version,'Payment selection changed. Open Send again.');close();},restore:()=>{if(!dialog.open){dialog.showModal();paintRecipientRoute();$('evm-send-recipient').focus();}}});return;
   }
   check($('evm-send-consent').checked,'Allow this public transfer first.');
   const recipient=await paymentRecipient($('evm-send-recipient').value.trim(),{network:$('evm-recipient-network').value});
   const token=(available.length&&identity?available:transferAssets(chosenNetwork())).find(t=>t.id===asset);check(token,'Choose a supported sending asset.');units($('evm-send-amount').value.trim(),token.decimals);
   if(ticket!==version||!dialog.open)return;
   if(!identity){awaitingConnection=true;connect?.();return;}
   check(!button.disabled,'Check the pending transfer before sending another.');
   const current=session.capture();check(current.identity===identity,'Wallet changed. Open Send again.');
   checkRecipientTransfer(recipient,{chainId:identity.chainId,asset,recipient:recipient.address});
   const state=recipient.profile?await readState():null;
   check(!state||!isRecoveredContact(state,recipient.profile.id),'This contact changed accounts. Ask for a new receiving link.');
   if(ticket!==version||!dialog.open)return;
   const terms=await prepareTransfer(current,{asset,recipient:recipient.address,amount:$('evm-send-amount').value.trim(),publicConsent:true,...(!transferAssets(identity.chainId).some(t=>t.id===asset)?{token:{id:token.id,symbol:token.symbol,decimals:token.decimals}}:{})});
   if(ticket!==version||!dialog.open)return;current.assertCurrent();checkRecipientTransfer(recipient,terms.terms);review=terms;lease=current;resolved=recipient;
   const summary=$('evm-send-summary');summary.replaceChildren();
   const known=state?.contacts.find(c=>c.id===recipient.profile?.id);
   if(ticket!==version||!dialog.open)return;checkRecipientTransfer(recipient,terms.terms);
   const rows=[['Send',amount(terms.terms.units,token.decimals)+' '+token.symbol],...(recipient.profile?[['Recipient',(known?.name??recipient.profile.name)+(known?' · Saved contact':' · New recipient')]]:[]),['To',terms.terms.recipient],...(terms.token?[['Token contract',terms.token.id]]:[]),['Network',WALLET_NETWORKS[recipient.chainId].name],['Network fee estimate',amount('0x'+(BigInt(terms.transaction.gas)*BigInt(terms.transaction.gasPrice)).toString(16))+' ETH']];
   for(const [label,value]of rows){const row=el('div');if(label==='Send')row.className='evm-review-amount';row.append(el('dt',label),el('dd',value));if(label==='Send'){row.querySelector('dd').classList.add('asset-label');row.querySelector('dd').prepend(assetIcon({symbol:token.symbol,contract:token.id==='native'?null:token.id,network:WALLET_NETWORKS[identity.chainId].key,image:token.image,trusted:token.id==='native'}));}summary.append(row);}
   if(recipient.profile){const details=el('details');details.append(el('summary','Recipient identity'),el('p',recipient.profile.id));summary.append(details);if(!known)summary.append(el('p','Confirm who shared this link. A signed name alone does not identify a person.'));}
   summary.hidden=false;$('evm-send-form').hidden=true;edit.hidden=false;$('evm-send-fee-note').textContent=identity.chainId==='0x1'?'Unused gas is not charged. Check the final terms in your wallet.':'Extra network fees may apply. Check the total in your wallet.';$('evm-send-fee-note').hidden=false;$('evm-send-approve').hidden=false;$('evm-send-approve').disabled=false;$('evm-send-status').textContent='';
  }catch(error){if(ticket===version)$('evm-send-status').textContent=error.message;}
  finally{busy=false;reviewAvailability();}
 };
 $('evm-send-approve').onclick=async()=>{
  if(busy||!review||!lease||!resolved)return;const ticket=version,current=lease,terms=review,recipient=resolved;
  const guard=()=>{current.assertCurrent();check(dialog.open&&ticket===version,'Transfer review closed or changed.');checkRecipientTransfer(recipient,terms.terms);};
  const guarded={...current,assertCurrent:guard,sendTransaction:tx=>{guard();return current.sendTransaction(tx);}};
  busy=true;$('evm-send-approve').disabled=true;$('evm-send-review').disabled=true;$('evm-send-status').textContent='Checking terms before opening your wallet…';
  try{if(recipient.profile)check(!isRecoveredContact(await readState(),recipient.profile.id),'This contact changed accounts. Ask for a new receiving link.');guard();const result=await service.send(guarded,terms);if(ticket===version&&dialog.open)$('evm-send-status').textContent=labels[result.state]+(result.error?'. '+result.error:'');}
  catch(error){if(ticket===version&&dialog.open)$('evm-send-status').textContent=error.message;}
  finally{busy=false;if(ticket===version){invalidate();if(dialog.open){$('evm-send-form').hidden=true;edit.hidden=false;}}else reviewAvailability();await render();}
 };
 async function render(){
  const ticket=++renderVersion,snapshot=session.snapshot;history.hidden=!snapshot;$('evm-transfer-list').replaceChildren();button.disabled=true;
  const supported=!!snapshot&&Object.hasOwn(WALLET_NETWORKS,snapshot.chainId);button.hidden=!!snapshot&&!supported;
  if(!snapshot)return;
  if(!supported){$('evm-history-status').textContent='Send and DeFi are unavailable on custom networks.';return;}
  try{
   const rows=(await readTransfers()).filter(r=>r.review.terms.from===snapshot.address&&r.review.terms.chainId===snapshot.chainId).reverse();
   if(ticket!==renderVersion||session.snapshot!==snapshot)return;
   button.disabled=rows.some(transferOpen);$('evm-history-status').textContent=button.disabled?'Check the pending transfer before sending another.':rows.length?'':'No transfers from Lenz yet.';
   for(const row of rows){
    const item=el('article');item.className='evm-transfer-row';const details=el('div'),tools=el('div'),token=reviewToken(row.review);
    const value=el('span');value.className='asset-label';value.append(assetIcon({symbol:token.symbol,contract:token.id==='native'?null:token.id,network:snapshot.network.key,trusted:token.id==='native'}),walletAmount(el('strong'),amount(row.review.terms.units,token.decimals)+' '+token.symbol));
    details.append(value,el('span',labels[row.state]),el('small','To '+row.review.terms.recipient),el('small',new Date(row.createdAt).toLocaleString()));
    if(row.hash){const hash=el('small','Transaction: '+row.hash);hash.className='transaction-reference';details.append(hash);}
    if(row.observation?.executionFee)details.append(el('small','Network fee '+amount(row.observation.executionFee)+' ETH'));
    if(row.error)details.append(el('small',row.error));
    if(transferOpen(row)){
     let input=null;if(!row.hash){const label=el('label','Transaction ID from your wallet');input=el('input');input.id='evm-recover-'+row.id;label.htmlFor=input.id;input.placeholder='0x…';input.autocomplete='off';input.spellcheck=false;tools.append(label,input);}
     const checkButton=el('button','Check status'),feedback=el('p');feedback.className='quiet';feedback.setAttribute('role','status');checkButton.type='button';checkButton.className='secondary';
     checkButton.onclick=async()=>{checkButton.disabled=true;feedback.textContent='Checking…';try{await service.reconcile(session.capture(),row.id,input?.value.trim());await render();}catch(error){feedback.textContent=error.message;}finally{checkButton.disabled=false;}};tools.append(checkButton,feedback);
    }
    item.append(details,tools);$('evm-transfer-list').append(item);
   }
   }catch(error){if(ticket===renderVersion){button.disabled=true;$('evm-history-status').textContent='Transfer history unavailable. '+error.message;}}
   if(dialog.open)reviewAvailability();
 }
 addEventListener('lenz-evm-session',()=>{
  if(awaitingConnection&&dialog.open){
   if(session.snapshot){const symbol=$('evm-send-symbol').textContent;identity=session.snapshot;awaitingConnection=false;invalidate();paintAssets(symbol);loadAssets();$('evm-send-status').textContent='';}
  }else if(identity!==session.snapshot&&dialog.open)close();
  render();
 });
 $('evm-connect-dialog').addEventListener('close',()=>{if(!session.snapshot){awaitingConnection=false;if(dialog.open)$('evm-send-recipient').focus();}});
 addEventListener('lenz-transfers-changed',render);
 addEventListener('lenz-holdings-changed',()=>{if(dialog.open){invalidate();loadAssets();}});
 render();
 return {open};
}
