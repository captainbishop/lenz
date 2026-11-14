# 1Click quote verification

2026-10-30. The local Intents preview now requires a valid provider signature as well as matching terms, a bounded output minimum and no allocated deposit. It rejects missing, malformed or stale timestamps: the client accepts at most five minutes of age and thirty seconds of future clock skew. These are local preview limits, not a promise that a market quote remains executable for five minutes.

The official `@defuse-protocol/one-click-sdk-typescript` **0.1.26** is pinned in this isolated folder. Its lockfile and [advisory report](dependency-audit.json) cover 40 installed dependencies; the current report has zero known vulnerabilities. Lifecycle scripts were disabled during installation. This does not resolve the earlier experimental Intents SDK's separate dependency findings.

The server imports the verifier wrapper from this folder. The [private spending library](../../docs/private-spending.md) also bundles this verifier for browser use without the HTTP client. Product spending controls remain separate. The SDK's pinned manager public key is used by default:

```text
ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
```

An HTTP request or provider response cannot select another key. Tests inject verification under disposable test keys at the internal function boundary, which is not exposed by the local HTTP route. Tests also check that the production default rejects those keys even when a response supplies them as alleged manager keys.

## Signature coverage and privacy limit

The [official signature guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature) recommends the SDK. Inspection of its installed `dist/index.mjs` shows that it selects specific request/quote fields, serializes them with stable keys, hashes with SHA-256 and verifies an Ed25519 signature over the Base58-encoded hash.

**`quoteRequest.confidentiality` is excluded from the signed fields in 0.1.26.** A test changes this field while retaining a valid SDK signature. Lenz separately requires the HTTPS response to echo the requested confidentiality and never falls back to public routing. That echo check does not cryptographically bind the privacy mode: a valid signature is not proof that confidential execution was selected or delivered. The result metadata explicitly records this boundary. A documented upstream binding or a separately verified privacy mechanism is still needed.

Other selected fields include assets, amount, receiving/refund accounts, deadline and output bounds. The SDK also excludes some metadata and fee configuration. The original preview remains restricted to dry exact-input quotes; the private spending library has its own checks. Neither claims the signature covers every response property.

## Checks and remaining access requirement

[Verification](verification-results.json) records twenty affected Node tests and two detected guard removals. Test quotes are signed with disposable local Ed25519 keys using Node crypto and checked through the actual official SDK. These are cryptographic fixtures, not signatures issued by the live provider. Source and lock hashes are recorded.

The older [live confidential preview](../intents-results.json) records **HTTP 401** before partner access. On November 9, separately retained local checks accepted basic and advanced confidential dry quotes and verified their provider signatures with this SDK. The [account adapter](../../docs/confidential-account.md) documents the advanced receiving scope. No key, user-session token or private account record is kept in this directory. No deposit, account funding or transaction was attempted; the mainnet/testnet route incompatibility and unsigned confidentiality field remain separate limits.

From this directory, run `npm ci --ignore-scripts` to restore dependencies. From the repository root:

```powershell
node integrations/check-installed.mjs
node --test integrations/quotes.test.mjs web/defi-relay.test.mjs contracts/client.test.mjs
node integrations/quote-verifier-mutations.mjs
node integrations/check-live.mjs intents
```

The last command reads the live service and may fail for missing partner access. Supply `LENZ_INTENTS_API_KEY` only in the server process environment. Never put it in browser assets or project notes. Restart an existing local server to load the new server-side module.
