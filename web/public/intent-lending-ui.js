import { readState } from './chat-store.js';
import { createLendingOwnedAccount, lendingPermissionDigest } from './intent-lending-account.js';
import { createLendingIntentService } from './intent-lending-route.js';
import { LENDING_TESTNET, LENDING_PRIVACY } from './intent-lending-config.js';
import { iconButton } from './wallet-actions.js';
import { mountLendingTransferUI } from './intent-lending-transfer-ui.js';
import { mountLendingRepaymentFundingUI } from './intent-lending-repayment-funding-ui.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const check = (ok, reason) => { if (!ok) throw Error(reason); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const wad = 10n ** 18n, ray = 10n ** 27n, year = 31536000n;
const ceil = (value, divisor) => (value + divisor - 1n) / divisor;
function debtLimit(action, amount, debt, rate, reserve, block, deadline) {
  check(uint(reserve.normalizedVariableDebtRay) && BigInt(reserve.normalizedVariableDebtRay) >= ray && uint(block.timestamp) && BigInt(block.timestamp) <= deadline, 'The finalized debt index and observation time are unavailable.');
  const principal = action === 0 ? debt + amount : debt;
  if (!principal) return 0n;
  const seconds = deadline - BigInt(block.timestamp), perSecond = ceil(rate, year), square = ceil(perSecond * perSecond, ray), cube = ceil(square * perSecond, ray);
  const growth = perSecond * seconds + square * seconds * (seconds > 0n ? seconds - 1n : 0n) / 2n + cube * seconds * (seconds > 1n ? seconds - 1n : 0n) * (seconds > 2n ? seconds - 2n : 0n) / 6n;
  const futureIndex = ceil(BigInt(reserve.normalizedVariableDebtRay) * (ray + growth), ray), bounded = principal + ceil(principal * growth, ray) + 2n * ceil(futureIndex, ray) + 2n;
  return action === 1 ? (bounded > amount ? bounded - amount : 0n) : bounded;
}
function units(value, decimals) {
  check(typeof value === 'string' && new RegExp('^(?:0|[1-9][0-9]{0,30})(?:\\.[0-9]{1,' + decimals + '})?$').test(value), 'Enter a positive amount with at most ' + decimals + ' decimal places.');
  const [whole, fraction = ''] = value.split('.'), amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  check(amount > 0n && amount < 2n ** 256n - 1n, 'Enter a positive amount.'); return amount;
}
function display(value, decimals) {
  if (!uint(value)) return '—'; const digits = value.padStart(decimals + 1, '0');
  return digits.slice(0, -decimals) + (digits.slice(-decimals).replace(/0+$/, '') ? '.' + digits.slice(-decimals).replace(/0+$/, '') : '');
}
const percentage = rate => display((BigInt(rate) * 100n).toString(), 27);
const actions = ['Supply', 'Borrow', 'Repay', 'Withdraw'];

export function mountLendingIntentUI(target, { config = LENDING_TESTNET, read = readState, createAccount = createLendingOwnedAccount, account: suppliedAccount, service: suppliedService, readSnapshot, setupAccount, supply = null, repaymentFunding = null, now = Date.now } = {}) {
  check(target instanceof HTMLElement, 'Choose the lending workspace.');
  const style = el('link'); style.rel = 'stylesheet'; style.href = '/intent-lending-ui.css'; document.head.append(style);
  const root = el('section', undefined, 'intent-lending'); root.setAttribute('aria-label', 'Aave testnet account');
  root.innerHTML = `<div class="il-heading"><div><h3>Aave V3</h3><span>Sepolia testnet</span></div><button type="button" data-il="refresh"></button></div>
    <div class="il-layout"><div class="il-position"><dl data-il="position"></dl><p data-il="observed" class="il-muted"></p><button type="button" data-il="open">Open lending account</button><section data-il="setup-review" class="il-setup-review" hidden aria-label="Review account setup"><h4>Set up lending account</h4><p>Your Lenz backup words recover this account.</p><dl><div><dt>Network</dt><dd>Sepolia testnet</dd></div><div><dt>Network fee</dt><dd>Paid by the testnet sponsor</dd></div></dl><p>The account and its positions are public.</p><button type="button" data-il="setup-confirm" class="il-primary">Confirm account setup</button></section><a class="il-wallet" href="/money.html">Wallet &amp; recovery</a><details><summary>Account details</summary><dl data-il="accounts"></dl></details></div>
    <div class="il-work"><nav aria-label="Lending actions" data-il="actions"></nav><p data-il="unavailable" class="il-muted"></p><form data-il="form" hidden><label class="il-amount-label" for="il-amount">Amount</label><div class="il-amount"><input id="il-amount" data-il="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" maxlength="50" required><strong data-il="asset"></strong></div><p data-il="balance" class="il-muted"></p>
      <dl class="il-bounds"><div data-il="health-row"><dt><label for="il-health">Minimum safety ratio</label></dt><dd><input id="il-health" data-il="health" inputmode="decimal" value="2" maxlength="20" aria-describedby="il-health-help"></dd></div><div data-il="rate-row"><dt><label for="il-rate">Maximum borrow APR</label></dt><dd><input id="il-rate" data-il="rate" inputmode="decimal" maxlength="50"><span>%</span></dd></div></dl><p id="il-health-help" class="il-muted">Below 1, collateral can be sold to repay the loan.</p><button type="submit" class="il-primary" data-il="review">Review Borrow</button></form>
      <section data-il="receipt" class="il-receipt" hidden aria-label="Review lending permission"><div class="il-review-heading"><h4 data-il="review-title"></h4><button type="button" data-il="edit"></button></div><dl data-il="terms"></dl><p data-il="permission-copy" class="il-muted">The lending account, amounts and loan are public.</p><button type="button" data-il="confirm" class="il-primary"></button></section><button data-il="supply" class="il-primary" type="button" hidden>Review private Supply</button></div></div>
    <p data-il="status" class="il-status" role="status" aria-live="polite"></p><section class="il-activity"><h4>Activity</h4><ul data-il="activity"></ul><p data-il="empty" class="il-muted">No approved lending requests.</p></section><details class="il-privacy"><summary>Privacy &amp; recovery</summary><p></p><p>Keep your Lenz backup words. Approved requests remain saved when connectivity is lost. Check the original request after reconnecting.</p></details>`;
  target.append(root); root.querySelector('.il-privacy p').textContent = LENDING_PRIVACY;
  const $ = key => root.querySelector('[data-il="' + key + '"]');
  const setupStatus = el('p', '', 'il-status'); setupStatus.dataset.il = 'setup-status'; setupStatus.hidden = true; setupStatus.setAttribute('role', 'status'); setupStatus.setAttribute('aria-live', 'polite'); $('open').after(setupStatus);
  $('form').noValidate = true;
  for (const name of ['amount', 'health', 'rate']) { const input = $(name), error = el('p', '', 'il-field-error'); input.name = 'lending-' + name; input.autocomplete = 'off'; input.spellcheck = false; error.id = 'il-' + name + '-error'; error.dataset.il = name + '-error'; error.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' ')); (name === 'amount' ? input.closest('.il-amount') : input.closest('[data-il="' + name + '-row"]')).after(error); }
  iconButton($('refresh'), 'Refresh lending account', 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
  iconButton($('edit'), 'Edit lending request', 'M14 5l5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z');
  let account = suppliedAccount ?? null, service = suppliedService ?? null, identity = null, snapshot = null, execution = false, mode = 'Supply', review = null, cancellationOriginal = null, busy = false, disposed = false, generation = 0, controller = null, setupPending = false, setupReview = false, setupFeedback = false;
  const transfer = mountLendingTransferUI(root.querySelector('.il-position'), { getContext: () => ({ account, service, snapshot, busy }), refresh });
  const repayFunding = mountLendingRepaymentFundingUI(root.querySelector('.il-work'), { config, getContext: () => ({ account, snapshot, busy, mode, review, enabled: execution }), run, refresh, route: repaymentFunding });
  async function fetchSnapshot(selection, { signal } = {}) {
    if (readSnapshot) return readSnapshot(selection, { signal });
    const response = await fetch('/api/intents/lending/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection), cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const raw = await response.text(); check(raw.length <= 200000, 'The lending snapshot is too large.');
    const value = JSON.parse(raw); check(response.ok, value.error ?? 'The lending snapshot is unavailable.'); return value;
  }
  function checkedSnapshot(value, owner) {
    check(value?.chainId === config.chain && value.block?.finality === 'finalized' && value.block.requireCanonical === true && uint(value.block.number) && value.routeVerified === true && value.trust?.executionPinsVerified === true && value.trust.codePinsVerified === true && value.trust.implementationPinsVerified === true, 'The testnet lending route is awaiting verification.');
    check(value.account?.owner === owner && ['verified', 'undeployed'].includes(value.account.status) && value.account.route?.factory === config.lendingFactory, 'The lending account does not match this owner.');
    if (value.account.status === 'verified') check(value.account.position && ['freeLinkBaseUnits', 'freeUsdcBaseUnits', 'aLinkBalanceBaseUnits', 'aLinkScaled', 'variableDebtBaseUnits', 'variableDebtScaled'].every(key => uint(value.account.position[key])) && uint(value.account.position.accountData?.healthFactorWad), 'The current lending balances are unavailable.');
    for (const [symbol, asset] of [['LINK', config.link], ['USDC', config.usdc]]) check(value.reserves?.[symbol]?.asset === asset && uint(value.reserves[symbol].variableBorrowRateRay), 'The verified lending asset or rate is unavailable.');
    return value;
  }
  async function observeAccount(input, options) {
    const value = checkedSnapshot(await fetchSnapshot({ owner: input.ownerAddress, ...(input.account ? { account: input.account } : {}) }, options), input.ownerAddress), a = value.account;
    return { chainId: config.chain, ownerAddress: a.owner, factory: config.lendingFactory, account: a.address, deployed: a.status === 'verified', nonce: a.nonce, route: a.route, blockNumber: value.block.number, blockHash: value.block.hash, accountCodeHash: a.codeHash };
  }
  function line(host, label, value) { const row = el('div'); row.append(el('dt', label), el('dd', value)); host.append(row); }
  function field(ok, name, message) { if (!ok) { $(name).setAttribute('aria-invalid', 'true'); $(name + '-error').textContent = message; $(name).focus(); throw Error(message); } }
  function clearFieldErrors() { for (const name of ['amount', 'health', 'rate']) { $(name).removeAttribute('aria-invalid'); $(name + '-error').textContent = ''; } }
  function numberInput(name, decimals) { try { return units($(name).value.trim(), decimals); } catch (error) { field(false, name, error.message); } }
  function formVisible() { return !!identity && identity.deployed && !!snapshot && execution && mode !== 'Supply'; }
  function paint() {
    if (disposed) return;
    root.setAttribute('aria-busy', String(busy));
    for (const button of root.querySelectorAll('button')) button.disabled = busy;
    $('refresh').disabled = busy || !navigator.onLine;
    $('open').hidden = !!identity?.deployed && !setupPending || setupReview; $('open').textContent = setupPending ? 'Check account setup' : identity ? 'Set up lending account' : 'Open lending account';
    $('open').disabled = busy || !navigator.onLine || !!identity && typeof setupAccount !== 'function';
    $('setup-review').hidden = !setupReview; $('setup-confirm').disabled = busy || !navigator.onLine;
    $('status').hidden = setupFeedback; setupStatus.hidden = !setupFeedback || !$('status').textContent; setupStatus.textContent = setupFeedback ? $('status').textContent : '';
    for (const button of $('actions').children) button.setAttribute('aria-pressed', String(button.textContent === mode));
    const p = snapshot?.account?.position;
    $('position').replaceChildren(); line($('position'), 'Collateral', p ? display(p.aLinkBalanceBaseUnits, 18) + ' LINK' : '—'); line($('position'), 'Debt', p ? display(p.variableDebtBaseUnits, 6) + ' USDC' : '—');
    line($('position'), 'Safety ratio', p ? p.variableDebtBaseUnits === '0' ? 'No debt' : display(p.accountData.healthFactorWad, 18) : '—');
    $('observed').textContent = snapshot ? identity?.deployed ? 'Position checked.' : 'Account setup needed.' : 'Open your account to check its position.';
    $('accounts').replaceChildren(); if (identity) { line($('accounts'), 'Position account', identity.account); line($('accounts'), 'Recoverable owner', identity.ownerAddress); } if (snapshot) line($('accounts'), 'Finalized block', snapshot.block.number);
    const eligibleSupply = mode === 'Supply' && identity?.deployed && supply?.available === true && typeof supply.open === 'function';
    $('supply').hidden = !eligibleSupply; $('supply').disabled = busy || !navigator.onLine;
    $('unavailable').hidden = !!review || formVisible() || eligibleSupply;
    $('unavailable').textContent = !navigator.onLine ? 'Offline. Approved requests remain saved. Reconnect to check the current position.' : !identity ? mode === 'Supply' ? 'Open your lending account. Private Supply is awaiting funding and route verification.' : 'Open your lending account to continue.' : !identity.deployed ? setupPending ? 'Check the original account setup to continue.' : 'Set up your lending account to continue.' : mode === 'Supply' ? 'Private Supply is awaiting funding and route verification.' : 'Lending is unavailable. Refresh to check again.';
    $('form').hidden = !!review || !formVisible(); $('receipt').hidden = !review;
    $('asset').textContent = mode === 'Withdraw' ? 'LINK' : 'USDC'; $('review').textContent = 'Review ' + mode;
    $('balance').textContent = p ? mode === 'Borrow' ? 'Current debt · ' + display(p.variableDebtBaseUnits, 6) + ' USDC' : mode === 'Repay' ? 'Available · ' + display(p.freeUsdcBaseUnits, 6) + ' USDC' : 'Collateral · ' + display(p.aLinkBalanceBaseUnits, 18) + ' LINK' : '';
    $('health-row').hidden = mode === 'Repay'; $('rate-row').hidden = mode !== 'Borrow'; root.querySelector('#il-health-help').hidden = mode === 'Repay';
    $('review').disabled = busy || !navigator.onLine; $('confirm').disabled = busy || !navigator.onLine;
    if (review) {
      const terms = review.terms, symbol = terms.action === 2 ? 'LINK' : 'USDC', decimals = terms.action === 2 ? 18 : 6;
      const cancelling = review.kind === 'Cancel'; $('terms').replaceChildren();
      $('review-title').textContent = cancelling ? 'Cancel original permission' : mode + ' ' + display(terms.amount, decimals) + ' ' + symbol; $('confirm').textContent = cancelling ? 'Confirm cancellation' : 'Confirm ' + mode;
      $('permission-copy').textContent = cancelling ? 'This public cancellation advances the account nonce and invalidates the original permission. It moves no funds. Keep the original recovery record.' : 'The lending account, amounts and loan are public.';
      if (cancelling) {
        line($('terms'), 'Original request', review.cancels); line($('terms'), 'Account nonce', terms.nonce);
        if (cancellationOriginal) line($('terms'), 'Original digest', lendingPermissionDigest(cancellationOriginal));
        line($('terms'), 'Lending account', review.account); line($('terms'), 'Network', 'Sepolia testnet');
      } else {
        line($('terms'), terms.action === 1 ? 'Repay at least' : terms.action === 2 ? 'Receive' : 'Borrow', display(terms.minResult, decimals) + ' ' + symbol);
        line($('terms'), 'Maximum remaining debt', display(terms.maxDebt, 6) + ' USDC');
        if (terms.action !== 1) line($('terms'), 'Minimum safety ratio', display(terms.minHealthFactor, 18));
        if (terms.action === 0) line($('terms'), 'Maximum borrow APR', percentage(terms.maxBorrowRateRay) + '%');
        line($('terms'), 'Receive in', 'Your lending account');
      }
      line($('terms'), 'Permission ends', new Date(Number(terms.deadline) * 1000).toLocaleTimeString()); line($('terms'), 'Network fee', 'Paid by the testnet sponsor');
    }
    transfer.update();
    repayFunding.update();
  }
  async function activity() {
    $('activity').replaceChildren(); if (!service || !identity) { $('empty').hidden = false; return; }
    const ticket = generation, rows = await service.pending(); if (disposed || ticket !== generation) return;
    $('empty').hidden = rows.length > 0;
    for (const row of [...rows].reverse()) {
      const item = el('li'), permission = row.review, terms = permission.terms, label = permission.kind === 'Order' ? ['Borrow', 'Repay', 'Withdraw'][terms.action] : permission.kind === 'Transfer' ? 'Send' : permission.kind;
      const link = permission.kind === 'Order' && terms.action === 2 || permission.kind === 'Transfer' && terms.asset === 0;
      item.append(el('strong', label + (terms.amount ? ' ' + display(terms.amount, link ? 18 : 6) + (link ? ' LINK' : ' USDC') : '')));
      const nonceAdvanced = uint(identity.nonce) && BigInt(identity.nonce) > BigInt(terms.nonce);
      const status = row.outcome?.status === 'executed' ? 'Result verified' : !row.signed && nonceAdvanced ? 'Permission inactive · Nonce advanced' : row.status === 'signed' ? 'Approved · Not submitted' : row.status === 'approval-unresolved' ? 'Approval unresolved' : 'Check the original request';
      item.append(el('span', status, 'il-muted'));
      if (row.status === 'approval-unresolved' && !row.signed && permission.kind !== 'Cancel' && !nonceAdvanced && !rows.some(value => value.review.kind === 'Cancel' && value.review.terms.nonce === terms.nonce)) {
        const cancel = el('button', 'Review cancellation'); cancel.type = 'button'; cancel.disabled = busy || !navigator.onLine;
        cancel.onclick = () => run(async options => { const lease = account.capture(), originalService = service; const value = await originalService.prepareCancellation(row.id, options); options.signal?.throwIfAborted(); lease.assertCurrent(); review = value; cancellationOriginal = permission; $('status').textContent = 'Review the original permission and nonce before cancelling.'; paint(); $('confirm').focus(); }); item.append(cancel);
      }
      if (row.signed && row.outcome?.status !== 'executed') {
        const button = el('button', row.status === 'signed' ? 'Submit approved request' : 'Check status'); button.type = 'button'; button.disabled = busy || !navigator.onLine;
        button.onclick = () => run(async options => { const lease = account.capture(), originalService = service; const value = await (row.status === 'signed' ? originalService.submit(row.id, options) : originalService.reconcile(row.id, options)); options.signal?.throwIfAborted(); lease.assertCurrent(); $('status').textContent = value.verified ? 'Lending result verified.' : value.evidence?.description ?? 'Awaiting finalized confirmation.'; if (value.verified === true) await refresh(options); else await activity(); }); item.append(button);
        if (row.outcome?.status === 'unknown' && row.outcome.transaction) { const retry = el('button', 'Retry original transaction'); retry.type = 'button'; retry.disabled = busy || !navigator.onLine; retry.onclick = () => run(async () => { await service.resume(row.id); $('status').textContent = 'Original transaction sent. Check status.'; await activity(); }); item.append(retry); }
      }
      $('activity').append(item);
    }
  }
  async function run(operation, message = '', accountFeedback = false) {
    if (busy || transfer.busy || disposed) return; busy = true; const ticket = generation; controller = new AbortController(); setupFeedback = accountFeedback; $('status').textContent = message; paint();
    try { await operation({ signal: controller.signal }); }
    catch (error) { if (!disposed && ticket === generation) { $('status').textContent = error.message; try { await activity(); } catch {} } }
    finally { if (!disposed && ticket === generation) { busy = false; controller = null; paint(); } }
  }
  async function refresh(options = {}) {
    check(identity && account, 'Open the original lending account.');
    if (setupPending && options.checkSetup !== false) await checkSetup(options);
    const ticket = generation; await account.refreshAccount(options); const current = account.identity();
    const value = checkedSnapshot(await fetchSnapshot({ owner: current.ownerAddress, account: current.account }, options), current.ownerAddress);
    if (disposed || ticket !== generation) return;
    identity = current; snapshot = value; const configured = await service.configuration(options); if (disposed || ticket !== generation) return; execution = configured.execute === true;
    if (!$('rate').value) $('rate').value = percentage(value.reserves.USDC.variableBorrowRateRay); await activity(); paint();
  }
  async function checkSetup(options) {
    const ticket = generation;
    $('status').textContent = setupPending ? 'Checking the original account setup…' : 'Submitting account setup…';
    setupPending = true; setupReview = false; setupFeedback = true; paint();
    const result = await setupAccount(identity, options); options.signal?.throwIfAborted(); if (disposed || ticket !== generation) return; setupPending = result?.verified !== true;
    $('status').textContent = setupPending ? 'Account setup submitted. Check account setup for finalized confirmation.' : 'Lending account setup verified.';
  }
  async function open(options = {}) {
    const ticket = generation, current = () => { options.signal?.throwIfAborted(); check(!disposed && ticket === generation, 'The original lending account changed.'); };
    check(navigator.onLine, 'Reconnect to open the lending account.');
    const state = await read(); current(); check(state.identity?.profile.id, 'Create or recover your Lenz account in Wallet.');
    check(config.lendingFactory && config.codeHashes?.lendingFactory, 'The testnet lending deployment is awaiting verification.');
    account ??= createAccount(state.identity.profile.id, { config, observeAccount });
    const connected = await account.connect(options); current(); identity = connected; service ??= createLendingIntentService({ account, config, now });
    await refresh({ ...options, checkSetup: false });
    if (setupPending && setupAccount) { await checkSetup(options); await refresh({ ...options, checkSetup: false }); }
    else if (!identity.deployed && setupAccount) { $('status').textContent = 'Saving account recovery…'; paint(); await account.capture().requireRecovery({ latest: true, ...options }); current(); setupReview = true; $('status').textContent = 'Account recovery saved. Review setup below.'; paint(); }
    else $('status').textContent = 'Lending account opened.';
  }
  function select(action) { check(actions.includes(action), 'Choose a lending action.'); mode = action; review = null; clearFieldErrors(); $('status').textContent = ''; paint(); }
  for (const action of actions) { const button = el('button', action); button.type = 'button'; button.onclick = () => select(action); $('actions').append(button); }
  $('open').onclick = () => run(open, setupPending ? 'Checking the original account setup…' : 'Opening your lending account…', true); $('refresh').onclick = () => run(identity ? refresh : open, 'Checking your lending account…', setupPending || !identity);
  $('setup-confirm').onclick = () => run(async options => { check(setupReview && identity && !identity.deployed, 'Review the original account setup first.'); await account.capture().requireRecovery({ latest: true, ...options }); await checkSetup(options); await refresh({ ...options, checkSetup: false }); }, 'Checking account recovery…', true);
  $('edit').onclick = () => { review = null; paint(); $('amount').focus(); };
  $('form').onsubmit = event => { event.preventDefault(); void run(async options => {
    clearFieldErrors();
    check(formVisible(), 'Open a verified lending account first.'); await refresh(options);
    const action = mode === 'Borrow' ? 0 : mode === 'Repay' ? 1 : 2, amount = numberInput('amount', action === 2 ? 18 : 6), p = snapshot.account.position;
    const debt = BigInt(p.variableDebtBaseUnits), rate = action === 0 ? numberInput('rate', 25) : BigInt(snapshot.reserves.USDC.variableBorrowRateRay), minimumHealth = action === 1 ? 0n : numberInput('health', 18);
    field(action === 1 || minimumHealth >= wad, 'health', 'The minimum safety ratio must be at least 1.');
    field(action !== 1 || amount <= BigInt(p.freeUsdcBaseUnits) && debt > 0n, 'amount', 'Keep enough USDC in the lending account to repay.');
    field(action !== 2 || amount <= BigInt(p.aLinkBalanceBaseUnits), 'amount', 'Choose an amount within the verified collateral.');
    const deadline = BigInt(Math.floor(now() / 1000) + 300), maxDebt = debtLimit(action, amount, debt, rate, snapshot.reserves.USDC, snapshot.block, deadline);
    const terms = { action, nonce: account.identity().nonce, deadline: deadline.toString(), amount: amount.toString(), recipient: identity.account, minResult: (action === 1 && amount > debt ? debt : amount).toString(), maxDebt: maxDebt.toString(), minHealthFactor: minimumHealth.toString(), maxBorrowRateRay: action === 0 ? rate.toString() : '0' };
    review = await service.prepare({ kind: 'Order', terms }, options); $('status').textContent = 'Review the amount and limits before confirming.'; paint(); $('confirm').focus();
  }); };
  $('confirm').onclick = () => run(async options => { check(review, 'Review the lending request first.'); const original = review, lease = account.capture(), originalService = service; await originalService.approve(original, options); options.signal?.throwIfAborted(); lease.assertCurrent(); review = null; const value = await originalService.submit(original.id, options); options.signal?.throwIfAborted(); lease.assertCurrent(); $('status').textContent = value.verified === true ? 'Lending result verified.' : 'Request submitted. Check status for finalized confirmation.'; if (value.verified === true) await refresh(options); else await activity(); });
  $('supply').onclick = () => run(async options => { check(supply?.available === true && typeof supply.open === 'function', 'The private Supply route is unavailable.'); await account.capture().requireRecovery({ latest: true, forSupply: true, ...options }); await supply.open({ account, snapshot }, options); });
  const connectivity = () => { review = null; if (!navigator.onLine) { controller?.abort(); snapshot = null; execution = false; } paint(); void activity().catch(() => {}); };
  const positionChanged = () => { if (!disposed && identity && navigator.onLine) void run(refresh, 'Checking your lending account…'); };
  const changed = () => { generation++; controller?.abort(); account?.dispose(); account = null; service = null; identity = null; snapshot = null; review = null; execution = false; busy = false; setupPending = false; setupReview = false; setupFeedback = false; transfer.reset(); repayFunding.reset(); $('amount').value = ''; $('rate').value = ''; $('activity').replaceChildren(); $('empty').hidden = false; $('status').textContent = ''; paint(); };
  addEventListener('online', connectivity); addEventListener('offline', connectivity); addEventListener('lenz-lending-intent', positionChanged); addEventListener('lenz-account-identity', changed); addEventListener('pagehide', changed); paint();
  return Object.freeze({ element: root, open: () => run(open, 'Opening your lending account…', true), refresh: () => run(refresh, 'Checking your lending account…'), setAction: select, setSupplyRoute(value) { supply = value; paint(); }, show(visible) { root.hidden = !visible; if (!visible) transfer.cancel(); }, dispose() { changed(); disposed = true; transfer.dispose(); repayFunding.dispose(); root.remove(); style.remove(); removeEventListener('online', connectivity); removeEventListener('offline', connectivity); removeEventListener('lenz-lending-intent', positionChanged); removeEventListener('lenz-account-identity', changed); removeEventListener('pagehide', changed); } });
}
