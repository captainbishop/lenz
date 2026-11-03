import { readState } from './chat-store.js';
import { randomId, assert } from './peer-crypto.js';
import { paintAvatar } from './profile-display.js';
import { displayUnits, units } from './near-protocol.js';
import { PUBLIC_TESTNET_DISCLOSURE } from './defi-request.js';
import { approveDefiSwap, defiHandoff, recordDefiStorageReceipt } from './defi-wallet.js';
import { sendDefiRequest } from './defi-delivery.js';

const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function download(envelope){
  const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
  const link=el('a');link.href=url;link.download=`lenz-request-${envelope.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function mountDefiApproval({config,run,notice,wrapped}) {
  let contacts=[],draft=null,approving=false;
  const controls=el('div');controls.className='defi-choice';
  controls.innerHTML='<label for="defi-method">Who will run this swap?</label><select id="defi-method"><option value="self">I will, when online</option><option value="contact">A contact with a Lenz executor</option></select><div id="defi-contact-choice" hidden><label for="defi-contact">Choose a contact</label><select id="defi-contact"><option value="">Choose a person</option></select><p class="quiet">Arrange this with someone who runs a Lenz executor. Adding a contact does not check that they can run swaps.</p></div>';
  $('#rhea-form button[type="submit"]').before(controls);
  const panel=el('dialog');panel.id='defi-approval';panel.setAttribute('aria-labelledby','defi-approval-title');
  panel.innerHTML='<div class="dialog-top"><h2 id="defi-approval-title">Approve this swap</h2><button id="defi-back" type="button" class="secondary">Back</button></div><div class="defi-person"><span class="avatar" aria-hidden="true"></span><strong id="defi-person-name"></strong></div><dl id="defi-terms"></dl><p>No extra executor fee is authorized. Rhea pool fees affect the rate; the minimum above still applies. The executor pays the network fee.</p><p>This person can read your swap, amounts, receiving wallet and included payment history. Execution is public on NEAR testnet. Carriers see routing IDs, times and file sizes. This route does not provide private settlement.</p><p>The amount stays set aside until the swap is resolved, even after its time limit. Approval cannot be recalled once shared.</p><label class="defi-consent" for="defi-consent"><input id="defi-consent" type="checkbox">I verified this person’s contact card and agree to these terms and disclosures.</label><button id="defi-approve" type="button" disabled>Approve and save</button><p class="wallet-feedback error" role="status"></p>';
  document.body.append(panel);
  const method=$('#defi-method'),contact=$('#defi-contact'),consent=$('#defi-consent'),approve=$('#defi-approve');
  method.onchange=()=>{const asked=method.value==='contact';$('#defi-contact-choice').hidden=!asked;contact.required=asked;$('#rhea-form button[type="submit"]').textContent=asked?'Review request':'Save swap';};
  consent.onchange=()=>{approve.disabled=approving||!consent.checked;};
  const back=()=>{if(approving)return;panel.close();draft=null;$('#rhea-dialog').showModal();};
  $('#defi-back').onclick=back;panel.addEventListener('cancel',event=>{event.preventDefault();back();});
  approve.onclick=()=>{
    if(approving||!draft||!consent.checked)return;
    run(async()=>{
      approving=true;approve.disabled=true;$('#defi-back').disabled=true;consent.disabled=true;approve.textContent='Saving approval…';
      try{
        const current=await readState();
        assert(current.contacts.some(p=>p.id===draft.executor.id),'This contact was removed. Go back and choose again');
        await approveDefiSwap(draft.config,draft.executor,draft.swap,draft.consent);
        draft=null;panel.close();notice('Request saved. Share its encrypted file or send it through carriers. Your money is set aside.');
      }finally{approving=false;approve.disabled=!consent.checked;$('#defi-back').disabled=false;consent.disabled=false;approve.textContent='Approve and save';}
    });
  };
  return {
    async open(){
      contacts=(await readState()).contacts;contact.replaceChildren(new Option('Choose a person',''));
      for(const person of contacts)contact.append(new Option(person.name,person.id));
      contact.value='';method.value='self';method.onchange();
    },
    review(swap){
      if(method.value!=='contact')return false;
      const executor=contacts.find(p=>p.id===contact.value);assert(executor,'Choose a verified contact first');
      draft={config:structuredClone(config()),executor:structuredClone(executor),swap:structuredClone(swap),
        consent:{approvalId:randomId(),disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:swap.deadlineMs}};
      const list=$('#defi-terms');list.replaceChildren();
      for(const [name,value]of [['Amount',displayUnits(units(swap.text))+' tUSD'],['Receive at least',wrapped(swap.minOutput)+' wrapped test NEAR'],['Receiving wallet / refunds',swap.receiver],['Start before',new Date(swap.deadlineMs).toLocaleString()],['Network','NEAR testnet · Rhea']])list.append(el('dt',name),el('dd',value));
      paintAvatar(panel.querySelector('.avatar'),executor);$('#defi-person-name').textContent=executor.name;
      consent.checked=false;approve.disabled=true;panel.querySelector('.wallet-feedback').textContent='';
      $('#rhea-dialog').close();panel.showModal();return true;
    },
    render(row,order){
      const a=order.defi,expired=Date.now()>=a.request.expiresAt;
      const person=el('span');person.className='defi-person';const avatar=el('span');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');paintAvatar(avatar,a.executor);person.append(avatar,el('span','For '+a.executor.name));row.append(person);
      row.querySelector('.near-state').textContent=a.storageReceipt?'Executor acknowledged · execution unverified':expired?'Approval window ended · money held':a.storedBy?.length?'Carrier stored · executor unconfirmed':'Approved · ready to share';
      row.append(el('small','Delivery does not confirm execution. This money remains set aside. Results and refunds need separate verification.'));
      const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='secondary';b.onclick=()=>run(fn);row.append(b);return b;};
      const share=button('Save encrypted request',async()=>download(await defiHandoff(config(),a.request.id,{envelope:true})));share.disabled=expired;
      const send=button('Send through carriers',async()=>{
        const response=await fetch('/carrier-config.json');assert(response.ok,'Carrier configuration unavailable');
        const result=await sendDefiRequest(config(),a.request.id,await response.json());
        notice(`Stored by ${result.carriers} carrier${result.carriers===1?'':'s'}. Execution is still unverified.`);
      });send.disabled=expired||!navigator.onLine;send.dataset.defiSend='';send.dataset.defiExpiry=String(a.request.expiresAt);
      const receipt=el('input');receipt.type='file';receipt.accept='.json,application/json';receipt.hidden=true;row.append(receipt);
      button('Open executor receipt',()=>{}).onclick=()=>{receipt.value='';receipt.click();};
      receipt.onchange=()=>run(async()=>{
        const file=receipt.files[0];if(!file)return;assert(file.size<=204800,'This receipt file is too large');
        await recordDefiStorageReceipt(config(),a.request.id,JSON.parse(await file.text()));
        notice('Executor receipt saved. It confirms storage only; execution is still unverified.');
      });
    },
  };
}
