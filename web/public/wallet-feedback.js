// Detailed errors belong in developer diagnostics, never in a money flow.
export function walletError(error) {
  const text=error?.message??String(error);
  console.warn('Lenz wallet action:', text);
  if(error?.errors) for(const cause of error.errors) console.warn('Lenz payment diagnostic:',cause?.message??String(cause));
  if(error?.cause) console.warn('Lenz payment diagnostic:',error.cause?.message??String(error.cause));
  if(/Confirmation is uncertain/.test(text)) return text;
  if(/recovered account|contact is available for chat/i.test(text))return text;
  if(/Turn on internet delivery/.test(text))return 'Turn on internet delivery to use carriers, or save the encrypted request to share.';
  if(/No carriers are configured/.test(text))return 'No carriers are configured. Save the encrypted request to share with your contact.';
  if(/contact was removed/.test(text))return 'This contact was removed. Go back and choose again.';
  if(/DeFi request expired|Approval expired|Carrier envelope expired/i.test(text))return 'The approval window has ended. Your money stays set aside until the swap is resolved.';
  if(/Private execution is required/.test(text))return 'Private execution is required. This test route is public; your preference has not been changed.';
  if(/Carrier unavailable|Carrier configuration unavailable/.test(text))return 'The carrier could not be reached. Your request is saved; retry sends the same request.';
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
