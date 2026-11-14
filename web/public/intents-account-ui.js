import { createIntentsAccount } from './intents-account.js';
import { walletAmount } from './wallet-visibility.js';
import { receiveAssets, receiveChain } from './receive-assets.js';
import { iconButton } from './wallet-actions.js';
import { assetIcon } from './asset-icon.js';

const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
function amount(units, decimals) {
  const value = units.padStart(decimals + 1, '0');
  if (!decimals) return value;
  const fraction = value.slice(-decimals).replace(/0+$/, '');
  return value.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
export function mountIntentsAccount(session, host) {
  const section = el('section'); section.id = 'wallet-private-balances'; section.className = 'wallet-private-balances';
  section.innerHTML = '<div class="section-heading"><h2>Lenz funds</h2><button id="private-refresh" type="button" class="secondary" hidden></button></div><p id="private-intro" class="quiet">Sign in with your wallet to check Lenz funds. This gives no permission to spend.</p><p class="quiet">The transfer provider can see your wallet address, sign-in signature and balances.</p><p id="private-account" class="quiet"></p><div class="private-actions"><button id="private-connect" type="button">Check Lenz funds</button><button id="private-disconnect" type="button" class="secondary" hidden>Sign out</button></div><p id="private-status" class="quiet" role="status" aria-atomic="true"></p><dl id="private-values" hidden></dl><p id="private-observed" class="quiet"></p><details><summary>Account access details</summary><p>Your sign-in lasts only while this page stays open.</p><p>NEAR Intents reports these balances. Lenz has not independently verified arrival, and these funds cannot be spent offline. Signing out closes access on this page; access already issued by the provider stays valid until it expires.</p></details>';
  host.append(section); const $ = id => section.querySelector('#' + id);
  iconButton($('private-refresh'), 'Refresh Lenz funds', 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
  let client = null, controller = null, version = 0, busy = false, authenticated = false;
  function clearValues() { $('private-values').replaceChildren(); $('private-values').hidden = true; $('private-observed').textContent = ''; }
  function controls() {
    $('private-intro').hidden = authenticated;
    $('private-connect').hidden = authenticated;
    $('private-connect').disabled = busy || !navigator.onLine || !session.snapshot;
    $('private-refresh').hidden = !authenticated; $('private-refresh').disabled = busy;
    $('private-disconnect').hidden = !client;
    $('private-disconnect').textContent = busy ? 'Cancel' : 'Sign out';
    $('private-account').textContent = session.snapshot?.address ?? '';
  }
  function reset(message = '') {
    version++; controller?.abort(); controller = null; client?.disconnect(); client = null;
    busy = authenticated = false; clearValues(); controls();
    $('private-status').textContent = !navigator.onLine ? 'Go online to check your Lenz funds.' : message || (session.snapshot ? '' : 'Connect your wallet first.');
  }
  async function checkWallet(lease, signal) {
    lease.assertCurrent(); signal.throwIfAborted();
    const accounts = await lease.request('eth_accounts'), chain = await lease.request('eth_chainId');
    lease.assertCurrent(); signal.throwIfAborted();
    if (accounts?.[0]?.toLowerCase() !== lease.identity.address || chain !== lease.identity.chainId) {
      session.disconnect('Wallet changed. Reconnect to continue.');
      throw Error('Wallet changed. Reconnect to continue.');
    }
  }
  async function read(signIn) {
    if (busy || !session.snapshot || !navigator.onLine) return;
    const ticket = ++version, lease = session.capture();
    if (signIn) {
      controller?.abort(); client?.disconnect(); controller = new AbortController();
      const signal = controller.signal;
      client = createIntentsAccount({ address: lease.identity.address,
        signMessage: text => { lease.assertCurrent(); signal.throwIfAborted(); $('private-status').textContent = 'Confirm account access in your wallet…'; return lease.signIntentsAuthentication(text, {signal}); } });
    }
    const active = client, signal = controller.signal;
    busy = true; clearValues(); controls(); $('private-status').textContent = signIn ? 'Preparing wallet sign-in…' : 'Checking your Lenz funds…';
    try {
      await checkWallet(lease, signal);
      if (signIn) await active.connect();
      await checkWallet(lease, signal);
      const result = await active.readBalances();
      await checkWallet(lease, signal);
      let tokens = [];
      if (result.balances.length) {
        try {
          const response = await fetch('/api/receive/assets', { cache:'no-store', credentials:'omit', redirect:'error', signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]) });
          if (response.ok) tokens = receiveAssets((await response.json()).tokens);
        } catch { /* Unknown assets retain their exact base units. */ }
      }
      await checkWallet(lease, signal);
      if (ticket !== version) return;
      authenticated = true;
      for (const balance of result.balances) {
        const token = tokens.find(t => t.assetId === balance.tokenId), term = el('dt'), value = el('dd');
        const label = el('strong', token ? token.symbol + ' · ' + receiveChain(token.blockchain) : 'Unlisted asset');
        if (token) {
          const nativeEth = token.assetId === 'nep141:eth.omft.near' && token.blockchain === 'eth' && token.symbol === 'ETH' && token.decimals === 18;
          label.className = 'asset-label'; label.prepend(assetIcon({symbol:token.symbol,contract:token.contractAddress,network:token.blockchain,trusted:nativeEth}));
        }
        term.append(label, el('small', balance.tokenId));
        value.append(walletAmount(el('span'), token ? amount(balance.available, token.decimals) : balance.available));
        if (!token) value.append(el('small', 'base units · decimals unavailable'));
        $('private-values').append(term, value);
      }
      $('private-values').hidden = !result.balances.length;
      $('private-observed').textContent = 'Read ' + new Date(result.observedAt).toLocaleTimeString() + ' · Reported balance · Unavailable offline';
      $('private-status').textContent = result.balances.length ? 'Lenz funds checked.' : 'No Lenz funds reported for this wallet.';
    } catch (error) {
      if (ticket !== version) return;
      reset(error?.status === 401 ? 'Session expired. Sign in again.' : error instanceof Error ? error.message.slice(0,220) : 'Could not check Lenz funds. Try again.');
    } finally { if (ticket === version) { busy = false; controls(); } }
  }
  $('private-connect').onclick = () => read(true);
  $('private-refresh').onclick = () => read(false);
  $('private-disconnect').onclick = () => reset(busy ? 'Cancelled here. Dismiss any open request in your wallet.' : 'Signed out here.');
  addEventListener('offline', () => reset()); addEventListener('pagehide', () => reset());
  addEventListener('pageshow', event => { if (event.persisted) reset(); });
  reset(); return { reset, cancelPending() { if (busy) reset('Cancelled here. Dismiss any open request in your wallet.'); } };
}
