import {readState} from './chat-store.js';
import {courierCandidates,courierSummary,setCourierEnabled,queueCourierItems,forgetCourierItem} from './nearby-courier.js';

export function mountCourierControls(dialog,{getSession,getContract,getDefiConfig=()=>null}){
 const panel=document.createElement('details');panel.id='nearby-courier';
 panel.innerHTML=`<summary>Nearby delivery <span id="courier-count"></span></summary>
 <label class="courier-toggle"><input id="courier-enabled" type="checkbox">Allow nearby delivery</label>
 <p class="quiet">Only the recipient can read the content. People passing it along can see who it is from and for, file sizes and delivery times.</p>
 <details><summary>Privacy details</summary><p class="quiet">If someone later gains access to a device’s encryption keys, they may be able to read older items they copied. Payments on public networks are still visible there.</p></details>
 <div id="courier-send" hidden><label for="courier-recipient">Deliver to</label><select id="courier-recipient"></select><button id="courier-queue" type="button">Send saved items</button></div>
 <p id="courier-feedback" class="quiet" role="status" aria-live="polite"></p><ul id="courier-items"></ul>`;
 dialog.querySelector('#nearby-connected').after(panel);
 const $=id=>panel.querySelector('#'+id);let working=false,selection=new Map(),refreshId=0;
 const labels={waiting:'Waiting', 'with-courier':'With nearby contact',forwarded:'Forwarded',received:'Received',expired:'Delivery window ended',unavailable:'Delivery unavailable'};
 async function refresh(){
  const run=++refreshId,s=await readState();if(!s.identity){$('courier-enabled').disabled=true;return;}
  const options={contract:getContract(),defiConfig:getDefiConfig()},summary=await courierSummary(options);
  const session=getSession(),peer=session?.connected?session.contact:null;
  const candidates=peer?await courierCandidates(peer.id,options):[];if(run!==refreshId)return;
  if(!working)$('courier-enabled').checked=summary.enabled;$('courier-enabled').disabled=working;
  $('courier-count').textContent=summary.outgoing.length+summary.carried.length||'';
  const name=id=>s.contacts.find(c=>c.id===id)?.name??(id===s.identity.profile.id?'You':'Contact not added');
  const selected=$('courier-recipient').value;selection=new Map(candidates.filter(g=>g.messageIds.length).map(g=>[g.id,g]));
  $('courier-recipient').replaceChildren();
  for(const [id,group]of selection){const option=document.createElement('option');option.value=id;option.textContent=`${name(id)} · ${group.messageIds.length} ready`; $('courier-recipient').append(option);}
  if(selection.has(selected))$('courier-recipient').value=selected;
  $('courier-send').hidden=!summary.enabled||!peer||selection.size===0;
  $('courier-recipient').disabled=working;$('courier-queue').disabled=working;
  $('courier-queue').textContent=peer?`Send via ${peer.name}`:'Send saved items';
  if(!$('courier-feedback').dataset.result)$('courier-feedback').textContent=!summary.enabled?'Turn on to pass along or receive saved items.':!peer?'Connect to someone nearby to pass along or receive saved items.':selection.size?'Send up to eight items with this person, depending on their available space.':candidates.some(g=>g.remaining)?'This person has no space for more items. Other saved items remain on this device.':'No saved items to send through this person.';
  $('courier-items').replaceChildren();
  for(const [kind,rows]of [['outgoing',summary.outgoing],['carried',summary.carried]])for(const row of rows){
   const li=document.createElement('li'),copy=document.createElement('span'),title=document.createElement('strong'),status=document.createElement('small'),button=document.createElement('button');
   title.textContent=kind==='outgoing'?`To ${name(row.to)}`:`Carrying for ${name(row.to)}`;
   const label=row.status==='received'&&['defi-approval','budget-approval','private-approval'].includes(row.purpose)?'Received · completion not confirmed':labels[row.status];
   status.textContent=kind==='outgoing'?`${label} · via ${name(row.via)}`:label;copy.append(title,status);
   button.type='button';button.className='secondary';button.textContent=kind==='outgoing'?'Stop retrying':'Stop carrying';button.disabled=working;button.setAttribute('aria-label',`${button.textContent}: ${title.textContent}`);
   button.onclick=()=>act(async()=>{await forgetCourierItem(row.id);feedback('Stopped on this device. Copies already shared cannot be recalled. Your original items stay saved.');});
   li.append(copy,button);$('courier-items').append(li);
  }
 }
 function feedback(text){$('courier-feedback').dataset.result='true';$('courier-feedback').textContent=text;}
 async function act(fn){
  if(working)return;working=true;panel.setAttribute('aria-busy','true');
  for(const control of panel.querySelectorAll('input,select,button:not(.lenz-choice-button)'))control.disabled=true;
  try{await refresh();await fn();}catch(error){feedback(error.message);}finally{
   working=false;panel.removeAttribute('aria-busy');
   for(const control of panel.querySelectorAll('input,select,button:not(.lenz-choice-button)'))control.disabled=false;
   try{await refresh();}catch(error){feedback(error.message);}
  }
 }
 $('courier-enabled').onchange=event=>{const enabled=event.target.checked;void act(async()=>{
  await setCourierEnabled(enabled);feedback(enabled?'Nearby delivery is on.':'Nearby delivery paused. Saved items stay on this device.');
  if(enabled)await getSession()?.sendCouriers();
 });};
 $('courier-queue').onclick=()=>act(async()=>{
  const session=getSession();if(!session?.connected)throw Error('Connect to someone nearby first.');
  const group=selection.get($('courier-recipient').value),items=group?.messageIds??[];
  await queueCourierItems(items,session.contact.id,{contract:getContract(),defiConfig:getDefiConfig()});feedback(`${items.length} item${items.length===1?'':'s'} queued via ${session.contact.name}.${group.remaining?` ${group.remaining} remain saved for a later delivery.`:''}`);
  await session.sendCouriers();
 });
 panel.addEventListener('toggle',()=>{if(panel.open)void refresh().catch(error=>feedback(error.message));});
 return {refresh};
}
