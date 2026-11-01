# Lenz carriers

Carriers automatically store and forward encrypted Lenz messages, test-dollar
payment files and recipient receipts. Each carrier has its own persistent queue
and operator-selected peers. The browser sends to multiple configured carriers;
carriers forward to their peers even after the sending browser closes.

The recipient checks the existing message signature, decrypts the file and applies
the existing payment validation before saving it. Its encrypted receipt travels
back through the same network. A carrier acknowledgement means only **stored by
that carrier**. A recipient receipt acknowledges the exact file. Neither settles
money or establishes that an offline payment will redeem.

## Run locally

Requires Node.js 24.21.0, including its built-in SQLite module. No npm installation
or wallet key is needed. From the repository root:

```powershell
node carrier/local-network.mjs
```

This runs three Node processes on ports 4311–4313 with separate SQLite queues under
ignored `carrier/.data/`. In a second terminal, start the web app:

```powershell
$env:LENZ_CARRIERS='["http://127.0.0.1:4311","http://127.0.0.1:4312","http://127.0.0.1:4313"]'
cd web
node server.mjs
```

In chat or wallet, open **Delivery** and enable automatic delivery. Both people
must first verify each other's contact cards. Only new files are queued; enabling
does not upload existing history. Open pages poll automatically and resume after
reconnection. Closing every Lenz page pauses browser work; carriers keep forwarding
already stored files. Save the app for offline use after configuring its endpoints.

An expired delivery envelope stays recorded locally and is not automatically
renewed. The user can still share the original encrypted file manually. Expiry
never releases a money reservation or changes a balance. Turning delivery off
stops new requests; in-flight requests and previously stored files can remain.

## Verify the container

With Docker Engine running, build and verify from the repository root:

```sh
docker build -f carrier/Dockerfile -t lenz-carrier:local .
node carrier/check-container.mjs
```

The check uses a disposable container, fresh volume and generated identities. It
checks the configured restrictions, exact runtime source hashes, signed delivery,
restart persistence, duplicate handling and rejection of an invalid mailbox
signature. It removes its own container and volume afterwards. Set
`LENZ_CARRIER_IMAGE` to verify a different locally available image.
[Recorded result](container-results.json).

The build context includes the five runtime files and the MIT license. The Node
base image is pinned by version and digest. Docker may need registry access to
resolve the base manifest even when layers are cached.

## Deploy on separate hosts

For operator independence, use separate hosts and administrators. A three-process
local exercise establishes transport behavior, not independent remote operation.
No hosted carriers or public bootstrap registry are provided.

1. Each operator obtains a server and HTTPS domain, selects up to four peer
   carrier origins, and agrees which Lenz web origins may access its mailbox API.
   The peers form a connected graph; carriers do not discover or trust addresses
   advertised by untrusted packets. A ring routes acknowledgements in both directions.
2. On each host, copy `carrier/.env.example` to a local `carrier/.env`. Set that
   carrier's actual origin, peer array and allowed app-origin array. Origins have
   no trailing slash or path. These are network settings, not financial keys.
3. From the repository root, run:

   ```sh
   docker compose --env-file carrier/.env -f carrier/compose.yaml up -d --build
   ```

   The service runs as an unprivileged user with a read-only application filesystem,
   a persistent data volume and a loopback-only published port. Use one service per
   volume. Pin the verified carrier image digest when deploying. Local container
   checks verify the configured restrictions and volume behavior; they do not
   establish resource-limit behavior under load or a working HTTPS deployment.
4. Put HTTPS in front of the service. `carrier/Caddyfile.example` provides a host
   Caddy template; replace the domain and preserve the original Host header. Restrict
   the raw service port to the proxy. Apply request-rate limits at the ingress,
   monitor capacity/rejections, and avoid request-body or mailbox-identity logging.
   The application supplies bounds and concurrency limits, not Sybil resistance.
5. Configure the web host's `LENZ_CARRIERS` with the independently operated origins.
   For static hosting, supply the equivalent `carrier-config.json` and exact
   `connect-src` origins in the CSP on chat and wallet. Do not expose Lenz's local
   wallet/sponsor server as a public carrier. Carriers run separately and load no
   NEAR or Zcash credentials.
6. Check `/health` over HTTPS, then use disposable browser identities to repeat
   delivery, outage, restart, receipt and expiry tests. Preserve sender/recipient
   evidence separately from a carrier's custody response. Do not use real money.

For a direct Node deployment, the same environment variables are supported, plus
`CARRIER_DATA_DIR`, `CARRIER_HOST` (default loopback) and `CARRIER_PORT` (set 4311
behind the proxy). Run `node carrier/server.mjs` under the host's service manager.
Backups of carrier data contain ciphertext and visible routing metadata; protect
them and respect retention. They are not backups of a user's wallet or keys.

## Protocol and limits

The versioned `lenz/carrier/v1` envelope binds the encrypted packet hash, sender
public keys, creation time and expiry with the sender's signature. Each relay
checks the original packet signature and the carrier signature. Retention is at
most 24 hours, with 60 seconds of future clock tolerance. Clocks should be synchronized.

`POST /v1/store` durably commits to SQLite before acknowledging. `(sender, message
ID)` is unique: a duplicate cannot extend retention or replace content. Live files
are not evicted to accommodate a full queue. `POST /v1/inbox` requires a recipient
signature bound to the carrier origin, timestamp and cursor. It returns up to eight
envelopes ordered by content hash. Read requests may be replayed within the one-minute
window but cannot delete mail. Clients cycle pages so newly inserted lower hashes
are discovered on the next sweep.

The default carrier limits are 256 files, 32 MiB of serialized content, 32 files per
sender, 64 per recipient, eight active requests and four configured peer destinations.
Individual envelopes are at most 204,800 bytes. Requests, streamed responses and
network time have explicit bounds. Peer forwarding uses bounded batches, backoff,
jitter and repeated replication. No discovery address or redirect is followed.
SQLite uses WAL and FULL synchronization; durable storage still depends on the host
filesystem and hardware. Deleted ciphertext may persist in storage remnants or backups.

Encryption protects contents, not routing identities, lengths, timestamps, IP
addresses or the contact graph. The existing static ECDH construction has no forward
secrecy. A hostile carrier can withhold data, lie about storage or deny service;
only the recipient can create a valid receipt. Multiple carriers improve available
paths but do not establish honesty or guarantee delivery. Financial validation
remains outside the transport, and no carrier executes a financial transaction.

## Transport compatibility

The design was checked against Bitchat revision
[`04995f68e470a18d1fc99f86fa326c2a87bab4f2`](https://github.com/permissionlesstech/bitchat/tree/04995f68e470a18d1fc99f86fa326c2a87bab4f2),
including its README, whitepaper, security policy, license, MessageRouter,
MessageDeduplicationService, NostrTransport and BLE fragment handling. Its distinction
between stored, carried and recipient-acknowledged mail informs the delivery model.
No Bitchat implementation was copied. This Lenz HTTP protocol does not interoperate
with Bitchat's BLE/Noise or proprietary Nostr private envelopes. Native BLE discovery,
physical couriers, fragment handling and actual Android/iPhone tests remain open.

## Verification

```powershell
node --test carrier/network.test.mjs
node web/carrier-browser.test.cjs
node web/near-payment-cache.test.cjs
node web/verify-chat-static.mjs
```

Browser checks require Playwright and installed Edge. [Browser evidence](../web/carrier-browser-results.json)
distinguishes actual HTTP/SQLite and browser cryptography from fixture tUSD backing.
See [verification and limits](verification.md) for the checks and retained failures.
