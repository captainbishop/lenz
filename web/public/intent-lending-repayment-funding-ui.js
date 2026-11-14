import { iconButton } from './wallet-actions.js';

const check = (ok, reason) => { if (!ok) throw Error(reason); };
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
export function mountLendingRepaymentFundingUI(target, { config, getContext, run, refresh, route } = {}) {
  const section = document.createElement('section'); section.className = 'il-repayment-funding'; section.hidden = true;
  section.innerHTML = '<div class="il-review-heading"><h4>Repay test funds</h4><button type="button" data-irf="open"></button></div><p data-irf="copy" class="il-muted">A 1 USDC test grant can cover loan interest in your lending account.</p><section data-irf="review" class="il-receipt" aria-label="Review Repay test funds" hidden><h4>Get 1 test USDC</h4><dl><div><dt>Asset</dt><dd>Aave test USDC</dd></div><div><dt>Network</dt><dd>Sepolia testnet</dd></div><div><dt>Receive in</dt><dd>Your lending account</dd></div><div><dt>Network fee</dt><dd>Paid by the testnet sponsor</dd></div></dl><p>This faucet mint, recipient and amount are public. Test USDC has no cash value. One grant per owner and lending account.</p><details><summary>Funding details</summary><dl data-irf="details"></dl></details><button type="button" data-irf="confirm" class="il-primary">Confirm 1 test USDC</button><button type="button" data-irf="cancel">Cancel</button></section><button type="button" data-irf="check">Check Repay funding</button><button type="button" data-irf="resume" hidden>Resume original funding</button><p data-irf="status" class="il-muted" role="status" aria-live="polite"></p>';
  target.append(section); const $ = key => section.querySelector('[data-irf="' + key + '"]');
  iconButton($('open'), 'Get test USDC for Repay', 'M4 4h10v4h6v4h-6M8 4v4M4 20h16M10 12v5M6 8h8');
  let input = null, outcome = null, reviewing = false;
  function original() { const lease = getContext().account.capture(); lease.assertCurrent(); const identity = lease.identity; return { lease, input: { owner: identity.lenzIdentity, ownerAddress: identity.ownerAddress, account: identity.account } }; }
  function validate(value) {
    check(value && ['not-requested', 'pending', 'unknown', 'funded', 'failed'].includes(value.status) && Object.entries(input).every(([key, expected]) => value[key] === expected) && typeof value.grantId === 'string' && /^lending-repayment:[0-9a-f]{64}$/.test(value.grantId), 'The original Repay funding response changed.');
    if (value.status === 'funded') { const e = value.evidence; check(value.verified === true && e?.chainId === config.chain && e.asset === config.usdc && e.amount === '1000000' && e.faucet === config.faucet && hash(e.transactionHash) && hash(e.blockHash) && uint(e.blockNumber) && uint(e.balance) && hash(e.checkedBlockHash) && uint(e.checkedBlockNumber), 'The original test-USDC mint is not finalized.'); }
    else check(value.verified !== true, 'Unresolved Repay funding cannot be verified.'); return value;
  }
  async function step(operation, options) {
    $('status').textContent = operation === 'submit' ? 'Saving recovery before funding…' : operation === 'resume' ? 'Resuming the original funding transaction…' : 'Checking the original Repay funding…';
    const current = original(); if (!input) input = current.input;
    check(Object.entries(input).every(([key, value]) => current.input[key] === value), 'Return to the original Repay funding account.');
    if (operation !== 'reconcile') await current.lease.requireRecovery({ latest: true, ...options }); current.lease.assertCurrent();
    outcome = validate(await route.request('repayment-funding/' + operation, input, options)); options.signal?.throwIfAborted(); current.lease.assertCurrent(); reviewing = false;
    $('status').textContent = outcome.status === 'funded' ? '1 test USDC funding verified. Review Repay with your updated balance.' : outcome.status === 'failed' ? 'The original test-USDC grant failed. Its status is retained.' : outcome.status === 'not-requested' ? outcome.available ? 'Review the fixed grant before confirming.' : 'Repay funding is unavailable. Check the original sponsor request.' : outcome.resubmissionSafe ? 'Original funding is unresolved. Resume the same transaction or check again.' : 'Original funding is pending. Check its finalized status.';
    if (outcome.status === 'funded') await refresh(options); update(); return outcome;
  }
  function update() {
    const context = getContext(); if (!navigator.onLine || context.mode !== 'Repay') reviewing = false;
    section.hidden = route?.available !== true || context.mode !== 'Repay' || !context.account || !context.snapshot || !!context.review;
    const blocked = context.busy || !navigator.onLine;
    for (const button of section.querySelectorAll('button')) button.disabled = blocked;
    const noDebt = context.snapshot?.account?.position?.variableDebtBaseUnits === '0';
    $('copy').textContent = noDebt ? 'No outstanding debt. You can check any original Repay funding below.' : 'A 1 USDC test grant can cover loan interest in your lending account.';
    $('review').hidden = !reviewing; $('open').hidden = noDebt || reviewing || !!outcome && outcome.status !== 'not-requested' || outcome?.status === 'not-requested' && outcome.available !== true;
    $('resume').hidden = outcome?.resubmissionSafe !== true || reviewing;
    $('check').hidden = reviewing;
  }
  $('open').onclick = () => run(async options => {
    const value = await step('reconcile', options); if (value.status !== 'not-requested' || !value.available) return;
    reviewing = true; const details = $('details'); details.replaceChildren();
    for (const [name, text] of [['Recipient', input.account], ['Token', config.usdc], ['Faucet', config.faucet]]) { const row = document.createElement('div'), label = document.createElement('dt'), content = document.createElement('dd'); label.textContent = name; content.textContent = text; row.append(label, content); details.append(row); }
    update(); $('confirm').focus();
  });
  $('confirm').onclick = () => run(async options => { check(reviewing && outcome?.status === 'not-requested' && outcome.available, 'Review the fixed original Repay grant first.'); await step('submit', options); });
  $('check').onclick = () => run(options => step('reconcile', options));
  $('resume').onclick = () => run(options => step('resume', options));
  $('cancel').onclick = () => { reviewing = false; $('status').textContent = ''; update(); };
  return Object.freeze({ update, reset() { input = null; outcome = null; reviewing = false; $('status').textContent = ''; update(); }, dispose() { section.remove(); } });
}
