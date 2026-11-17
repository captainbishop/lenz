import {assetIcon,assetLabel} from './asset-icon.js';
import { createWalletSession } from './evm-wallet.js';
import { iconButton } from './wallet-actions.js';
import { walletAmount } from './wallet-visibility.js';
import qrcode from './qr-vendor/qrcode-generator.js';
import {mountEvmTransfers} from './evm-transfer-ui.js';
import {mountReceivingLinks} from './receiving-link-ui.js';
import {transferAssets,address,check} from './evm-transfer.js';
import {createNetworkStore,WALLET_NETWORKS} from './evm-networks.js';
import {mountNetworkControls} from './evm-network-ui.js';
import {readLendingAccount} from './lending-account.js';
import {mountIntentsAccount} from './intents-account-ui.js';
import {mountPrivateSpend} from './private-spend-ui.js';
import {mountPrivateFunding} from './private-funding-ui.js';

const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
export function mountEvmWallet({sendToContact,sendShielded,openSwap}={}) {
  const section = el('section'); section.id = 'connected-wallet'; section.className = 'connected-wallet';
  section.innerHTML = '<div class="section-heading"><h2>Connected wallet</h2><button id="evm-connect" type="button">Connect wallet</button><button id="evm-disconnect" type="button" class="secondary" hidden>Disconnect</button></div><p id="evm-intro" class="quiet">Ethereum · Arbitrum · Base</p><div id="evm-account" hidden><div class="evm-identity"><strong id="evm-network"></strong><span id="evm-address"></span><small id="evm-observed"></small></div><div class="evm-funds"><strong id="evm-balance"></strong><span>ETH</span></div><div class="evm-actions"><button id="evm-receive" type="button" class="secondary">Receive</button><button id="evm-refresh" type="button" class="secondary">Refresh</button></div></div><p id="evm-status" class="quiet" role="status"></p>';
  document.querySelector('#wallet-onboarding').before(section);
  section.querySelector('h2').textContent='Your wallet';
  const dialog = el('dialog'); dialog.id = 'evm-connect-dialog'; dialog.setAttribute('aria-labelledby', 'evm-connect-title');
  dialog.innerHTML = '<div class="dialog-top"><h2 id="evm-connect-title">Connect wallet</h2><button id="evm-connect-close" type="button" class="secondary wallet-close"></button></div><p class="quiet">Connect to see your tokens and balances.</p><div id="evm-providers"></div><p id="evm-provider-empty" class="quiet">Open Lenz in a browser with your wallet installed.</p><p id="evm-connect-status" class="wallet-feedback" role="status"></p><details class="quiet"><summary>What connecting allows</summary><p>Lenz can read your address and balances. Connecting needs no signature and gives no permission to spend. You approve payments separately in your wallet.</p><p>Your address goes to the Lenz server, your wallet’s network provider, Blockscout and public network providers. Chainlink and DEX Screener supply prices and artwork. Some tokens may be missing.</p><p>Your recovery phrase stays in your wallet.</p></details>';
  const receive = el('dialog'); receive.id = 'evm-receive-dialog'; receive.setAttribute('aria-labelledby', 'evm-receive-title');
  receive.innerHTML = '<div class="dialog-top"><h2 id="evm-receive-title">Receive</h2><button id="evm-receive-close" type="button" class="secondary wallet-close"></button></div><p id="evm-receive-network"></p><canvas id="evm-receive-qr" aria-label="Wallet address QR code"></canvas><p id="evm-receive-address" class="evm-address-full"></p><button id="evm-copy" type="button">Copy address</button><p class="quiet">Send using the network shown above. This address cannot receive test dollars (tUSD).</p><p id="evm-receive-status" class="wallet-feedback" role="status"></p>';
  document.body.append(dialog, receive);
  const $ = id => document.getElementById(id);
  iconButton($('evm-copy'),'Copy address','M8 8h12v13H8zM16 8V3H3v13h5');$('evm-copy').classList.add('wallet-copy');
  for (const [id, target] of [['evm-connect-close', dialog], ['evm-receive-close', receive]]) {
    iconButton($(id), 'Close', 'm6 6 12 12M18 6 6 18'); $(id).onclick = () => target.close();
  }
  let session, privateAccount, selectedName = '', selection = null, discoveryConsent = false;
  const networks = createNetworkStore({ storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, locks: navigator.locks });
  session = createWalletSession({ networks, changed(snapshot, message) {
    privateAccount?.reset();
    queueMicrotask(()=>dispatchEvent(new Event('lenz-evm-session')));
    const pending = session?.pending ?? false;
    $('evm-connect').hidden = !!snapshot; $('evm-connect').disabled = pending || !navigator.onLine;
    $('evm-disconnect').hidden = !snapshot && !pending;
    $('evm-account').hidden = !snapshot; $('evm-intro').hidden = !!snapshot;
    $('evm-status').textContent = navigator.onLine ? message : 'Offline. Reconnect your wallet when online.';
    $('evm-connect-status').textContent = message;
    $('evm-providers').querySelectorAll('button').forEach(button => { button.disabled = pending || !navigator.onLine; });
    if (receive.open) receive.close();
    // Remove stale addresses and QR pixels as soon as the session is invalidated.
    $('evm-address').textContent = $('evm-receive-address').textContent = '';
    $('evm-receive-qr').width = $('evm-receive-qr').height = 0;
    if (!snapshot) return;
    $('evm-network').textContent = snapshot.network.name + ' · ' + selectedName;
    $('evm-address').textContent = snapshot.address; $('evm-address').title = snapshot.address;
    walletAmount($('evm-balance'), snapshot.amount);
    $('evm-balance').nextElementSibling.textContent = snapshot.network.symbol;section.querySelector('.evm-funds>.asset-icon')?.remove();section.querySelector('.evm-funds').prepend(assetIcon({symbol:snapshot.network.symbol,trusted:Object.hasOwn(WALLET_NETWORKS,snapshot.chainId)}));
    $('evm-observed').textContent = 'Read ' + new Date(snapshot.observedAt).toLocaleTimeString() + ' · wallet provider';
    dialog.close();
  }});
  privateAccount = mountIntentsAccount(session, section);
  mountPrivateSpend(session, document.querySelector('#wallet-onboarding'),{openSwap});
  mountPrivateFunding(session,{connect:async()=>{selection=null;openConnect();await new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));return session.snapshot;}});
  const transfers=mountEvmTransfers(session,{connect:()=>{selection=null;openConnect();},sendToContact,sendShielded});
  mountReceivingLinks(session);
  mountNetworkControls(session, networks, next => { selection = next; openConnect(); });
  const providers = [];
  function add(provider, name) {
    if (providers.length >= 12 || providers.some(item => item.provider === provider) || !provider || ['request', 'on', 'removeListener'].some(key => typeof provider[key] !== 'function')) return;
    const item = { provider, name }; providers.push(item);
    const button = el('button', name); button.type = 'button'; button.className = 'secondary';
    button.disabled = session.pending || !navigator.onLine;
    button.onclick = async () => {
      selectedName = item.name; discoveryConsent = true;
      try { await session.connect(item.provider, selection); } catch (error) { if (!session.pending && !session.snapshot) $('evm-connect-status').textContent ||= 'Unable to connect this wallet.'; }
    };
    $('evm-providers').append(button); $('evm-provider-empty').hidden = true;
  }
  function announce(event) {
    try {
      const { info, provider } = event.detail ?? {};
      if (!info || typeof info.name !== 'string' || !info.name.trim() || info.name.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(info.name)) return;
      add(provider, info.name.trim());
    } catch {} // Malformed third-party announcements confer no authority.
  }
  window.addEventListener('eip6963:announceProvider', announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  function openConnect() {
    $('evm-connect-status').textContent = '';
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (!providers.length) { try { add(window.ethereum, 'Browser wallet'); } catch {} }
    dialog.showModal();
  }
  $('evm-connect').onclick = () => { selection = null; openConnect(); };
  const cancelConnection = () => { if (session.pending) session.disconnect('Connection cancelled.'); };
  // Native close is deferred; invalidate before a permission promise can resolve.
  dialog.addEventListener('cancel', cancelConnection);
  $('evm-connect-close').onclick = () => { cancelConnection(); dialog.close(); };
  dialog.addEventListener('close', () => { if (!dialog.open) cancelConnection(); });
  $('evm-disconnect').onclick = () => session.disconnect('Disconnected from Lenz. Remove site access in your wallet if needed.');
  $('evm-refresh').onclick = async () => { try { await session.refresh(); } catch {} };
  function renderReceiving(asset='native') {
    const snapshot = session.snapshot; if (!snapshot) return;
    const token=Object.hasOwn(WALLET_NETWORKS,snapshot.chainId)?transferAssets(snapshot.chainId).find(t=>t.id===asset):{id:'native',symbol:snapshot.network.symbol};if(!token)return;
    $('evm-receive-title').textContent = 'Receive on ' + snapshot.network.name;
    $('evm-receive-network').replaceChildren(assetLabel(token.symbol,{contract:token.id==='native'?null:token.id,network:snapshot.network.key,trusted:token.id==='native'&&Object.hasOwn(WALLET_NETWORKS,snapshot.chainId)}),document.createTextNode(' · '+snapshot.network.name));
    receive.querySelector(':scope>p.quiet').textContent='Public transfer. Use '+snapshot.network.name+' in the sending wallet.';
    $('evm-receive-address').textContent = snapshot.address; $('evm-receive-status').textContent = '';
    const uri=token.id==='native'?snapshot.receiveUri:`ethereum:${token.id}@${snapshot.network.id}/transfer?address=${snapshot.address}`;
    const qr = qrcode(0, 'M'); qr.addData(uri); qr.make();
    const canvas = $('evm-receive-qr'), count = qr.getModuleCount(), cell = 8, size = (count + 8) * cell;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#173f35';
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) ctx.fillRect((col + 4) * cell, (row + 4) * cell, cell, cell);
  }
  function openReceive(asset='native'){
    const snapshot=session.snapshot;if(!snapshot)return;
    if(Object.hasOwn(WALLET_NETWORKS,snapshot.chainId)?!transferAssets(snapshot.chainId).some(t=>t.id===asset):asset!=='native')return;
    receive.dataset.asset=asset;renderReceiving(asset);receive.showModal();
  }
  $('evm-receive').onclick=()=>openReceive();
  addEventListener('lenz-receiving-asset',event=>{if(receive.open)renderReceiving(event.detail);});
  $('evm-copy').onclick = async () => {
    const snapshot = session.snapshot; if (!snapshot || !receive.open) return;
    try { await navigator.clipboard.writeText(snapshot.address); if (session.snapshot === snapshot && receive.open) $('evm-receive-status').textContent = 'Address copied. Select ' + snapshot.network.name + ' when sending.'; }
    catch { $('evm-receive-status').textContent = 'Copy unavailable. Select the address above.'; }
  };
  addEventListener('offline', () => session.disconnect('Offline.'));
  addEventListener('online', () => session.disconnect('Connect your wallet to read its current account.'));
  addEventListener('pagehide', () => session.disconnect());
  // bfcache must not revive a provider session without a fresh account check.
  addEventListener('pageshow', event => { if (event.persisted) session.disconnect(); });
  if (!navigator.onLine) session.disconnect('Offline.');
  return {get snapshot(){return session.snapshot;},get discoveryConsent(){return discoveryConsent;},cancelPrivateRead:()=>privateAccount.cancelPending(),openSend:transfers.open,openReceive,openConnect:()=>{selection=null;openConnect();},readLendingAccount:()=>readLendingAccount(session.capture()),async checkAccount(expected){
    const lease=session.capture();check(lease.identity===expected,'Wallet changed.');
    const accounts=await lease.request('eth_accounts');check(Array.isArray(accounts)&&address(accounts[0])===expected.address,'Wallet account changed.');
    check(await lease.request('eth_chainId')===expected.chainId,'Wallet network changed.');lease.assertCurrent();
  }};
}
