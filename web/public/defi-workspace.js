import { walletAmount } from './wallet-visibility.js';
import { displayUnits } from './near-protocol.js';
import {positionSurface} from './defi-surfaces.js';
import {requireFeature} from './release-availability.js';

const $=s=>document.querySelector(s);
const lock='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
export function requirePublicSwap() {
  if($('#rhea-privacy').value!=='public-testnet')throw Error('You chose a private swap. This test swap is public, so it cannot continue.');
}
export function mountDefiWorkspace(section,panel) {
  let balance=null,sourceMetadata=null;
  section.querySelector('h2').textContent='DeFi';
  section.querySelector('.quiet').textContent='Your positions and saved swaps';
  const nav=document.createElement('nav');nav.className='defi-tabs';nav.setAttribute('aria-label','DeFi actions');
  const actionMenu=document.createElement('details');actionMenu.className='defi-action-menu';actionMenu.innerHTML='<summary><span>Swap</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary>';actionMenu.append(nav);
  const actionSummary=actionMenu.querySelector('summary');
  actionMenu.addEventListener('keydown',event=>{if(event.key==='Escape'&&actionMenu.open){event.preventDefault();event.stopPropagation();actionMenu.open=false;actionSummary.focus({preventScroll:true});}});
  const empty=document.createElement('div');empty.id='defi-market-state';empty.className='defi-market-state';empty.hidden=true;
  for(const name of ['Swap','Supply','Borrow','Repay','Liquidity','Stake','Farm','Claims','Withdraw']){
    const b=document.createElement('button');b.type='button';b.textContent=name;b.className='secondary';b.setAttribute('aria-pressed',String(name==='Swap'));
    b.onclick=()=>{
      if(['Liquidity','Stake','Farm','Claims'].includes(name)&&!requireFeature(name.toLowerCase(),b))return;
      for(const sibling of nav.children)sibling.setAttribute('aria-pressed',String(sibling===b));
      actionSummary.querySelector('span').textContent=name;actionMenu.open=false;actionSummary.focus({preventScroll:true});
      $('#rhea-open').hidden=name!=='Swap';$('#rhea-queue').hidden=name!=='Swap';$('#rhea-orders').hidden=!['Swap','Withdraw'].includes(name);
      empty.replaceChildren();empty.hidden=name==='Swap';
      const actionEvent=new CustomEvent('lenz-wallet-position-action',{detail:{action:name},cancelable:true});globalThis.dispatchEvent(actionEvent);
      if(name!=='Swap'){
        if(actionEvent.defaultPrevented){empty.hidden=true;return;}
        empty.append(positionSurface(name));
        const link=document.createElement('a'),credit=['Borrow','Supply'].includes(name);link.href=credit?'/markets.html?view=credit&action='+name.toLowerCase():name==='Liquidity'?'/markets.html?view=liquidity&action=liquidity':'/markets.html';link.textContent=credit?'Browse lending markets':name==='Liquidity'?'Browse liquidity pools':'Browse markets';link.className='position-browse';empty.append(link);
      }
    };nav.append(b);
  }
  section.querySelector('#rhea-queue').before(actionMenu,empty);
  panel.classList.add('dex-dialog');$('#rhea-title').textContent='Swap';
  const form=$('#rhea-form'),ids=['rhea-amount','rhea-quote','rhea-estimate','rhea-minimum','rhea-receiver','rhea-duration'];
  const fields=Object.fromEntries(ids.map(id=>[id,$('#'+id)])),submit=form.querySelector('button[type=submit]');
  form.innerHTML=`<div class="dex-context"><span>Rhea · NEAR testnet</span><span class="dex-offline">Offline approval</span></div>
    <div class="dex-privacy"><div>${lock}<label for="rhea-privacy">Privacy</label></div><select id="rhea-privacy"><option value="private">Keep private</option><option value="public-testnet">Public test network</option></select><p id="rhea-privacy-status" role="status"></p></div>
    <div class="dex-exchange"><div class="dex-token-card"><div class="dex-token-caption"><label for="rhea-amount">Pay</label><span>Available <span id="rhea-available">—</span> <button id="rhea-max" type="button">Max</button></span></div><div class="dex-token-value"><span data-field="rhea-amount"></span><select id="swap-pay-asset" class="dex-token" aria-label="Funds to swap"><option value="lenz-tusd">tUSD</option></select></div><small id="swap-pay-name">Lenz Test Dollar</small></div>
    <div class="dex-direction" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v16m-6-6 6 6 6-6"/></svg></div>
    <div class="dex-token-card"><div class="dex-token-caption"><label for="rhea-output">Receive</label><span>Estimated</span></div><div class="dex-token-value"><output id="rhea-output">—</output><select id="swap-receive-asset" class="dex-token" aria-label="Asset to receive"><option value="near-wrapped">wNEAR</option></select></div><small id="swap-receive-name">Wrapped NEAR · testnet</small></div></div>
    <div class="dex-rate"><span id="rhea-rate">Choose your privacy preference to check a rate.</span><span data-field="rhea-quote"></span></div><span data-field="rhea-estimate"></span>
    <div class="dex-protection"><label for="rhea-slippage">Allowed price change</label><select id="rhea-slippage"><option value="50">0.5%</option><option value="100" selected>1%</option><option value="200">2%</option></select><label for="rhea-minimum">Minimum received <small>wNEAR</small></label><span data-field="rhea-minimum"></span><p id="rhea-minimum-note" class="quiet">Calculated from the rate and allowed price change. You can edit it.</p></div>
    <div class="dex-destination"><label for="rhea-receiver">Receive swap or refund here</label><span data-field="rhea-receiver"></span><label for="rhea-duration">Request expires in</label><span data-field="rhea-duration"></span><p id="rhea-duration-note" class="quiet">You can submit immediately. This limits when an unstarted request can be submitted.</p></div>
    <details class="dex-details"><summary>Fees & offline use</summary><dl><dt>Route</dt><dd>tUSD → Rhea → wNEAR</dd><dt>Pool fee</dt><dd>Included in the quoted output</dd><dt>Extra service fee</dt><dd>No extra fee authorized</dd></dl><p>Review the swap offline, then authorize and save its exact terms. This reserves the input. A connected participant submits the signed request.</p><p>The amount and receiving wallet are public on NEAR testnet. Keep the original request until its result is verified. Expiry does not release reserved funds.</p></details>`;
  for(const id of ids)form.querySelector(`[data-field="${id}"]`).append(fields[id]);form.append(submit);
  const settings=document.createElement('details');settings.className='dex-settings';settings.innerHTML='<summary>Swap settings</summary><div class="dex-settings-body"></div>';
  const settingsBody=settings.lastElementChild,privacyNote=$('#rhea-privacy-status'),destination=form.querySelector('.dex-destination'),timing=document.createElement('div');timing.className='dex-timing';
  timing.append(...[...destination.children].slice(2));
  fields['rhea-duration'].setAttribute('aria-describedby','rhea-duration-note');
  privacyNote.className='dex-privacy-note';destination.after(privacyNote,settings);
  settingsBody.append(form.querySelector('.dex-privacy'),form.querySelector('.dex-protection'),timing);
  form.querySelector('.dex-context').innerHTML='<span>via Rhea · NEAR testnet</span>';
  fields['rhea-amount'].placeholder='0.00';fields['rhea-quote'].hidden=true;fields['rhea-minimum'].placeholder='From current rate';fields['rhea-minimum'].setAttribute('aria-describedby','rhea-minimum-note');fields['rhea-estimate'].textContent='';
  const publicRoute=document.createElement('button');publicRoute.id='rhea-use-public-route';publicRoute.type='button';publicRoute.className='secondary';publicRoute.textContent='Use public Rhea route';privacyNote.after(publicRoute);
  publicRoute.onclick=()=>{if(form.dataset.intentManaged==='true')return;$('#rhea-privacy').value='public-testnet';$('#rhea-privacy').dispatchEvent(new Event('change',{bubbles:true}));};
  fields['rhea-minimum'].addEventListener('invalid',()=>{settings.open=true;});
  fields['rhea-duration'].addEventListener('invalid',()=>{settings.open=true;});
  function privacy(){
    publicRoute.hidden=form.dataset.intentManaged==='true'||$('#rhea-privacy').value==='public-testnet';
    if(form.dataset.intentManaged==='true')return;
    const allowed=$('#rhea-privacy').value==='public-testnet';
    $('#rhea-privacy-status').textContent=allowed?'Public swap via Rhea on NEAR testnet.':'tUSD → wNEAR uses public Rhea settlement. Getting a rate shares the entered amount with Lenz and its market provider. Choose the public route or use private pool funds.';
    submit.disabled=!allowed;submit.textContent=allowed?$('#defi-method')?.value==='contact'?'Review request':navigator.onLine?'Review swap':'Review offline swap':'Private pool funds required';
    fields['rhea-quote'].disabled=!allowed||!navigator.onLine;
  }
  const stale=()=>{if(form.dataset.intentManaged==='true')return;$('#rhea-output').textContent='—';$('#rhea-rate').textContent=$('#rhea-privacy').value==='public-testnet'?'Checking rate…':'Private pool funds required';fields['rhea-estimate'].textContent='';};
  $('#rhea-privacy').onchange=()=>{stale();privacy();};$('#rhea-slippage').onchange=stale;fields['rhea-amount'].addEventListener('input',stale);
  form.addEventListener('change',privacy);addEventListener('online',privacy);addEventListener('offline',privacy);
  $('#rhea-max').onclick=()=>{if(balance===null)return;fields['rhea-amount'].value=displayUnits(balance);fields['rhea-amount'].dispatchEvent(new Event('input'));};
  privacy();
  return {
    reset(){if(form.dataset.intentManaged==='true')return;stale();privacy();},
    balance(amount,metadata=null){balance=amount;sourceMetadata=metadata;walletAmount($('#rhea-available'),displayUnits(amount));},
    available(){return balance;},
    source(){return sourceMetadata;},
    privacy,
  };
}
