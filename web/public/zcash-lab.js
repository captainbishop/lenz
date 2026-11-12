import { verifyMemoInspection, verifyMemoReview } from './zcash-memos.js';
const $ = s => document.querySelector(s);
let busy = false, snapshot = null, review = null;
let memoDisplay = null, request = null, epoch = 0;
const amount = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > 2100000000000000n) throw Error('Invalid wallet amount.');
  const n = BigInt(value), fraction = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${n / 100000000n}${fraction ? '.' + fraction : ''}`;
};
function controls() { $('#zc-read').disabled = busy; $('#zc-refresh').disabled = busy || !navigator.onLine; $('#zc-wallet').disabled = busy; $('#zc-copy').disabled = busy || !snapshot; for (const id of ['prepare','check','discard']) $('#zc-review-' + id).disabled = busy; $('#zc-review-effects').disabled = busy || review?.state !== 'ready'; $('#zc-review-memos').disabled = busy || review?.state !== 'ready'; $('#zc-review-memo-confirm').disabled = busy || !memoDisplay || review?.memos?.status !== 'inspected'; $('#zc-review-memo-cancel').hidden = !busy || request?.action !== 'review-memos'; $('#zc-review-network').disabled = busy || !navigator.onLine || review?.state !== 'ready'; $('#zc-review-amount').disabled = busy; $('#main').setAttribute('aria-busy', String(busy)); }
function clearMemoDisplay() { memoDisplay = null; $('#zc-memo-panel').hidden = true; $('#zc-memo-panel').replaceChildren(); }
function cancelRequest(message) { epoch++; request?.controller.abort(); request = null; busy = false; clearMemoDisplay(); if (review) review = {...review,memos:{status:'unreviewed'}}; $('#zc-review-memo-status').textContent = message; controls(); }
function status(text, error = false) { $('#zc-status').textContent = text; $('#zc-status').dataset.error = String(error); }
function validate(data, wallet) {
  if (data?.network !== 'testnet' || data.wallet !== wallet || data.mode !== 'native-test-companion' || data.canSend !== false || typeof data.refreshed !== 'boolean') throw Error('Unexpected test wallet response.');
  if (typeof data.address !== 'string' || !/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(data.address)) throw Error('Unexpected receive address.');
  if (!Number.isFinite(Date.parse(data.checkedAt)) || !Number.isSafeInteger(data.walletHeight) || data.walletHeight < 1) throw Error('Invalid wallet update.');
  for (const field of ['total','spendable','pending','ironwood_spendable','orchard_spendable','sapling_spendable','transparent_spendable']) amount(data.amounts?.[field]);
  const a = data.amounts;
  if (BigInt(a.spendable) + BigInt(a.pending) !== BigInt(a.total) || ['ironwood','orchard','sapling','transparent'].reduce((sum, pool) => sum + BigInt(a[pool + '_spendable']), 0n) !== BigInt(a.spendable)) throw Error('Wallet balances disagree.');
}
function render(data) {
  snapshot = data;
  $('#zc-name').textContent = `Test wallet ${data.wallet.toUpperCase()}`;
  for (const field of ['total','spendable','pending']) $('#zc-' + field).textContent = amount(data.amounts[field]);
  $('#zc-funding').textContent = data.amounts.total === '0' ? 'No test coins in this wallet at this read. A receive address is not proof of funding.' : 'The native wallet reports test coins. Sending from Lenz is not connected yet.';
  $('#zc-freshness').textContent = `${data.refreshed ? 'Network update completed' : 'Local wallet read; network not checked'} at ${new Date(data.checkedAt).toLocaleString()}.`;
  $('#zc-address').value = data.address;
  $('#zc-details').replaceChildren();
  for (const [label, value] of [...['ironwood','orchard','sapling','transparent'].map(pool => [pool[0].toUpperCase() + pool.slice(1) + ' spendable', amount(data.amounts[pool + '_spendable']) + ' test ZEC']), ['Wallet known block', String(data.walletHeight)]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('#zc-details').append(dt, dd);
  }
  $('#zc-result').hidden = false;
}
async function read(refresh) {
  if (busy) return;
  const wallet = $('#zc-wallet').value, currentEpoch = epoch, controller = new AbortController(); request = {controller,action:'wallet'}; busy = true; controls();
  status(refresh ? 'Updating the native wallet from Zcash testnet. This can take a minute…' : 'Reading the native test wallet on this computer…');
  try {
    const response = await fetch('/api/zcash/' + (refresh ? 'refresh' : 'status'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({wallet}), signal: AbortSignal.any([controller.signal,AbortSignal.timeout(170000)]) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'The test wallet could not be reached.');
    validate(data, wallet); if (data.refreshed !== refresh) throw Error('The requested wallet update was not confirmed.');
    if (currentEpoch !== epoch || wallet !== $('#zc-wallet').value) return;
    render(data); status('Native test wallet read. No funds were sent.');
  } catch (error) {
    if (currentEpoch !== epoch) return;
    status(error.message === 'Failed to fetch' ? 'The local wallet service could not be reached. Start the Lenz server on this computer and try again.' : error.message, true);
    if (snapshot) $('#zc-freshness').textContent = `Update failed. Showing the earlier read from ${new Date(snapshot.checkedAt).toLocaleString()}; it may be out of date.`;
  } finally { if (currentEpoch === epoch) { request = null; busy = false; controls(); } }
}
$('#zc-read').onclick = () => read(false); $('#zc-refresh').onclick = () => read(true);
$('#zc-wallet').onchange = () => { cancelRequest('Memos have not been reviewed for this account.'); snapshot = null; review = null; $('#zc-review-result').hidden = true; $('#zc-review-status').textContent = 'Open the saved review for this test account, or prepare a new one.'; $('#zc-result').hidden = true; $('#zc-address').value = ''; status('Selected a different test account. Read its wallet to see its balance.'); controls(); };
$('#zc-copy').onclick = async () => { if (!snapshot) return; try { await navigator.clipboard.writeText(snapshot.address); status('Testnet address copied.'); } catch { $('#zc-address').focus(); $('#zc-address').select(); status('Copy was unavailable. The address is selected for manual copying.'); } };
addEventListener('online', () => { controls(); status('Browser connection restored. No wallet was updated automatically.'); }); addEventListener('offline', () => { cancelRequest('Memo display cleared after disconnection. Inspect it again before confirming.'); status('This browser is offline. No wallet is updated automatically; earlier reads may be out of date.'); });
addEventListener('pagehide',()=>cancelRequest('Memo display cleared. Open the saved review to continue.'));
addEventListener('pageshow',event=>{if(event.persisted)cancelRequest('Memo display cleared. Open the saved review to continue.');});
async function paymentReview(action) {
  if (busy) return;
  const wallet = $('#zc-wallet').value, input = { wallet }, currentEpoch = epoch, controller = new AbortController();
  if (action === 'review') input.amount = $('#zc-review-amount').value.trim();
  if (['review-discard','review-check','review-effects','review-memos','review-memo-confirm'].includes(action)) { if (!review) return; input.id = review.id; }
  if (action === 'review-memo-confirm') { if (!memoDisplay || review?.memos?.status !== 'inspected') return; input.binding = memoDisplay.binding; }
  if (action === 'review-check' && !navigator.onLine) return;
  clearMemoDisplay(); request = {controller,action}; busy = true; controls(); $('#zc-review-status').textContent = 'Checking the unsigned payment on this computer…';
  try {
    const response = await fetch('/api/zcash/' + action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(150000)])});
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'The review could not be completed.');
    const next = data.review;
    if (next !== null) {
      if (!next || next.wallet !== wallet || !/^[0-9a-f-]{36}$/.test(next.id) || !['ready','preparing','failed'].includes(next.state) || next.canSign !== false || next.canSend !== false) throw Error('Unexpected payment review.');
      if (input.id && next.id !== input.id) throw Error('A different payment review was returned.');
      amount(next.amount);
      validateFreshness(next.freshness);
      validateEffects(next.effects, next);
      await verifyMemoReview(next.memos,next);
      if (next.state === 'ready') {
        for (const field of ['fee','change','totalDebit']) amount(next[field]);
        if (BigInt(next.amount) < 1n || BigInt(next.amount) > 10000000n || BigInt(next.fee) < 1n || BigInt(next.fee) > 10000n || BigInt(next.totalDebit) !== BigInt(next.amount) + BigInt(next.fee) || next.recipient !== (wallet === 'a' ? 'b' : 'a') || !/^[0-9a-f]{64}$/.test(next.txid) || !/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(next.address)) throw Error('Payment review terms disagree.');
      }
    }
    let inspection = null;
    if (action === 'review-memos') {
      if (next?.memos?.status !== 'inspected') throw Error('Memo inspection did not complete.');
      inspection = await verifyMemoInspection(data.memoInspection,next);
    }
    if (action === 'review-memo-confirm' && (next?.memos?.status !== 'confirmed' || next.memos.binding !== input.binding)) throw Error('Different memos were confirmed.');
    if (currentEpoch !== epoch || wallet !== $('#zc-wallet').value) return;
    review = next; $('#zc-review-result').hidden = !next; $('#zc-review-terms').replaceChildren(); $('#zc-review-details').textContent = ''; $('#zc-review-freshness').textContent = freshnessText(next?.freshness); $('#zc-review-ownership').textContent = effectsText(next?.effects);
    $('#zc-review-memo-status').textContent = memoText(next?.memos);
    if (inspection) renderMemos(inspection);
    if (!next) $('#zc-review-status').textContent = action === 'review-discard' ? 'Unsigned review discarded. No funds were sent.' : 'No saved unsigned review for this account.';
    else if (next.state !== 'ready') { $('#zc-review-heading').textContent = 'Preparation did not finish'; $('#zc-review-status').textContent = 'This request was not signed or sent. Discard it before preparing another payment.'; }
    else {
      $('#zc-review-heading').textContent = 'Not signed or sent';
      for (const [label,value] of [['To',`Test wallet ${next.recipient.toUpperCase()}`],['Amount',amount(next.amount)+' test ZEC'],['Fee',amount(next.fee)+' test ZEC'],['Total to debit',amount(next.totalDebit)+' test ZEC']]) {
        const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);$('#zc-review-terms').append(row);
      }
      $('#zc-review-details').textContent = `Transaction ${next.txid}. Recipient ${next.address}. Proposed change ${amount(next.change)} test ZEC. Wallet's known block ${next.walletHeight}.`;
      if (['inspected','confirmed'].includes(next.memos?.status)) $('#zc-review-details').textContent += ` Memo file ${next.memos.pcztSha256}. Memo binding ${next.memos.binding}. Payment memo fingerprint ${next.memos.recipient.sha256}. Owned change memo fingerprint ${next.memos.change.sha256}.`;
      $('#zc-review-status').textContent = 'Review saved on this computer. Reloading or reconnecting will not sign or send it.';
    }
  } catch (error) { if (currentEpoch !== epoch) return; clearMemoDisplay(); if(review)review={...review,memos:{status:'unreviewed'}}; $('#zc-review-memo-status').textContent = 'The memo review did not complete. Inspect the saved payment again before confirming.'; $('#zc-review-status').textContent = `${error.message} Open saved review to check whether preparation finished. Any earlier review shown may be out of date.`; $('#zc-review-freshness').textContent = 'The latest check did not complete. Any earlier network observation is out of date.'; $('#zc-review-ownership').textContent = 'The latest request did not complete. Open the saved review and check its outputs again.'; }
  finally { if (currentEpoch === epoch) { request = null; busy = false; controls(); } }
}
$('#zc-review-prepare').onclick=()=>paymentReview('review');
$('#zc-review-check').onclick=()=>paymentReview('review-status');
$('#zc-review-discard').onclick=()=>paymentReview('review-discard');
$('#zc-review-network').onclick=()=>paymentReview('review-check');
$('#zc-review-effects').onclick=()=>paymentReview('review-effects');
$('#zc-review-memos').onclick=()=>paymentReview('review-memos');
$('#zc-review-memo-confirm').onclick=()=>paymentReview('review-memo-confirm');
$('#zc-review-memo-cancel').onclick=()=>cancelRequest('Memo inspection cancelled. Inspect it again before confirming.');
function memoText(value) {
  if (!value || value.status === 'unreviewed') return 'Payment and change memos have not been reviewed. Older output checks do not include memo consent.';
  if (value.status === 'checking') return 'Memo inspection started without a saved result. Inspect again.';
  if (value.status === 'unavailable') return 'The last memo review did not complete. Inspect again before confirming.';
  if (value.status === 'confirmed') return `Exact payment and change memos were reviewed ${new Date(value.confirmedAt).toLocaleString()}. This confirmation applies to this saved transaction.`;
  return 'Inspect both exact memos below, then confirm this review. Reopened reviews need a new inspection to display the memo bytes.';
}
function renderMemos(inspection) {
  clearMemoDisplay(); memoDisplay = inspection;
  for (const role of ['recipient','change']) {
    const memo = inspection[role],section = document.createElement('section'),heading = document.createElement('h4'),description = document.createElement('p');
    heading.textContent = role === 'recipient' ? 'Payment memo' : 'Owned change memo';
    const labels = {empty:'No memo (canonical no-memo encoding).',text:memo.text === ''?'Empty text memo. Its bytes differ from the no-memo encoding.':'UTF-8 text memo.',binary:'Binary memo. Inspect its exact bytes.',unsupported:'Reserved or unsupported memo format. Inspect its exact bytes.', 'invalid-text':'Invalid UTF-8 memo. Inspect its exact bytes.'};
    description.textContent = labels[memo.format];section.append(heading,description);
    if (memo.format === 'text') { const text = document.createElement('pre');text.className='zc-memo-text';text.textContent=memo.text;section.append(text); }
    if (memo.unsafeText) { const warning = document.createElement('p');warning.textContent='This memo includes control or direction-changing characters. Inspect the exact bytes because displayed text can be misleading.';section.append(warning); }
    const details=document.createElement('details'),summary=document.createElement('summary'),hex=document.createElement('pre');summary.textContent='Exact 512 memo bytes (hex)';hex.className='zc-memo-hex';hex.textContent=memo.hex;details.append(summary,hex);section.append(details);$('#zc-memo-panel').append(section);
  }
  $('#zc-memo-panel').hidden=false;
}
function validateEffects(value, next) {
  if (value == null) return;
  if (!Number.isFinite(Date.parse(value.checkedAt))) throw Error('Invalid output check.');
  if (['checking','unavailable'].includes(value.status)) return;
  for (const field of ['amount','fee','change','inputValue']) amount(value[field]);
  if (value.status !== 'verified' || value.version !== 6 || value.pool !== 'ironwood' || value.changeOwned !== true || value.commitmentsVerified !== true || typeof value.noteEncryptionVerified !== 'boolean' || value.canSign !== false || value.canSend !== false ||
    value.recipient !== next.address || value.amount !== next.amount || value.fee !== next.fee || value.change !== next.change || BigInt(value.inputValue) !== BigInt(next.amount) + BigInt(next.fee) + BigInt(next.change)) throw Error('Output check differs from this review.');
}
function effectsText(value) {
  if (!value) return 'Outputs and change ownership have not been checked.';
  if (value.status === 'checking') return 'An output check started but has no saved result. Check again.';
  if (value.status === 'unavailable') return 'The last output check failed. Do not rely on an earlier successful check.';
  return `Recipient, amount, fee and commitments verified. Change belongs to the sending wallet. ${value.noteEncryptionVerified ? 'Encrypted payment and change match their committed terms.' : 'Encrypted outputs have not been checked. Check again to verify them.'} Checked ${new Date(value.checkedAt).toLocaleString()}. Input availability, current witnesses and expiry are separate checks; signing and sending remain unavailable.`;
}
function validateFreshness(value) {
  if (value == null) return;
  if (!Number.isFinite(Date.parse(value.checkedAt))) throw Error('Invalid network check.');
  if (['checking','unavailable'].includes(value.status)) return;
  for (const field of ['serverHeight','walletHeight','expiryHeight','targetHeight']) if (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] >= 500000000) throw Error('Invalid network height.');
  const remaining = Math.max(0, value.expiryHeight - value.serverHeight);
  if (value.targetHeight !== value.serverHeight + 1 || typeof value.branchMatches !== 'boolean' || value.blocksRemaining !== remaining) throw Error('Network check terms disagree.');
  const expected = !value.branchMatches ? 'network-changed' : value.targetHeight > value.expiryHeight ? 'expired'
    : remaining <= 20 ? 'expires-soon' : value.walletHeight < value.serverHeight ? 'wallet-behind'
    : value.walletHeight > value.serverHeight ? 'network-behind' : 'within-expiry';
  if (value.status !== expected) throw Error('Network check result disagrees.');
}
function freshnessText(value) {
  if (!value) return 'Expiry and network have not been checked for this saved payment.';
  const labels = {
    checking: 'A check was started but no completed result is saved. Check again.',
    unavailable: 'The last check failed. Check again when the local service and network are available.',
    expired: 'This payment has expired for the next block. Discard this unsigned review, update the wallet and prepare a new payment.',
    'expires-soon': 'This payment is close to expiry. Update the wallet and prepare a new review before adding a signature.',
    'network-changed': 'The payment does not match the network rules for the next block. Update the wallet before preparing another review.',
    'wallet-behind': 'The local wallet is behind the network. Update from Zcash, then check this review again.',
    'network-behind': 'The provider reports an earlier block than the wallet. Wait and check again; do not rely on this observation.',
    'within-expiry': 'The payment was within expiry and the reported wallet/network heights matched. This does not verify that its input is still spendable or approve signing.'
  };
  return `${labels[value.status]} Last checked ${new Date(value.checkedAt).toLocaleString()}. Signing and sending remain unavailable.`;
}
controls();
