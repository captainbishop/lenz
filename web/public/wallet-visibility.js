// Display preference only; balances and payment authorizations are unchanged.
const key = 'lenz-wallet-balances-hidden', values = new WeakMap();
const readPreference = () => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };
let hidden = readPreference();
function paint(node) {
  const { value, masked } = values.get(node);
  node.textContent = hidden ? masked : value;
  if (hidden) { node.setAttribute('role', 'img'); node.setAttribute('aria-label', 'Amount hidden'); }
  else { node.removeAttribute('role'); node.removeAttribute('aria-label'); }
}
export function walletAmount(node, value, masked = '••••') {
  values.set(node, { value, masked }); node.dataset.walletAmount = ''; paint(node); return node;
}
function refresh() {
  document.querySelectorAll('[data-wallet-amount]').forEach(node => { if (values.has(node)) paint(node); });
  const button = document.querySelector('#toggle-balances');
  if (!button) return;
  button.setAttribute('aria-pressed', String(hidden));
  button.setAttribute('aria-label', hidden ? 'Show balances' : 'Hide balances');
  button.title = hidden ? 'Show balances' : 'Hide balances';
  button.querySelector('[data-eye-open]').hidden = hidden;
  button.querySelector('[data-eye-closed]').hidden = !hidden;
}
export function setupBalanceVisibility() {
  document.querySelector('#toggle-balances').onclick = () => {
    hidden = !hidden;
    try { localStorage.setItem(key, String(hidden)); } catch { /* Keep the choice for this tab when storage is unavailable. */ }
    refresh();
  };
  addEventListener('storage', event => { if (event.key === key || event.key === null) { hidden = readPreference(); refresh(); } });
  refresh();
}
