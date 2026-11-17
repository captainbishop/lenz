import { createIdentity } from './peer-crypto.js';
import {startAccountSync} from './account-sync.js';
import { readState, updateState } from './chat-store.js';
import { isRecoveredChat,isRecoveredContact } from './chat-access.js';
import { mountProfilePanels } from './profile-panels.js';
import { setupProfile } from './profile-ui.js';
import { renderProfile, setupContacts } from './contact-ui.js';
import { paintAvatar, privateName } from './profile-display.js';
import {startOfflineAccess} from './offline-access.js';
import { themeIcon } from './theme-icon.js';
import {mountWalletActions} from './wallet-actions.js';
import {mountWalletTokens,renderWalletTokens} from './wallet-tokens.js';
import { mountEvmWallet } from './evm-wallet-ui.js';
import { mountWalletPortfolio } from './wallet-portfolio.js';
import { mountNearWallet, loadNearConfig, renderNearWallet, openNearSend } from './near-wallet.js';
import {createNearIntentWalletController} from './intent-near-ui.js';
import {createAuroraFundingWalletController} from './intent-aurora-funding-ui.js';
import {createWalletFundingController} from './wallet-funding.js';
import {createZcashSendController} from './intent-zcash-send.js';
import {mountWalletLending} from './wallet-lending.js';
import {consumePrivateFundingReturn} from './account-return.js';
mountProfilePanels();
startAccountSync();
const $ = selector => document.querySelector(selector);
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
let busy = false, statusTimer, sendAfterContact=false,restoreSendAfterContact=null;
const intentController=createNearIntentWalletController();
const lendingController=mountWalletLending();
const zcashSendController=createZcashSendController();
const privateFundingController=createAuroraFundingWalletController({openPublicFunding:()=>fundingController.openFunding(),editSwapSelection:selection=>intentController.editSwapSelection(selection)});
const fundingController=createWalletFundingController({openPrivateFunding:()=>privateFundingController.openFunding(),openSwapFunding:()=>intentController.openFunding(),openLendingFunding:asset=>lendingController.openFunding(asset),refreshWallet:()=>render()});
const privateSwapRoute={open:selection=>privateFundingController.openSwap(selection),restore:row=>privateFundingController.restoreSwap(row),recipient:()=>privateFundingController.recipient()};
privateFundingController.subscribe(snapshot=>intentController.setPrivateRoute({...privateSwapRoute,holdings:snapshot.balances}));
function status(text, error = false, { transient = false } = {}) {
  clearTimeout(statusTimer);
  const node = $('#status'); node.textContent = text; node.className = error ? 'status error' : 'status';
  if (transient && !error) statusTimer = setTimeout(() => { node.textContent = ''; }, 3500);
}
async function action(operation) {
  if (busy) return; busy = true; $('main').setAttribute('aria-busy', 'true');
  document.querySelectorAll('.wallet-feedback').forEach(node => { node.textContent = ''; });
  try { await operation(); channel?.postMessage('changed'); await render(); }
  catch (error) {
    status(error.message, true);
    document.querySelectorAll('dialog[open] .wallet-feedback, dialog[open] #contact-feedback, dialog[open] #profile-feedback').forEach(node => { node.textContent = error.message; });
  } finally { busy = false; $('main').setAttribute('aria-busy', 'false'); }
}
async function render() {
  const state = await readState(), hasIdentity = !!state.identity, walletReady = hasIdentity || !!evmWallet.snapshot;
  intentController.render(state.identity?.profile.id??null);
  zcashSendController.render(state.identity?.profile.id??null);
  privateFundingController.render(state.identity?.profile.id??null);
  fundingController.render(state.identity?.profile.id??null);
  lendingController.render(state.identity?.profile.id??null);
  $('#wallet-onboarding').hidden = walletReady; $('#wallet-content').hidden = !walletReady; $('#my-profile').hidden = !hasIdentity;
  document.body.classList.toggle('wallet-entry', !walletReady);
  $('#wallet-entry-connect').disabled = false;
  $('#wallet-entry-connect').firstChild.textContent = navigator.onLine ? 'Connect wallet ' : 'Start offline ';
  $('#wallet-onboarding .welcome-choices h2').textContent = navigator.onLine ? 'Start with your wallet' : 'Start here, offline';
  $('#wallet-onboarding .welcome-description').textContent = navigator.onLine ? 'Connect to see your balances and receive money.' : 'Create a profile on this device without internet or a passkey.';
  $('#wallet-entry-status').textContent = navigator.onLine ? 'You approve payments separately in your wallet.' : 'Your profile stays here. You can turn on chat backup later.';
  await renderProfile(state.identity?.profile);const nearBalance=await renderNearWallet(state);portfolio.render(hasIdentity,{offlineOwned:nearBalance?.owned});await renderWalletTokens();if (!hasIdentity) return;
  const people = $('#wallet-people'); people.replaceChildren();
  $('#wallet-people-empty').hidden = state.contacts.length > 0;
  for (const contact of state.contacts) {
    const row = document.createElement('div'), avatar = document.createElement('span'), button = document.createElement('button');
    row.className = 'person'; avatar.className = 'avatar'; paintAvatar(avatar, contact);
    button.textContent = contact.name; button.type = 'button'; button.disabled=isRecoveredChat(state.identity)||isRecoveredContact(state,contact.id); button.onclick = () => openNearSend(contact.id);
    row.append(avatar, button); people.append(row);
  }
}
function start(name, privateProfile = false) { return action(async () => {
  await updateState(async state => {
    if (state.identity) throw new Error('This browser already has a profile. Reload to see it.');
    state.identity = await createIdentity(name); if (privateProfile) state.identity.profile.avatar = 'moon';
  }); status('Profile saved. Your wallet is ready.', false, { transient: true });
}); }
$('#wallet-identity-form').onsubmit = event => { event.preventDefault(); start($('#wallet-name').value); };
$('#wallet-private').onclick = () => start(privateName(), true);
setupProfile({ action, status });
setupContacts({ action, status, selectExisting:()=>sendAfterContact, select:async id => {
  await render();$('#near-recipient').value=id;status('');
  if(sendAfterContact){sendAfterContact=false;restoreSendAfterContact=null;openNearSend(id);}
} });
startOfflineAccess($('#money-cache-status'));
channel?.addEventListener('message', () => { if (!busy) render().catch(error => status(error.message, true)); });
mountNearWallet({ action, status, intentController });
// Keep the existing payment controls and handlers; compose them for the wallet.
const svg = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
$('#near-send').innerHTML = 'Send'+svg('M6 18 18 6M6 6h12v12');
$('#near-receive').innerHTML = 'Receive'+svg('M18 6 6 18M6 6v12h12');
$('.balance-label>span').textContent = 'Offline balance';
$('.near-network').textContent = 'NEAR testnet';
$('.near-token-note').textContent = 'Test dollars · No cash value';
const amounts = document.createElement('dl'); amounts.className = 'wallet-amounts';
amounts.innerHTML = '<div><dt>Confirmed</dt><dd><span id="near-confirmed">—</span><small>tUSD</small></dd></div><div><dt>Pending</dt><dd><span id="near-pending">—</span><small>tUSD</small></dd></div><div><dt>Set aside</dt><dd><span id="near-reserved">—</span><small>tUSD</small></dd></div>';
const balanceDetails=document.createElement('details');balanceDetails.className='wallet-balance-details';balanceDetails.innerHTML='<summary id="wallet-balance-detail-label">Details</summary>';
balanceDetails.append(amounts,$('.near-network'));$('.near-balance').append(balanceDetails);
$('#wallet-content').append($('#rhea-wallet'));
$('#near-empty').textContent = 'No payments yet.';
for (const name of ['send','fund']) {
  const input = $('#near-'+name+'-amount'), label = document.querySelector(`label[for="near-${name}-amount"]`);
  const entry = document.createElement('div'), value = document.createElement('div'), unit = document.createElement('span');
  entry.className = 'payment-entry'; value.className = 'payment-value'; unit.textContent = 'tUSD';
  label.before(entry); entry.append(label,value); value.append(input,unit);
  label.textContent = name==='fund'?'Amount · up to 100 tUSD':'Amount';
}
$('#near-send-form>p.quiet:last-of-type').textContent = 'Payments stay pending until confirmed online. If spent twice, only one payment can be confirmed.';
$('#near-share-card').innerHTML = 'My Lenz ID'+svg('M6 18 18 6M6 6h12v12');
mountWalletActions({addRecipient:scan=>{
  sendAfterContact=true;$('#near-send-dialog').close();$('#show-add-contact').click();
  $('#add-title').textContent='Recipient';
  if(scan){$('#contact-advanced').open=true;$('#scan-contact').click();}
}});
const evmWallet=mountEvmWallet({sendToContact:async(profile,text,proceed,restore)=>{
 const state=await readState();if(!state.identity||isRecoveredChat(state.identity)||isRecoveredContact(state,profile.id))throw Error('Open the original payment account.');
 proceed();
 if(state.contacts.some(c=>c.id===profile.id)){openNearSend(profile.id);return;}
 sendAfterContact=true;restoreSendAfterContact=restore;$('#show-add-contact').click();$('#add-title').textContent='Recipient';$('#contact-card').value=text;$('#review-contact').click();
},sendShielded:selection=>zcashSendController.open(selection),openSwap:()=>portfolio.openSwap()});
if($('#wallet-content'))mountWalletTokens({action,wallet:evmWallet,intentController,privateFundingController});
const portfolio=mountWalletPortfolio(evmWallet,{intentController,fundingController,zcashController:zcashSendController});
$('#wallet-entry-connect').onclick=()=>navigator.onLine?evmWallet.openConnect():location.assign('/account.html?next=wallet');
addEventListener('lenz-evm-session',()=>{if(!busy)render().catch(error=>status(error.message,true));});
$('#add-contact').addEventListener('close',()=>{
  if(sendAfterContact){sendAfterContact=false;const restore=restoreSendAfterContact;restoreSendAfterContact=null;if(restore)restore();else openNearSend();}
  $('#add-title').textContent='Add a person';
});
themeIcon($('#theme-toggle'));
$('#wallet-settings-actions').addEventListener('click',event=>{if(event.target.closest('button'))$('.wallet-settings').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('.wallet-settings').open){$('.wallet-settings').open=false;$('.wallet-settings summary').focus();}});
try { await loadNearConfig(); await render(); if(!document.body.classList.contains('wallet-entry'))status('Your wallet is ready.', false, { transient: true });else status(''); } catch (error) { status(error.message, true); }
if(consumePrivateFundingReturn()){
 try{if((await readState()).identity)await privateFundingController.openFunding();}catch(error){status(error.message,true);}
}
