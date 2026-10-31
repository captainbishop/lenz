// Detailed errors belong in developer diagnostics, never in a money flow.
export function walletError(error) {
  const text=error?.message??String(error);
  console.warn('Lenz wallet action:', text);
  if(error?.errors) for(const cause of error.errors) console.warn('Lenz payment diagnostic:',cause?.message??String(cause));
  if(error?.cause) console.warn('Lenz payment diagnostic:',error.cause?.message??String(error.cause));
  if(/Confirmation is uncertain/.test(text)) return text;
  if (/Allow popups/i.test(text)) return 'Allow popups for Lenz, then open your wallet again.';
  if(/cancel|User closed|Wallet closed|User rejected/i.test(text))return 'Approval was cancelled. Your request is still saved.';
  if(/Connect .+ before|another wallet|another Lenz|original Lenz owner/i.test(text))return 'Connect the wallet that received this refund, then try again.';
  if(/commit|storage failed|storage write|quota|IndexedDB/i.test(text))return 'We could not save that change. Check your browser storage, then try again.';
  if(/has not deposited|No final deposit/i.test(text))return 'The refund has not arrived in Lenz yet. Check again shortly.';
  if(/No single available|insufficient|not enough/i.test(text))return 'There is not enough available money for this amount.';
  if(/fetch|network|timeout|timed out|offline|Reconnect|connection/i.test(text))return 'Check your internet connection, then try again. Your saved request is still here.';
  if(/different|match|Wrong|Invalid|signature|verify|Missing|finality/i.test(text))return 'We could not verify this request. Your balance has not changed.';
  if(/decimal|amount|minimum/i.test(text))return 'Check the amount and try again.';
  return 'This could not be completed. Your saved request is still here. Try again or check its status.';
}
