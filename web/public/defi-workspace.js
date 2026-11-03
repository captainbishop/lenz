import { walletAmount } from './wallet-visibility.js';
import { displayUnits } from './near-protocol.js';

const $=s=>document.querySelector(s);
const lock='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
export function requirePublicSwap() {
  if($('#rhea-privacy').value!=='public-testnet')throw Error('Private execution is required. This test route is public and cannot be used with that preference.');
}
export function mountDefiWorkspace(section,panel) {
  let balance='0';
  section.querySelector('h2').textContent='DeFi';
  section.querySelector('.quiet').textContent='Saved swaps and approvals. Verify results before reusing returned funds.';
  const nav=document.createElement('nav');nav.className='defi-tabs';nav.setAttribute('aria-label','DeFi actions');
  const empty=document.createElement('div');empty.id='defi-market-state';empty.className='defi-market-state';empty.hidden=true;
  const states={Supply:['Supply & earn','Lending is not connected in Lenz yet. Rates, access to your deposit and privacy must be checked before you can supply assets.'],Borrow:['Borrow against collateral','Borrowing is not connected in Lenz yet. Available credit and liquidation risk need current market checks, even when you approve offline.'],Liquidity:['Provide liquidity','Liquidity positions are not connected in Lenz yet. The pool, both assets, fees and withdrawal terms must be supported before approval.'],Withdraw:['Withdraw & repay','Only the existing Rhea swap-refund return is available below. General withdrawals and debt repayment are not connected in Lenz yet.']};
  for(const name of ['Swap',...Object.keys(states)]){
    const b=document.createElement('button');b.type='button';b.textContent=name;b.className='secondary';b.setAttribute('aria-pressed',String(name==='Swap'));
    b.onclick=()=>{
      for(const sibling of nav.children)sibling.setAttribute('aria-pressed',String(sibling===b));
      $('#rhea-open').hidden=name!=='Swap';$('#rhea-queue').hidden=name!=='Swap';$('#rhea-orders').hidden=!['Swap','Withdraw'].includes(name);
      empty.replaceChildren();empty.hidden=name==='Swap';
      if(name!=='Swap'){
        const pill=document.createElement('span');pill.className='defi-private-label';pill.innerHTML=lock+'Private execution required';
        const title=document.createElement('h3');title.textContent=states[name][0];const text=document.createElement('p');text.textContent=states[name][1];
        empty.append(pill,title,text);
      }
    };nav.append(b);
  }
  section.querySelector('#rhea-queue').before(nav,empty);
  panel.classList.add('dex-dialog');$('#rhea-title').textContent='Swap';
  const form=$('#rhea-form'),ids=['rhea-amount','rhea-quote','rhea-estimate','rhea-minimum','rhea-receiver','rhea-duration'];
  const fields=Object.fromEntries(ids.map(id=>[id,$('#'+id)])),submit=form.querySelector('button[type=submit]');
  form.innerHTML=`<div class="dex-context"><span>Rhea · NEAR testnet</span><span class="dex-offline">Offline approval</span></div>
    <div class="dex-privacy"><div>${lock}<label for="rhea-privacy">Execution privacy</label></div><select id="rhea-privacy"><option value="private">Require private execution</option><option value="public-testnet">Allow this public testnet swap</option></select><p id="rhea-privacy-status" role="status"></p></div>
    <div class="dex-token-card"><div class="dex-token-caption"><label for="rhea-amount">You pay</label><span>Available <span id="rhea-available">0</span> <button id="rhea-max" type="button">Max</button></span></div><div class="dex-token-value"><span data-field="rhea-amount"></span><span class="dex-token"><i aria-hidden="true">$</i>tUSD</span></div><small>Lenz Test Dollar</small></div>
    <div class="dex-direction" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v16m-6-6 6 6 6-6"/></svg></div>
    <div class="dex-token-card"><div class="dex-token-caption"><label for="rhea-output">You receive</label><span>Estimated</span></div><div class="dex-token-value"><output id="rhea-output">—</output><span class="dex-token"><i aria-hidden="true">N</i>wNEAR</span></div><small>Wrapped NEAR · testnet</small></div>
    <div class="dex-rate"><span id="rhea-rate">Choose your privacy preference to check a rate.</span><span data-field="rhea-quote"></span></div><span data-field="rhea-estimate"></span>
    <div class="dex-protection"><label for="rhea-slippage">Slippage tolerance</label><select id="rhea-slippage"><option value="50">0.5%</option><option value="100" selected>1%</option><option value="200">2%</option></select><label for="rhea-minimum">Minimum received <small>wNEAR</small></label><span data-field="rhea-minimum"></span></div>
    <div class="dex-destination"><label for="rhea-receiver">Receive swaps & refunds here</label><span data-field="rhea-receiver"></span><label for="rhea-duration">Start within</label><span data-field="rhea-duration"></span></div>
    <details class="dex-details"><summary>Route, fees & offline limits</summary><dl><dt>Route</dt><dd>tUSD → Rhea → wNEAR</dd><dt>Pool fee</dt><dd>Included in the quoted output</dd><dt>Executor fee</dt><dd>No extra fee authorized</dd></dl><p>A fresh rate and execution require a connected device. Offline, choose your minimum; an executor must check current conditions before acting.</p><p>The amount and receiving wallet are public on the test network. Saving sets this money aside until the swap is resolved. The time limit does not make it available again.</p></details>`;
  for(const id of ids)form.querySelector(`[data-field="${id}"]`).append(fields[id]);form.append(submit);
  fields['rhea-amount'].placeholder='0.00';fields['rhea-quote'].textContent='Check rate';fields['rhea-minimum'].placeholder='Set your minimum';fields['rhea-estimate'].textContent='No live rate loaded. Offline minimums can be entered directly.';
  function privacy(){
    const allowed=$('#rhea-privacy').value==='public-testnet';
    $('#rhea-privacy-status').textContent=allowed?'Public route selected. Your amounts and receiving wallet will be visible on NEAR.':'A private route for these test assets is not connected in Lenz yet. No quote or approval will be sent.';
    submit.disabled=!allowed;submit.textContent=allowed?$('#defi-method')?.value==='contact'?'Review request':'Save swap':'Private route not connected';
    fields['rhea-quote'].disabled=!allowed||!navigator.onLine;
  }
  const stale=()=>{$('#rhea-output').textContent='—';$('#rhea-rate').textContent='Rate needs updating.';fields['rhea-estimate'].textContent='Check a fresh rate or enter your own minimum while offline.';};
  $('#rhea-privacy').onchange=()=>{stale();privacy();};$('#rhea-slippage').onchange=stale;fields['rhea-amount'].addEventListener('input',stale);
  form.addEventListener('change',privacy);addEventListener('online',privacy);addEventListener('offline',privacy);
  $('#rhea-max').onclick=()=>{fields['rhea-amount'].value=displayUnits(balance);fields['rhea-amount'].dispatchEvent(new Event('input'));};
  privacy();
  return {
    reset(){ $('#rhea-privacy').value='private';stale();privacy(); },
    balance(amount){balance=amount;walletAmount($('#rhea-available'),displayUnits(amount));},
  };
}
