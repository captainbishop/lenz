# Carrier verification

November 1, 2026. Six Node tests pass for signed retention/content, authenticated
mailbox reads, allowed origins, durable storage/restart, quota handling, a three-hop
HTTP route interrupted at its middle carrier, and bounded response streaming.
Three isolated guard removals are detected: packet signature, mailbox authentication
and capacity. [Mutation results](mutation-results.json).

Seven [Windows Edge checks](../web/carrier-browser-results.json) pass with three
disposable profiles, real browser keys, IndexedDB, service-worker offline reloads
and three HTTP/SQLite carriers. The sender could reach only the first carrier and
the recipient only the last. A queued 4-tUSD payment survived reload, crossed the
route after a stopped middle carrier restarted, and returned an encrypted recipient
receipt. The recipient prepared a 1-tUSD onward payment while offline and delivered
it automatically after reconnecting. Backing was a fixture; no chain operation ran.

The checks also cover old-history exclusion, duplicate files without extra credit,
bad signatures, forged custody replies, a hostile inbox row followed by valid mail,
failed browser persistence before network access, preserved identities and absent
settlement receipts. Both themes and narrow/landscape layouts were checked.

The existing social and wallet browser suites passed nine and eight checks.
Thirty-three payment/receipt/status/reservation Node tests passed. Two cache-upgrade
checks preserve an existing identity, encrypted vault and expired swap reservation
across a failed then successful update. The worker is
`proof-u-chat-v31-carrier-network`, with 52 cached routes.

The local launcher also starts three separate Node processes with separate stores;
all three health endpoints and the web app's configured carrier list returned the
expected results. The browser test uses independent server instances in one Node
process. Neither exercise establishes independent remote operators or phone support.

## Container verification

The November 1 Docker Engine 29.9.2 run passed eight checks in a Linux container
on Windows. [Recorded result](container-results.json) includes the image identifier
and exact hashes of its five runtime files and MIT license. The test verified
health, non-root execution, configured filesystem/capability/resource restrictions,
signed encrypted custody, persistence after restart, duplicate handling and
rejection of an invalid mailbox signature. No user wallet or financial transaction
was involved. Docker Compose 5.6.1 accepted the deployment configuration.

The Node 24.21.0 base image is pinned to the verified manifest digest. The initial
build could not find the credential helper until Docker's installed binary
directory was added to the existing terminal's PATH. A subsequent rebuild failed
during Docker Hub DNS resolution; the digest-pinned build and container checks
then passed. HTTPS, separate remote operators and load testing remain unverified.

## Failures retained

- The first browser harness used CommonJS `require` on the server module's
  top-level-await graph. Dynamic import fixed the test bootstrap.
- The installed Playwright 1.62.1 returned immediately for asynchronous
  `waitForFunction` predicates, including a minimal `async () => false` reproduction.
  This made the harness report apparent missing browser state before delivery.
  Explicit polling of completed storage reads fixed the harness. No storage-race
  fix or lost production wallet state was established by that observation.
- A later assertion ran before the wallet's initial render finished. The readiness
  helper now waits for startup rendering as well as completed actions.
- The first packet-signature mutation survived because hash and outer-signature
  checks rejected all the altered fixtures first. The added negative control signs
  a valid outer envelope containing an invalid packet signature; removing the packet
  check now fails the suite. Passing the earlier fixtures alone did not test that guard.
- The restricted environment initially denied the upstream source query. The
  authorized read pinned the source revision cited in the setup guide.
- The restricted host also denied access to the existing video encoder. The
  authorized run rendered all six clips. The recorded states were replayed without
  changing the three stored accounts; 22 frames were visually reviewed. Five video,
  three screen-response and five homepage checks passed.

## Boundaries

Carriers carry encrypted files and never load financial credentials or submit a
transaction. Known conflicting outgoing payments are excluded from automatic
delivery. Signed payment reservations remain under the existing wallet rules.
Unknown senders require a verified contact before acceptance. Expired ciphertext
is removed from carrier queues without deleting the sender's local history.

No global discovery, incentivized relay market, delivery guarantee, Sybil defense,
traffic anonymity, browser background-execution guarantee, native BLE compatibility
or physical Android/iPhone result is claimed. Remote deployment needs operators,
domains and the checks in the setup guide. NEAR, Rhea, Intents, Aurora, Zcash, privacy
and recovery requirements remain active independently of this transport result.
