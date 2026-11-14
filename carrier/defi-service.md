# DeFi receiving service

The receiving service joins the encrypted request inbox to the NEAR testnet
executor. A carrier delivers an approval while its sender is absent. The service
stores it and returns an encrypted storage receipt. Operator-driven ticks check
or execute saved requests and retain encrypted results for their senders. Restart
resumes from the existing inbox and execution journal.

This is a developer integration with synthetic-chain tests. No production key
provisioning, private settlement or live executor deployment is established.

## Identity and authority

The operator supplies an independently provisioned Lenz identity, a `DefiInbox`
bound to that identity and route, and a `DefiExecutor` with pinned chain clients.
The user selects this executor's verified public contact when approving the swap.
Private browser keys are never exported. A request addressed to a different
contact cannot be redirected here.

`createDefiService` requires allowed sender IDs. Signatures, spending terms,
disclosure consent, expiry and conflicts remain checked by the inbox and worker.
Packet contents cannot select the trusted route, code hashes, signer or mode.
The reply database is bound to the executor ID, origin and sender policy.

The default mode is `observe`: `tick()` uses the status-only interface. The
operator must explicitly configure `mode: 'execute'` to run one approved action
per request per tick. No HTTP endpoint starts, advances or retries a transaction.
Ambiguous attempts stay pending; resubmission remains explicit worker recovery.

## Delivery and recovery

The loopback listener implements the existing carrier protocol. `POST /v1/store`
accepts an allowed sender's encrypted request; the original request and return
receipt must be durable before acknowledgement. `POST /v1/inbox` requires the
recipient's signature, correct audience and current timestamp, and returns only
that recipient's encrypted replies. Browser access requires an allowed origin.
The service is separate from a forwarding carrier.

The delivery database retains at most a receipt and latest report per accepted
request, with a default 32 MiB total limit. Receipt admission reserves an additional
200 KiB result slot, including room for report growth. It does not duplicate execution state.
The original inbox retains its own count, byte and per-sender limits. Full reply
storage prevents acknowledgement and further execution until resolved. Capacity
is rechecked on every tick, including after reopening with a lower limit. An
undelivered journal result must be saved for delivery before execution advances. If intake
committed before reply storage failed, a tick recovers the receipt from the original
request. Duplicate delivery and restart preserve that receipt. Expired delivery
wrappers can renew around unchanged signed evidence without extending authority.

Ticks process up to eight requests and rotate through the inbox. Concurrent ticks
on one service coalesce. Closing stops further work and waits for in-flight
operations before closing the reply database. The caller owns the supplied inbox
and worker. Importing the module launches no scheduler or service.

## Wallet outcomes

**Check swap** posts the saved signed approval to the local
`/api/defi/rhea/status` reader. It uses the wallet backend's independently configured
route, checks contract code and funding at one fresh final block, and returns the
actual order. No executor success claim is accepted as this result. Names, photos
and unrelated wallet history are omitted from the read.

The wallet checks request identity, exact terms, finality, output minimum and prior
evidence before committing an encrypted outcome. Late replies cannot update another
active account; failed writes preserve the wallet. Confirmed results survive a
prepared offline reload. Completion/refund refer to the approved receiving wallet.
These reads create no Lenz credit and release no original reservation. Refund
re-entry still requires the backed deposit verification path.

With carrier delivery enabled, Wallet retrieves encrypted receipts and executor
updates automatically. Updates remain pending verification until the separate status
reader confirms the saved approval. Pausing delivery aborts outstanding checks;
offline reloads preserve the evidence and reservations. Reconnecting resumes checks,
including when earlier requests are unavailable. Optional swap configuration cannot
block ordinary chat delivery from starting.

Wallet also accepts encrypted receipt and report files through **Open update
file** on a saved swap. This works offline and preserves the evidence across a
prepared reload. A file must authenticate as the chosen executor's update for
that exact request and recipient. It does not enable carrier delivery. When
connected, **Check swap** verifies the outcome through the separate status reader.

Service-contact provisioning and durable operator key recovery remain integration
work. Tests retain disposable identities across service restarts; this is not a
production key store. Personal browser receiving inboxes remain separate.

## Privacy and verification

The executor sees authorized terms and ancestry. Forwarders see routing identities,
timing and size. Static message encryption lacks forward secrecy; NEAR execution is
public. Private-only approvals do not fall back to this public test route.

Run the verification commands in [defi-executor.md](defi-executor.md) and
[defi-wallet.md](defi-wallet.md). Tests use WebCrypto, ephemeral NEAR SDK signatures,
SQLite, loopback HTTP and disposable browser stores. Funding, chain state and
receipts are synthetic. They do not establish physical-device behavior, independent
hosts, live financial execution or production settlement privacy.
