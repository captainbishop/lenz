import { getAddress } from './evm-vendor/address.js';
import { LENDING_TESTNET } from './intent-lending-config.js';
import { iconButton } from './wallet-actions.js';

const check = (ok, message) => { if (!ok) throw Error(message); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const assets = [{ symbol: 'LINK', decimals: 18, balance: 'freeLinkBaseUnits' }, { symbol: 'USDC', decimals: 6, balance: 'freeUsdcBaseUnits' }];
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let instances = 0;
function display(value, decimals) {
  const padded = value.padStart(decimals + 1, '0'), fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}

export function mountLendingTransferUI(host, { getContext, refresh } = {}) {
  check(host instanceof HTMLElement && typeof getContext === 'function' && typeof refresh === 'function', 'Open the lending account before sending.');
  const prefix = 'lending-send-' + ++instances, root = el('section'); root.className = 'lending-send'; root.setAttribute('aria-label', 'Available lending funds');
  root.innerHTML = '<h4>Available to send</h4><dl data-lt="balances"></dl><button type="button" data-lt="open" aria-label="Send from lending account">Send</button>';
  host.append(root);
  const dialog = el('dialog'); dialog.className = 'lending-send-dialog'; dialog.setAttribute('aria-labelledby', prefix + '-title');
  dialog.innerHTML = `<div class="lt-heading"><h2 id="${prefix}-title">Send from lending account</h2><button type="button" data-lt="close"></button></div>
    <form data-lt="form" novalidate><label for="${prefix}-recipient">Recipient address</label><input id="${prefix}-recipient" name="lending-send-recipient" data-lt="recipient" type="text" autocomplete="off" spellcheck="false" maxlength="42" aria-describedby="${prefix}-recipient-error" placeholder="0x…"><p id="${prefix}-recipient-error" data-lt="recipient-error" class="lt-error" aria-live="polite"></p>
    <fieldset><legend>Asset · Sepolia testnet</legend><div class="lt-assets"><button type="button" data-lt="link">LINK</button><button type="button" data-lt="usdc">USDC</button></div></fieldset>
    <label for="${prefix}-amount">Amount</label><div class="lt-amount"><input id="${prefix}-amount" name="lending-send-amount" data-lt="amount" type="text" inputmode="decimal" autocomplete="off" maxlength="50" aria-describedby="${prefix}-amount-error" placeholder="0"><strong data-lt="symbol"></strong></div><p data-lt="available" class="lt-muted"></p><p id="${prefix}-amount-error" data-lt="amount-error" class="lt-error" aria-live="polite"></p><button type="submit" data-lt="review" class="lt-primary">Review Send</button></form>
    <section data-lt="receipt" hidden aria-label="Review Send"><div class="lt-heading"><h3 data-lt="title"></h3><button type="button" data-lt="edit"></button></div><dl data-lt="terms"></dl><p class="lt-muted">The amount, sender and recipient are public.</p><button type="button" data-lt="confirm" class="lt-primary">Confirm Send</button></section><p data-lt="status" class="lt-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog); const style = el('link'); style.rel = 'stylesheet'; style.href = '/intent-lending-transfer-ui.css'; document.head.append(style);
  const $ = name => dialog.querySelector('[data-lt="' + name + '"]'), trigger = root.querySelector('[data-lt="open"]');
  iconButton($('close'), 'Close Send', 'm6 6 12 12M18 6 6 18'); iconButton($('edit'), 'Edit Send', 'M14 5l5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z');
  let selected = 0, review = null, busy = false, disposed = false, generation = 0, controller = null, focusAfter = null;
  function context() {
    const { account, service, snapshot } = getContext() ?? {};
    check(account && service && snapshot, 'Open your lending account to check available funds.');
    const lease = account.capture(), identity = lease.identity, position = snapshot.account?.position;
    check(identity.deployed && identity.chainId === LENDING_TESTNET.chain && snapshot.chainId === identity.chainId && snapshot.account?.status === 'verified' && snapshot.account.owner === identity.ownerAddress && snapshot.account.address === identity.account && snapshot.block?.finality === 'finalized' && snapshot.block.requireCanonical === true && assets.every(asset => uint(position?.[asset.balance])), 'Refresh your lending account to check available funds.');
    return { account, service, snapshot, lease, identity, position, blocked: getContext().busy === true };
  }
  function current(original, ticket, signal) {
    signal.throwIfAborted(); original.lease.assertCurrent();
    check(!disposed && ticket === generation && getContext()?.account === original.account && getContext()?.service === original.service, 'The original lending account changed.');
  }
  function line(target, label, value) { const row = el('div'); if (label === 'Recipient') row.className = 'lt-recipient'; row.append(el('dt', label), el('dd', value)); target.append(row); }
  function paint() {
    if (disposed) return;
    let value; try { value = context(); } catch {}
    root.hidden = !value; const balances = root.querySelector('[data-lt="balances"]'); balances.replaceChildren();
    if (value) for (const asset of assets) line(balances, asset.symbol, display(value.position[asset.balance], asset.decimals));
    trigger.disabled = busy || value?.blocked || !navigator.onLine || !value || assets.every(asset => value.position[asset.balance] === '0');
    dialog.setAttribute('aria-busy', String(busy));
    for (const button of dialog.querySelectorAll('button')) button.disabled = busy;
    $('close').disabled = false; $('review').disabled = busy || !navigator.onLine; $('confirm').disabled = busy || !navigator.onLine;
    for (const input of dialog.querySelectorAll('input')) input.readOnly = busy;
    $('link').setAttribute('aria-pressed', String(selected === 0)); $('usdc').setAttribute('aria-pressed', String(selected === 1));
    const asset = assets[selected]; $('symbol').textContent = asset.symbol; $('available').textContent = value ? 'Available · ' + display(value.position[asset.balance], asset.decimals) + ' ' + asset.symbol : 'Refresh your account to check available funds.';
    $('form').hidden = !!review; $('receipt').hidden = !review;
    if (review) {
      const terms = review.terms, approvedAsset = assets[terms.asset]; $('title').textContent = 'Send ' + display(terms.amount, approvedAsset.decimals) + ' ' + approvedAsset.symbol;
      $('terms').replaceChildren(); line($('terms'), 'From', 'Your lending account'); line($('terms'), 'Recipient', terms.recipient); line($('terms'), 'Network', 'Sepolia testnet'); line($('terms'), 'Network fee', 'Paid by the testnet sponsor'); line($('terms'), 'Permission ends', new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(Number(terms.deadline) * 1000));
    }
  }
  function clearErrors() { for (const name of ['recipient', 'amount']) { $(name).removeAttribute('aria-invalid'); $(name + '-error').textContent = ''; } }
  function field(ok, name, message) { if (!ok) { $(name).setAttribute('aria-invalid', 'true'); $(name + '-error').textContent = message; $(name).focus(); throw Error(message); } }
  async function run(operation) {
    if (busy || disposed) return; const ticket = generation, c = new AbortController(); controller = c; busy = true; $('status').textContent = ''; clearErrors(); paint();
    try { await operation({ ticket, signal: c.signal }); }
    catch (error) { if (!disposed && ticket === generation && !c.signal.aborted) $('status').textContent = error.message; }
    finally { if (!disposed && ticket === generation) { busy = false; controller = null; paint(); focusAfter?.focus(); focusAfter = null; } }
  }
  async function noPending(value, ticket, signal) {
    const rows = await value.service.pending(); current(value, ticket, signal);
    check(!rows.some(row => row.review.terms.nonce === value.identity.nonce && row.outcome?.status !== 'executed'), 'Check the original request in Activity before approving another Send.');
  }
  function close() { generation++; controller?.abort(); controller = null; busy = false; review = null; focusAfter = null; if (dialog.open) dialog.close(); paint(); }
  trigger.onclick = () => { review = null; $('status').textContent = ''; clearErrors(); paint(); dialog.showModal(); if (matchMedia('(pointer:fine)').matches) $('recipient').focus(); };
  $('close').onclick = close; dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  for (const [index, name] of ['link', 'usdc'].entries()) $(name).onclick = () => { selected = index; review = null; clearErrors(); paint(); };
  $('edit').onclick = () => { review = null; paint(); $('recipient').focus(); };
  $('form').onsubmit = event => { event.preventDefault(); void run(async ({ ticket, signal }) => {
    const original = context(), asset = assets[selected], raw = $('recipient').value.trim(); let recipient;
    try { if (/^0x[0-9a-fA-F]{40}$/.test(raw) && !/^0x0{40}$/.test(raw)) recipient = getAddress(raw).toLowerCase(); } catch {}
    field(!!recipient, 'recipient', 'Enter a valid recipient wallet address.'); field(recipient !== original.identity.account, 'recipient', 'Use a recipient different from your lending account.');
    const input = $('amount').value.trim(); field(new RegExp('^(?:0|[1-9][0-9]{0,30})(?:\\.[0-9]{1,' + asset.decimals + '})?$').test(input), 'amount', 'Enter an amount with at most ' + asset.decimals + ' decimal places.');
    const [whole, fraction = ''] = input.split('.'), amount = BigInt(whole) * 10n ** BigInt(asset.decimals) + BigInt(fraction.padEnd(asset.decimals, '0')); field(amount > 0n, 'amount', 'Enter a positive amount.');
    await refresh({ signal }); current(original, ticket, signal); const value = context();
    field(amount <= BigInt(value.position[asset.balance]), 'amount', 'Choose an amount within the available balance.'); await noPending(value, ticket, signal);
    const prepared = await value.service.prepare({ kind: 'Transfer', terms: { asset: selected, nonce: value.identity.nonce, deadline: String(Math.floor(Date.now() / 1000) + 300), amount: amount.toString(), recipient } }, { signal }); current(value, ticket, signal);
    review = prepared; focusAfter = $('confirm'); paint();
  }); };
  $('confirm').onclick = () => run(async ({ ticket, signal }) => {
    check(review, 'Review Send before confirming.'); const original = context(), approved = review;
    await refresh({ signal }); current(original, ticket, signal); const value = context();
    check(approved.account === value.identity.account && approved.terms.nonce === value.identity.nonce && BigInt(approved.terms.amount) <= BigInt(value.position[assets[approved.terms.asset].balance]), 'Available funds changed. Edit and review Send again.');
    await noPending(value, ticket, signal); review = null;
    try {
      await value.service.approve(approved, { signal }); current(value, ticket, signal);
      const outcome = await value.service.submit(approved.id, { signal }); current(value, ticket, signal);
      $('status').textContent = outcome.verified ? 'Send confirmed. Its result is saved in Activity.' : 'Send submitted. Check the original request in Activity.';
    } finally {
      // Approval can be retained even if its response is lost; expose that original request in Activity.
      if (!signal.aborted && ticket === generation) await refresh({ signal }).catch(() => {});
    }
  });
  const connectivity = () => { review = null; if (!navigator.onLine) { controller?.abort(); $('status').textContent = 'Offline. Approved requests remain saved in Activity.'; } paint(); };
  addEventListener('online', connectivity); addEventListener('offline', connectivity); paint();
  return Object.freeze({ update: paint, get busy() { return busy; }, cancel: close, reset() { close(); $('recipient').value = ''; $('amount').value = ''; $('status').textContent = ''; selected = 0; clearErrors(); }, dispose() { close(); disposed = true; root.remove(); dialog.remove(); style.remove(); removeEventListener('online', connectivity); removeEventListener('offline', connectivity); } });
}
