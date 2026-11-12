# Account sign-in and automatic backup

**Create account or sign in** opens the passkey account flow from Wallet and
Conversations. A supported synced passkey creates the account and unlocks it
again. Profile, contacts and authenticated text conversations save locally and
back up automatically. Changes made offline upload after reconnection. Manual
archives and device-only profiles remain optional.

The same passkey-derived account can be open in several browser sessions.
Connected sessions check for newer conversations every 30 seconds and on
reconnection. They merge verified messages, preserve local delivery metadata and
payment records, and keep unsaved local edits. Conflicting message contents or
contact successors stop the merge. Concurrent profile/contact-label edits retain
the local edit during reconciliation; this is not a collaborative text editor.
Message/contact collections merge by identity; deletion is not propagated.

**Backed up** means the current local account revision has a matching durable
acknowledgement. **Waiting to back up** means local changes remain unsaved at the
service. An interrupted upload retries its exact persisted ciphertext. Two tabs
in one browser share an upload lock; separate devices use revision checks.

## Running the account service

Run `node server.mjs` from `web/` with Node.js supporting `node:sqlite`.
The preview serves `http://localhost:4173/account.html`. Chromium passkeys require
a hostname, so `127.0.0.1` links to localhost without moving or clearing account
data. Browser storage and passkeys belong to their original origin.

`LENZ_ACCOUNT_ORIGIN` sets the exact account origin; its Host and Origin must
match account requests. `LENZ_ACCOUNT_DATA` sets the SQLite directory, defaulting
to `.account-data` in the server working directory. SQLite uses WAL and FULL
synchronization and commits before acknowledging. The service stores one current
encrypted archive per account, with a default total limit of 128 accounts and
256 MiB. Replacement writes retain the previous archive if they fail.

The loopback preview stores backups on this computer. It does not provide
off-device durability. A hosted service needs HTTPS on a stable hostname,
persistent storage, storage recovery, capacity controls and deployment review.
The current bounded request/challenge pools are not public-service abuse control.
Origin changes require a migration; they do not move existing passkeys.

## Key and storage boundaries

The browser requests a resident WebAuthn credential with required user
verification and the PRF extension. Creation requires reported backup eligibility
and backup state; those flags do not prove a particular cloud provider synced it.
Unsupported credentials fail before creating the local account.

A 32-byte PRF result feeds HKDF-SHA256 with salt `lenz/account-passkey/v1` and
separate `chat-identity`, `backup-authorization` and `backup-encryption` labels.
The first two use the [Lenz identity derivation](identity-recovery.md) internally.
The phrase is not shown or entered during normal account use. Active private
keys are nonextractable. A device AES-GCM key wraps the internal chat secret so
background backup does not require repeated passkey prompts.

The passkey unlocks local key material. The service authenticates application
challenges signed by the separate backup identity; it does not verify WebAuthn
assertions or attestation. Signed requests bind origin, account, operation,
one-use nonce, revision, prior digest and archive digest. Challenges expire after
60 seconds. This is possession-based application authentication after local
passkey verification, not server-enforced passkey verification on every write.

AES-GCM encrypts the chat archive, accepted contact-continuity links and validated
owner-side private request history. Its
authenticated header binds account, revision and prior digest. The service sees
the separate backup public identity, archive size, timing, revisions and network
metadata. It does not receive readable chat profiles, text, phrases or private
keys. Same-origin code with access to unlocked keys can still read or alter an
account. JavaScript strings and garbage-collected copies cannot be securely
erased.

Known revisions detect stale or conflicting replies. A fresh device has no
independent revision checkpoint, so a malicious service can replay an older valid
archive or withhold the latest one. Encryption does not establish availability
or rollback resistance against that service. Backup limits follow the nested
chat formats and the outer 8 MB plaintext / approximately 16 MB upload bounds;
oversize data fails without truncating history.

## Existing accounts and payments

Enrollment preserves an existing device-bound account and its financial records.
Its encrypted backup uses the [signed successor format](legacy-chat-backups.md).
Restoration installs that successor and original text history into an empty
browser. The old nonextractable keys remain on the source device. Concurrent
legacy/successor histories require verified transfer and are not automatically
merged as one ordinary passkey account.

Sign-in cannot replace an occupied browser account, including one created while
retrieval was in progress. New passkey accounts restore the same chat identity;
legacy accounts restore their authorized chat successor. Both restored forms
apply chat-only access restrictions. Same-ID backups also retain validated private
approvals, disclosure records, receipts and provider updates as restricted history.
Financial vaults, chat payment messages, balances, reservations, receiver permissions
and executor submission journals are excluded. Existing signed approvals retain
their original cryptographic authority. External wallets retain their own keys.
Copying a chat account does not reconcile financial obligations or
authorize duplicated spending. These restrictions are application policy, not
cryptographic revocation or exclusive device ownership.

## Verification

Run `node web/verify-account-backup.mjs` and
`node web/account-backup-browser.test.cjs` with Playwright available through
`NODE_PATH`. The [Node results](../web/account-backup-verification.json) cover
separated keys, encrypted contents, real HTTP/SQLite, authorization, revisions,
quotas, lost acknowledgements and concurrent/idle-session merging. Altered
guards must fail assertions.

The [browser results](../web/account-backup-browser-results.json) exercise native
WebAuthn PRF through a virtual synced authenticator, normal chat saves, offline
reconnection, exact retries after reload, empty-storage sign-in, existing-account
enrollment and actual Web Locks. Three isolated sessions receive the same
disposable PRF input to test account synchronization independently of passkey
transport. This is not a physical-device or cloud-passkey-sync test. Tests use
loopback storage and disposable accounts without financial transactions.
