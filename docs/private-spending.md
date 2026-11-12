# Private spending primitives

The [spending adapter](../integrations/intents-spend.mjs) prepares an unfunded
Confidential Intents quote, submits an explicitly signed transfer, and reads the
original deposit's status. The [browser library](../web/public/intents-spend.js)
checks the quote and generated payload before requesting the owner's signature.
Wallet controls and the local HTTP routes use these libraries with encrypted
approval and executor journals.

## Wallet swaps

Wallet → Lenz funds → Swap lets the owner choose different source and destination
assets, an exact input amount, a minimum receive amount and a verified executor.
The output and any refund stay in the owner's Confidential Intents account.
`/api/private-spend/swap-prepare` accepts this owner-directed swap separately from
the same-asset Pay route. Both reject nonzero slippage and unsupported fees.
The returned quote must meet the chosen minimum before a review can be saved.

Source and destination units are retained in the encrypted review. A saved
review can be approved offline and handed off through the existing encrypted
outbox. Received requests require an allowed sender-owner pair and a fresh
executor review. The executor uses the current HTTPS token catalogue to display
amounts; missing, malformed or duplicate asset metadata pauses submission.
Native ETH labels use the pinned chain identifiers. Exact asset IDs remain in
the review details, and catalogue labels are not settlement evidence.

Encrypted reports preserve the destination output separately from the original
input. Account recovery retains the exact approval, output bounds and reports;
unknown asset metadata is shown as integer base units. Recovered financial
access remains paused. No report credits funds or proves a private refund.
Withdrawal to an external wallet and independent private settlement remain open.

The official [signed-intent flow](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution)
uses `swap_transfer` for generation and submission and says Confidential Intents
has no RPC path. The [NEAR privacy architecture](https://www.near.org/blog/how-confidential-intents-works)
describes a permissioned private shard without a public RPC, API or explorer.
These interfaces do not supply an independently checkable private balance or
settlement proof to Lenz.

The owner supplies the amount, assets, recipient, minimum output and refund time
separately from the provider offer. Only an exact-input transfer between
Confidential Intents accounts is accepted. The generated ERC-191 payload must
contain exactly one transfer to the signed deposit, using the approved asset and
quantity, the same owner, and a nonce bound to the signing deadline. Key-management
actions, extra transfers, alternate routing instructions and nonzero refund or
withdrawal fees are rejected.

The refund-start time and signing deadline are distinct. New signing requires
the refund-start time to remain more than one minute away, and the signing
deadline must be within four days. Expired requests remain readable for recovery;
status lookup cannot renew their authority.

The wallet retains its signing key. Signing checks the owner and network before
and after the prompt and rejects account changes, cancellation and expiry. A
cancelled caller cannot open another prompt on the same provider until the
underlying wallet promise settles. The prompt lock covers this module instance;
it does not coordinate different tabs or unrelated wallet integrations.

## Submission and recovery

Partner credentials belong in the connected adapter's process, never browser
assets. Calls use the fixed 1Click origin, reject redirects, limit responses to
64 KiB and use a 20-second timeout. Status timestamps require an explicit time
zone and a valid calendar date before normalization.

The caller must durably save the signed request and submission attempt before
calling `submitConfidentialSpend`. Local validation or cancellation before
dispatch sends nothing. A failed, lost or malformed submission response leaves
the outcome unknown. The adapter does not retry automatically. Reconcile the
original deposit before deciding whether another submission is safe.

`readConfidentialSpendStatus` rechecks the original signed offer and its deposit.
It preserves missing quantities as unknown, checks successful input/output bounds
and partial refund amounts, and returns `settlementVerified: false` and
`providerReportSigned: false`. A later provider report is not authenticated by
the original quote signature and cannot credit a balance or release a reservation.

SDK 0.1.26 excludes confidentiality, refund-start time and parts of the fee
configuration from its signature. Exact response checks do not establish private
execution or settlement. Funded execution, independent
settlement evidence and financial recovery remain separate work.

## Encrypted approval and outcome journals

The browser outbox saves an encrypted approval before handing it to a selected,
verified executor. The executor must opt in to the sender and wallet owner. Intake
rejects conflicting nonces and commits the request before returning a storage
receipt. Submission saves an unknown attempt before calling the connected adapter;
a lost response or failed result write cannot authorize another attempt.

`observeConfidentialRequest` accepts the connected status reader. It rechecks the
account, permission and cancellation after the read, then encrypts and saves one
latest provider report for return to the owner. Reports and receipts bind the
original approval and exact encrypted packet. Retries reuse the saved packet;
older updates cannot replace newer ones, and conflicting equal-time updates fail.
Admission reserves space for later submission, report and receipt records.

The owner stores a report before returning its receipt. Reports remain readable
after the approval expires and after a backward clock change. They do not credit
funds, verify settlement or release reservations. A provider's reported deposit
activity blocks a fresh submission, including activity in an older or conflicting
report. Wallet controls use these services and their offline dependencies.
Automatic courier routing remains separate integration work.

## Local verification

Install the locked dependencies in `aurora`, `integrations`,
`integrations/quote-verifier` and `web/near-connector` with lifecycle scripts
disabled. The browser check also needs Playwright and Edge.

```powershell
node web/build-intents-codecs.mjs
node web/build-intents-quote.mjs
node --test web/intents-spend.test.mjs integrations/intents-spend.test.mjs web/intents-status.test.mjs
node web/intents-signing-browser.test.cjs
node --test web/intents-spend-outbox-browser.test.cjs web/intents-outcome-browser.test.cjs
node --test web/intents-cache-browser.test.cjs
```

Tests use disposable signing keys and provider responses, including a local HTTP
server for redirect and stalled-response checks. The signing check loads modules
before disconnecting. The cache check requires
the prepared proof assets from `web/build.mjs`; it closes persistent Edge, stops
the server and reopens the saved page offline through each app worker, without
an explicit preparation action. These
checks do not establish first-time offline installation or physical-wallet
compatibility.

## Wallet approvals

Wallet has a Lenz funds panel for same-asset payments between Confidential
Intents accounts. Preparation requires the server's `LENZ_PRIVATE_INTENTS_KEY`
partner credential; it stays on the server. The endpoint accepts only chosen,
unfunded terms and never accepts signatures or submits money. Missing access
leaves the entries available to retry.

The owner reviews the exact recipient, asset, amount, minimum output, executor,
refund-start time and signature deadline. An encrypted unsigned review survives
reopening. A compatible external wallet can sign the saved review offline; Lenz
saves the signed approval before its encrypted request can be exported. Nearby
delivery uses the same saved journal. The executor must separately opt in to the
sender and owner before intake and execution.

Executor update files contain a carrier envelope under
`{type: "lenz/private-update-file/v1", envelope}`. Import authenticates and stores
the report or receipt through the existing journals. Reports stay explicitly
unverified after expiry and restart.

Wallet's Add funds flow follows native ETH from the selected Ethereum, Arbitrum
or Base wallet into the same owner's Confidential Intents account. NEAR Intents'
1Click API prepares the route and deposit address; Aurora remains an optional
execution adapter. The user does not switch to NEAR or manually configure a bridge.
The quote preserves the source-specific ETH asset instead of converting it to NEAR.

The user permits a public source-chain deposit and reviews the exact deposit,
quoted private credit, route cost, refund and withdrawal fees, gas budget and
deadlines. Rollup fees may add to the displayed gas budget. The complete signed
quote and transfer review are saved encrypted before the wallet opens. Source
selection preserves the amount; changed accounts, closed reviews, stale quotes,
storage failures and chat-only recovery block new prompts. Unknown wallet replies
block repeat sends and can be reconciled against the original transaction.

A finalized source-chain deposit remains checkable through **Check funding**.
The read-only check asks NEAR Intents about that exact saved deposit, verifies
the original quote and stores a separate encrypted provider report. Arrival and
refund quantities stay unverified; the report never changes the source receipt,
credits a balance or sends another transfer. Missing quantities remain unknown.
The checked time and provider update remain visible after reopening offline.
Older updates cannot replace newer evidence; conflicting updates, account changes,
closed checks and failed writes preserve the saved history.

A finalized source-chain deposit is not proof of private credit or a completed
refund. Private settlement, broader funding assets and financial recovery remain
unfinished. Browser data loss is not recovered by
the local transfer journal. Cancel a wallet prompt if its review or deposit
deadline passes; Lenz cannot prevent the wallet from sending later.

## Recovering saved requests

Automatic account backup preserves the owner's validated private requests,
original signed approvals, disclosure records and encrypted provider updates.
Passkey sign-in restores this history under the same Lenz ID with a fresh,
nonextractable local encryption key. Private-only history changes schedule backup.
Older account backups remain readable. Private history backup requires the
original Lenz ID to be recoverable.

Device synchronization retains unresolved requests and the newest checked
provider update. Conflicting approvals for one nonce stop synchronization.
Recovery keeps payment preparation, signing and request sharing blocked in the
app. Receiving permissions and executor submission history are not restored.
The history establishes neither complete liabilities nor settlement, refund,
lost-device revocation or safe financial recovery. Previously signed approvals
retain their original cryptographic authority until their actual deadline.

Run `node --test web/private-recovery-browser.test.cjs` with the existing
Playwright dependency available.

## Received requests

Wallet’s Lenz funds panel opens **Received requests**. The receiving contact
allows an exact sender and owner account, imports the encrypted saved request,
and reviews its recipient, amounts, deposit, fees and deadlines before explicitly
submitting it. Receiving, reopening and reconnecting never submit a payment.
Verified built-in ETH identifiers for Ethereum, Arbitrum and Base use their exact
18-decimal amounts and network labels. Other assets remain saved and checkable;
submission waits for verified display metadata rather than assuming decimals.
Pausing or removing permissions retains saved requests. Chat-only recovery blocks
intake and execution; recovered contacts require renewed verification.

The encrypted journal saves an uncertain attempt before calling the provider.
Lost replies stay unresolved after reopening. **Check update** reads the original
deposit, including after expiry. Pending reports cannot reopen an already recorded
submission. Any observed activity or unfinished check blocks a new submission.
**Save update** returns the exact stored receipt or latest encrypted report to the
owner’s existing payment-update importer. Provider reports remain unverified and
cannot credit funds or release reservations.

The local bridge uses the server-only `LENZ_PRIVATE_INTENTS_KEY`. Its Host/Origin
checks restrict browser requests; the device journal enforces sender-owner consent.
They do not authenticate another local process. The server listens on loopback,
and exposing this bridge to remote clients requires separate executor authentication.
No server wallet key, automatic retry or transaction signing is added.

```powershell
node --test web/private-executor-relay.test.mjs web/private-executor-ui.test.cjs
node --test web/intents-spend-outbox-browser.test.cjs web/intents-outcome-browser.test.cjs web/intents-cache-browser.test.cjs
```

```powershell
node --test web/private-spend-relay.test.mjs
node --test web/private-spend-ui.test.cjs
node --test web/private-funding.test.mjs web/private-funding-ui.test.cjs web/evm-transfer.test.mjs
node --test web/private-funding-status.test.mjs
```

Interfaces follow the official [OpenAPI specification](https://1click.chaindefuser.com/docs/v0/openapi.yaml),
[signed intent flow](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution)
and [quote signature guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature).
