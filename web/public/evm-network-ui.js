import { WALLET_NETWORKS, NETWORK_STORAGE_KEY } from './evm-networks.js';
import { iconButton } from './wallet-actions.js';
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
export function mountNetworkControls(session, store, connect) {
  const $ = id => document.getElementById(id), button = el('button', 'Networks');
  button.id = 'evm-networks'; button.type = 'button'; button.className = 'secondary'; $('wallet-settings-actions').append(button);
  const dialog = el('dialog'); dialog.id = 'evm-network-dialog'; dialog.setAttribute('aria-labelledby', 'evm-network-title');
  dialog.innerHTML = '<div class="dialog-top"><h2 id="evm-network-title">Networks</h2><button id="evm-network-close" type="button" class="secondary wallet-close"></button></div><div id="evm-network-choices" aria-label="Network"></div><div id="evm-network-detail" hidden><dl id="evm-network-facts"></dl><p id="evm-network-limit" class="quiet"></p><label id="evm-network-consent-label" class="check" hidden><input id="evm-network-consent" type="checkbox">Share this RPC with my wallet. Its network provider can see my address and requests.</label><div class="evm-network-actions"><button id="evm-network-use" type="button">Use in wallet</button><button id="evm-network-remove" type="button" class="secondary" hidden>Remove</button></div></div><button id="evm-network-new" type="button" class="secondary">Add custom network</button><form id="evm-network-form" hidden><div class="evm-network-fields"><label>Name<input id="evm-custom-name" name="name" maxlength="48" required autocomplete="off"></label><label>Chain ID<input id="evm-custom-chainId" name="chainId" required autocomplete="off" spellcheck="false"></label><label class="evm-rpc-field">RPC URL<input id="evm-custom-rpcUrl" name="rpcUrl" type="url" maxlength="512" required autocomplete="off" spellcheck="false" placeholder="https://"></label><label>Currency symbol<input id="evm-custom-symbol" name="symbol" maxlength="11" required autocomplete="off"></label><label>Decimals<input id="evm-custom-decimals" name="decimals" type="number" min="0" max="36" step="1" value="18" required></label></div><p class="quiet">Saved in this browser. Use a public RPC without API keys. Saving makes no connection.</p><div class="evm-network-actions"><button id="evm-network-save" type="submit">Save network</button><button id="evm-network-cancel" type="button" class="secondary">Cancel</button></div></form><p id="evm-network-status" class="wallet-feedback" role="status" tabindex="-1"></p>';
  document.body.append(dialog); iconButton($('evm-network-close'), 'Close', 'm6 6 12 12M18 6 6 18');
  let selected = null, busy = false, version = 0;
  const feedback = message => { $('evm-network-status').textContent = message; };
  function controls() {
    $('evm-network-use').disabled = busy || session.pending || !navigator.onLine || !selected || (selected.custom && !$('evm-network-consent').checked);
    $('evm-network-remove').disabled = busy || session.pending;
    $('evm-network-save').disabled = busy;
    $('evm-network-form').querySelectorAll('input').forEach(n => { n.disabled = busy; });
    $('evm-network-new').disabled = busy || session.pending;
    $('evm-network-choices').querySelectorAll('button').forEach(n => { n.disabled = busy || session.pending; });
  }
  function select(network, id) {
    selected = { ...network, chainId: id }; $('evm-network-consent').checked = false;
    $('evm-network-detail').hidden = false;
    const facts = $('evm-network-facts'); facts.replaceChildren();
    for (const [label, value] of [['Chain ID', network.id], ['Currency', network.symbol + ' · ' + network.decimals + ' decimals'], ...(network.custom ? [['RPC URL', network.rpcUrl]] : [])]) {
      const row = el('div'); row.append(el('dt', label), el('dd', value)); facts.append(row);
    }
    $('evm-network-limit').textContent = network.custom ? 'Balance and Receive only. Send and DeFi are unavailable on custom networks. Check these details with the network’s official source.' : 'Confirm the network change in your wallet. Assets stay on their current chain.';
    $('evm-network-consent-label').hidden = !network.custom; $('evm-network-remove').hidden = !network.custom;
    $('evm-network-choices').querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.chain === id)));
    feedback(''); controls();
  }
  function render() {
    const choices = $('evm-network-choices'); choices.replaceChildren(); selected = null; $('evm-network-detail').hidden = true;
    const builtins = Object.entries(WALLET_NETWORKS).map(([id, n]) => [id, n]);
    let customs = []; try { customs = store.list().map(n => [n.chainId, n]); } catch { feedback('Saved networks are unavailable. Built-in networks still work.'); }
    for (const [id, n] of [...builtins, ...customs]) {
      const choice = el('button'); choice.type = 'button'; choice.className = 'evm-network-choice secondary'; choice.dataset.chain = id; choice.setAttribute('aria-pressed', 'false');
      const name = el('span', n.name), detail = el('small', 'Chain ' + n.id + (n.custom ? ' · Custom' : '') + (session.snapshot?.chainId === id ? ' · Connected' : ''));
      choice.append(name, detail); choice.onclick = () => select(n, id); choices.append(choice);
    }
    controls();
  }
  button.onclick = () => { document.querySelector('.wallet-settings').open = false; version++; feedback(''); $('evm-network-form').hidden = true; $('evm-network-choices').hidden = false; $('evm-network-new').hidden = false; render(); dialog.showModal(); };
  function cancel() { version++; if (busy && session.pending) session.disconnect('Network change cancelled here. Check your wallet for any open request.'); }
  $('evm-network-close').onclick = () => { cancel(); dialog.close(); };
  dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', () => { if (!dialog.open) cancel(); });
  $('evm-network-consent').onchange = () => { if (busy && !$('evm-network-consent').checked) cancel(); controls(); };
  $('evm-network-use').onclick = async () => {
    if ($('evm-network-use').disabled) return;
    const choice = selected, addConsent = $('evm-network-consent').checked;
    const expectedNetwork = choice.custom ? choice : null;
    if (!session.snapshot) { dialog.close(); connect({ chainId: choice.chainId, addConsent, expectedNetwork }); return; }
    const ticket = ++version; busy = true; controls(); feedback('Confirm the network in your wallet…');
    try { await session.switchNetwork(choice.chainId, { addConsent, expectedNetwork }); if (ticket === version) dialog.close(); }
    catch (error) { if (ticket === version) feedback($('evm-status').textContent || error.message); }
    finally { busy = false; controls(); }
  };
  $('evm-network-remove').onclick = async () => {
    if (!selected?.custom || busy || session.pending) return;
    const id = selected.chainId, ticket = ++version; busy = true; controls();
    try { await store.remove(id); if (session.snapshot?.chainId === id) session.disconnect('Network removed from Lenz.'); if (ticket === version) { render(); feedback('Removed from Lenz. Your wallet’s settings are unchanged.'); } }
    catch { if (ticket === version) feedback('Network could not be removed. Try again.'); }
    finally { busy = false; controls(); }
  };
  $('evm-network-new').onclick = () => {
    selected = null; feedback(''); $('evm-network-form').reset(); $('evm-network-form').hidden = false;
    $('evm-network-form').querySelectorAll('input').forEach(n => { n.setCustomValidity(''); n.removeAttribute('aria-invalid'); });
    $('evm-network-detail').hidden = $('evm-network-choices').hidden = $('evm-network-new').hidden = true; $('evm-custom-name').focus();
  };
  $('evm-network-cancel').onclick = () => { version++; $('evm-network-form').hidden = true; $('evm-network-choices').hidden = $('evm-network-new').hidden = false; feedback(''); render(); };
  for (const input of $('evm-network-form').querySelectorAll('input')) input.addEventListener('input', () => { input.setCustomValidity(''); input.removeAttribute('aria-invalid'); feedback(''); });
  $('evm-network-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const input = Object.fromEntries(new FormData(event.target)); input.decimals = Number(input.decimals);
    const ticket = ++version; busy = true; controls();
    try { await store.add(input); if (ticket !== version || !dialog.open) return;
      $('evm-network-form').hidden = true; $('evm-network-choices').hidden = $('evm-network-new').hidden = false; render();
      const network = store.get(input.chainId); select(network, network.chainId); feedback('Saved. Select Use in wallet to connect.');
    } catch (error) { if (ticket === version && dialog.open) {
      feedback(error.field ? error.message : 'Network could not be saved. Check browser storage and try again.');
      const field = error.field && $('evm-custom-' + error.field);
      if (field) { field.setCustomValidity(error.message); field.setAttribute('aria-invalid', 'true'); field.reportValidity(); }
      else $('evm-network-status').focus();
    } } finally { busy = false; controls(); }
  };
  addEventListener('lenz-evm-session', controls);
  addEventListener('storage', event => { if (event.key === NETWORK_STORAGE_KEY || event.key === null) { version++; session.disconnect('Network settings changed in another tab. Reconnect.'); if (dialog.open) { feedback(''); render(); } } });
  addEventListener('offline', () => { version++; controls(); feedback('Offline. Saved networks remain available.'); });
  addEventListener('online', controls);
}
