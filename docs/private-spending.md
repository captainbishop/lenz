# Private spending primitives

The [spending adapter](../integrations/intents-spend.mjs) prepares an unfunded
Confidential Intents quote, submits an explicitly signed transfer, and reads the
original deposit's status. The [browser library](../web/public/intents-spend.js)
checks the quote and generated payload before requesting the owner's signature.
These libraries do not activate Wallet controls or an HTTP execution endpoint.

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
execution or settlement. Funded execution, encrypted outcome delivery, independent
settlement evidence and financial recovery remain separate work.

## Local verification

Install the locked dependencies in `aurora`, `integrations`,
`integrations/quote-verifier` and `web/near-connector` with lifecycle scripts
disabled. The browser check also needs Playwright and Edge.

```powershell
node web/build-intents-codecs.mjs
node web/build-intents-quote.mjs
node --test web/intents-spend.test.mjs integrations/intents-spend.test.mjs web/intents-status.test.mjs
node web/intents-signing-browser.test.cjs
```

Tests use disposable signing keys and provider responses, including a local HTTP
server for redirect and stalled-response checks. The browser check loads the
modules before disconnecting and tests signing without network requests. It does
not establish offline installation, a cold cache restart or physical-wallet
compatibility.

Interfaces follow the official [OpenAPI specification](https://1click.chaindefuser.com/docs/v0/openapi.yaml),
[signed intent flow](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution)
and [quote signature guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature).
