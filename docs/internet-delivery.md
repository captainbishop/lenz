# Internet delivery

In chat or wallet, open **Delivery** and enable **Internet delivery**. Both people
use their existing Lenz profiles and verified Lenz IDs or existing contacts. No Docker installation,
server address, Nostr account or additional wallet key is needed.

Send saves the encrypted file first. Lenz retries while a page is open and connected,
including after an offline reload. Only newly prepared files and previously queued
files are eligible; enabling does not upload existing history. The recipient checks
the original sender and payment, then returns a signed, encrypted receipt. A relay's
storage acknowledgement never marks a file delivered or a payment settled.

The defaults are `wss://nos.lol` and `wss://relay.primal.net`.
[Public browser evidence](../web/nostr-public-results.json) records acceptance and
same-session readback of fresh test ciphertext on both. Damus failed to connect
and offchain.pub refused the test file in that run. Availability and relay policies
can change. File sharing and separately configured [Lenz carriers](../carrier/README.md)
remain available. For peers on the same local network, [nearby transfer](nearby-delivery.md) uses signed QR pairing and a direct data channel.

## Privacy and retention

Public relays see IP addresses, directional mailboxes, encrypted sizes and timing.
They may retain ciphertext indefinitely. The signed Lenz sender/recipient identifiers
and payment contents are inside an additional encrypted wrapper. This reduces exposed
routing information but does not provide anonymity or forward secrecy. A compromised
contact/device key can expose past messages.

The public-relay choice is separate from the existing carrier setting. Turning it off
stops new requests and closes active exchanges; data already sent cannot be recalled.
Lenz accepts a transport envelope for at most 24 hours and never renews it silently.
Transport expiry does not release a payment/swap reservation or change a balance.
A pending or expired file can still be shared manually.

Private delivery does not make NEAR settlement, ETH, ERC-20 assets or DeFi execution
private. This transport submits no blockchain transaction.

## Wire format and bounds

The existing nonextractable P-256 ECDH key and verified contact key derive a
directional mailbox with HKDF-SHA-256. Domain `lenz/nostr-envelope/v1`, sender ID,
recipient ID and a bounded scalar counter separate it from other uses and directions.
Derived secrets remain in memory. Identity and contact schemas are unchanged.

Pinned `nostr-tools` 2.25.4 supplies standard NIP-44 encryption and NIP-59 wrapping.
Fresh ephemeral Nostr signing keys wrap each fragment. The rumor uses kind 30078
with a Lenz domain tag and contains Lenz data, not interoperable Nostr chat text.
This is not Bitchat private-message interoperability. No Bitchat implementation
was copied; [transport comparison](../carrier/README.md#transport-compatibility).

Each fragment carries a P-256 sender signature over the envelope hash, participants,
creation/expiry, index, count and chunk. The receiver verifies the outer wrapper,
inner seal, rumor hash and Lenz signature before retaining a fragment. Complete
assembly checks the envelope hash, original packet signature, retention signature
and existing message/payment validation. Duplicate imports cannot add another credit.

- Envelope: 204,800 bytes; up to 25 ASCII chunks of 8,192 characters.
- Wrapped event: 32 KiB. A socket exchange receives at most 8 MiB; requests time out.
- Reassembly shared across relays: 32 pending envelopes and 409,600 retained chunk bytes.
- Durable sender queue: at most 1,000 entries and 6 MiB of serialized active events.
  Completed/expired entries release their event bodies but retain their IDs.
- Per exchange: at most 32 sends and four contacts, with two inbox pages per contact.
  Time boundaries are inclusive; tied timestamps expand from 128 to 512 events.
  Saturation stops with an error instead of skipping unseen fragments.
- Retry: normally 15 seconds, with failure backoff capped at 60 seconds. Retries
  use the exact events committed before the first request, until receipt or expiry.

Malicious relays can lie about storage, withhold data, truncate pages or deny service.
Limits bound application processing; they cannot guarantee delivery or prevent every
traffic-analysis or denial-of-service attack. Browsers can suspend background tabs.

## Build and hosting

The checked browser bundle and third-party licenses live in
`web/public/nostr-vendor/`. Rebuild from the repository root:

```sh
npm ci --prefix web/nostr-tools --ignore-scripts
node web/nostr-tools/build.mjs
node --test web/nostr-protocol.test.mjs web/nostr-socket.test.mjs
node web/nostr-browser.test.cjs
```

Browser tests require Playwright and installed Edge. The local server reads
`web/public/nostr-config.json` and permits only those WebSocket origins on chat and
wallet. Static hosts must supply the same exact `connect-src` origins. Secure WSS
is required except for loopback test relays. Save the app offline after configuration
changes. Keep the local sponsor/wallet server private.

## Verification and limits

Sixteen Node checks cover direction/contact separation, independent NIP-59 decoding,
fragment loss/reordering/duplicates, signatures, expiry, capacity, pagination,
relay refusal, forged acknowledgements, disconnects and opt-out. Removing the
fragment-authentication guard admits the forged negative control.

The November 2 review reproduced a cancellation race: an abort during the initial
asynchronous consent check could still open a relay connection. The socket now
checks cancellation again before construction. The regression failed before the
fix and passes afterward with zero sockets opened. This was a connection-metadata
exposure; no message or payment transmission was demonstrated. Cache v41 carries
the fix, with failed/successful update checks preserving identity and reservations.

[Browser evidence](../web/nostr-browser-results.json) uses disposable Edge profiles,
real WebCrypto/IndexedDB, actual Send actions and loopback WebSocket relays.
It checks delayed receipt, offline onward payment, reload, storage failure before
network access, cross-tab opt-out and light/dark layouts. tUSD backing is a fixture;
the recorded run makes zero chain API requests. Separate
[cache-upgrade evidence](../web/near-payment-cache-results.json) preserves an existing
identity, encrypted vault and expired reservation after failed and successful updates.

The public check publishes only newly generated test ciphertext. Its same-session
readback is not a retention guarantee, a two-device result or proof of independent
operator reliability. Native BLE, Android/iPhone validation, portable identity
recovery and private settlement remain unfinished.

The first protocol run stopped on a test import that used the package root instead
of its NIP-59 module. The first browser fragmentation assertion used a message small
enough for one event; the corrected input fits the composer and requires multiple
fragments. A fresh npm audit initially failed DNS resolution; after DNS recovered,
the same pinned dependency tree returned zero advisories. These were test/environment
failures, not evidence of lost user state. The existing security browser test also
used a retired button label; its selector now targets the current profile button.
