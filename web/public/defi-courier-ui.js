import {defiInboxSummary,setDefiInboxEnabled} from './defi-courier.js';
import {displayUnits} from './near-protocol.js';

export function mountDefiInboxControls(dialog,{getConfig}){
 const panel=document.createElement('details');panel.id='nearby-defi-inbox';
 panel.innerHTML=`<summary>DeFi requests <span id="defi-inbox-count"></span></summary>
 <label class="courier-toggle"><input id="defi-inbox-enabled" type="checkbox" disabled>Receive DeFi requests on this device</label>
 <p class="quiet">Receive swap requests from contacts who chose you. Turn on Allow nearby delivery above first. You can review requests here; swaps cannot be started from this screen yet.</p>
 <p id="defi-inbox-feedback" class="quiet" role="status"></p><ul id="defi-inbox-items" class="courier-items"></ul>`;
 dialog.querySelector('#nearby-courier').after(panel);const $=id=>panel.querySelector('#'+id);let busy=false,run=0;
 async function refresh(){
  const version=++run,summary=await defiInboxSummary();if(version!==run)return;
  $('defi-inbox-enabled').checked=summary.enabled;$('defi-inbox-enabled').disabled=busy||(!summary.enabled&&!getConfig()?.ready);
  $('defi-inbox-count').textContent=summary.requests.length||'';$('defi-inbox-items').replaceChildren();
  if(!$('defi-inbox-feedback').textContent&&!getConfig()?.ready)$('defi-inbox-feedback').textContent='Receiving swap requests is unavailable right now.';
  for(const request of summary.requests){
   const row=document.createElement('li'),details=document.createElement('details'),title=document.createElement('summary'),status=document.createElement('p'),terms=document.createElement('dl');
   title.textContent=`${displayUnits(request.amount)} tUSD swap · ${request.sender}`;
   status.className='quiet';status.textContent=request.status==='expired'?'Time limit ended. The request stays saved to prevent it being used again.':'Saved here for review. The swap has not started.';
   for(const [name,value]of [['Receiving wallet',request.receiver],['Receive at least',formatNear(request.minOutput)+' wrapped test NEAR'],['Start before',new Date(request.expiresAt).toLocaleString()],['Network','Public NEAR test network']]){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;terms.append(dt,dd);
   }
   details.append(title,status,terms);row.append(details);$('defi-inbox-items').append(row);
  }
 }
 $('defi-inbox-enabled').onchange=async event=>{
  if(busy)return;const enabled=event.target.checked;busy=true;panel.setAttribute('aria-busy','true');$('defi-inbox-enabled').disabled=true;
  try{await setDefiInboxEnabled(enabled,getConfig());$('defi-inbox-feedback').textContent=enabled?'Ready to receive swap requests.':'New DeFi requests paused. Existing requests remain saved.';}
  catch(error){$('defi-inbox-feedback').textContent=error.message;}
  finally{busy=false;panel.removeAttribute('aria-busy');try{await refresh();}catch(error){$('defi-inbox-enabled').disabled=false;$('defi-inbox-feedback').textContent=error.message;}}
 };
 return {refresh};
}
function formatNear(value){const n=BigInt(value),base=10n**24n,fraction=(n%base).toString().padStart(24,'0').replace(/0+$/,'');return (n/base).toString()+(fraction?'.'+fraction:'');}
