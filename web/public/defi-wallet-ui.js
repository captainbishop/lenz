import { readState } from './chat-store.js';
import { randomId, assert } from './peer-crypto.js';
import { paintAvatar } from './profile-display.js';
import { displayUnits, units } from './near-protocol.js';
import { PUBLIC_TESTNET_DISCLOSURE } from './defi-request.js';
import { approveDefiSwap, defiHandoff, recordDefiReply, checkDefiSwap } from './defi-wallet.js';
import { sendDefiRequest } from './defi-delivery.js';
import {courierSummary} from './nearby-courier.js';
import {mountDefiRefund} from './defi-refund-ui.js';

const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function download(envelope){
  const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
  const link=el('a');link.href=url;link.download=`lenz-request-${envelope.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function mountDefiApproval({config,run,notice,wrapped}) {
  const refund=mountDefiRefund({config,run,notice});
  let contacts=[],draft=null,approving=false;
  const controls=el('div');controls.className='defi-choice';
  controls.innerHTML='<label for="defi-method">Who will make the swap?</label><select id="defi-method"><option value="self">Me, when online</option><option value="contact">Lenz contact</option></select><div id="defi-contact-choice" hidden><label for="defi-contact">Contact</label><select id="defi-contact"><option value="">Choose a person</option></select><p class="quiet">Check that this person has set up Lenz to make swaps for you.</p></div>';
  $('#rhea-form button[type="submit"]').before(controls);
  const panel=el('dialog');panel.id='defi-approval';panel.setAttribute('aria-labelledby','defi-approval-title');
  panel.innerHTML='<div class="dialog-top"><h2 id="defi-approval-title">Approve this swap</h2><button id="defi-back" type="button" class="secondary">Back</button></div><div class="defi-person"><span class="avatar" aria-hidden="true"></span><strong id="defi-person-name"></strong></div><dl id="defi-terms"></dl><p>You agree to no extra fee for this person. Trading fees are included in the rate; your minimum still applies. This person pays the network fee.</p><p>This person can read your swap, amounts, receiving wallet and included payment history. The swap is public on the NEAR test network. People passing it along can see who it is from and for, delivery times and file sizes. The payment itself is not private.</p><p>The amount stays set aside until the swap is resolved, even after its time limit. Approval cannot be recalled once shared.</p><label class="defi-consent" for="defi-consent"><input id="defi-consent" type="checkbox">I checked this person’s contact card and agree to the terms above.</label><button id="defi-approve" type="button" disabled>Approve and save</button><p class="wallet-feedback error" role="status"></p>';
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
        draft=null;panel.close();notice('Request saved. Send it with someone nearby or share the request file. Your money is set aside.');
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
    async deliveries(){try{return (await courierSummary({defiConfig:config()})).outgoing;}catch{return []; }},
    render(row,order,deliveries=[]){
      const a=order.defi,expired=Date.now()>=a.request.expiresAt,checked=a.checkedOutcome;
      const resolved=checked?.state==='observed',blocked=resolved||checked?.state==='conflicted';
      const courier=deliveries.find(job=>job.messageId===a.packet.id),courierStatus=courier?.status==='with-courier'?'With nearby contact · awaiting receipt':courier?.status==='waiting'?'Waiting for nearby contact':courier?.status==='unavailable'?'Nearby delivery unavailable':null;
      const person=el('span');person.className='defi-person';const avatar=el('span');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');paintAvatar(avatar,a.executor);person.append(avatar,el('span','For '+a.executor.name));row.append(person);
      const outcome=checked?.state==='observed'?(checked.order.stage==='complete'?'Swap complete':order.returnReceipt?'Refund returned to Lenz':'Refund in receiving wallet')
        :checked?.state==='conflicted'?'Conflicting payment · needs review':checked?.state==='needs_review'?'Needs review'
        :checked?.state==='pending'?'Last check · swap in progress':checked?.state==='ready'?'Last check · awaiting execution':null;
      const awaitingCheck=a.executorUpdate && a.checkedUpdateId!==a.executorUpdate.id && !blocked;
      row.querySelector('.near-state').textContent=awaitingCheck?'Update received · awaiting verification':outcome??(a.storageReceipt?'Received · completion not confirmed':expired?'Time limit ended · money set aside':courierStatus??(a.storedBy?.length?'Sent · awaiting receipt':'Approved · ready to share'));
      if(!order.returnReceipt)row.append(el('small',resolved?'Confirmed in your receiving wallet. This does not add money to your Lenz balance.':'Your money stays set aside until the swap or refund is confirmed.'));
      const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='secondary';b.onclick=()=>run(fn);row.append(b);return b;};
      const check=button('Check swap',async()=>{
        check.disabled=true;check.dataset.rheaBusy='true';
        try{const result=await checkDefiSwap(config(),a.request.id);notice(result.state==='observed'?(result.order.stage==='complete'?'Swap confirmed.':'Refund confirmed in your receiving wallet.'):'Swap checked. Your money remains set aside.');}
        finally{delete check.dataset.rheaBusy;check.disabled=!navigator.onLine;}
      });check.dataset.rheaOnline='';check.disabled=!navigator.onLine;
      if(resolved){if(checked.order.stage==='refunded')refund.render(row,order);return;}
      const share=button('Save request file',async()=>download(await defiHandoff(config(),a.request.id,{envelope:true})));share.disabled=expired||blocked;
      const nearby=button('Send with someone nearby',async()=>dispatchEvent(new Event('lenz-nearby-open')));nearby.disabled=expired||blocked||!!a.storageReceipt;
      const send=button('Send over internet',async()=>{
        const response=await fetch('/carrier-config.json');assert(response.ok,'Internet delivery is unavailable');
        const result=await sendDefiRequest(config(),a.request.id,await response.json());
        notice(`Sent to ${result.carriers} delivery service${result.carriers===1?'':'s'}. The swap is not confirmed yet.`);
      });send.disabled=expired||blocked||!navigator.onLine;send.dataset.defiSend='';send.dataset.defiExpiry=String(blocked?0:a.request.expiresAt);
      const receipt=el('input');receipt.type='file';receipt.accept='.json,application/json';receipt.hidden=true;row.append(receipt);
      button('Open update file',()=>{}).onclick=()=>{receipt.value='';receipt.click();};
      receipt.onchange=()=>run(async()=>{
        const file=receipt.files[0];if(!file)return;assert(file.size<=204800,'This update file is too large');
        const text=await file.text();let packet;
        try{packet=JSON.parse(text);}catch{throw Error('Invalid Lenz update file');}
        assert(packet && typeof packet==='object' && !Array.isArray(packet),'Invalid Lenz update file');
        await recordDefiReply(config(),a.request.id,packet);
        notice('Update file checked.');
      });
    },
  };
}
