# Existing-account chat backups

[Automatic backup and sign-in](automatic-backup.md) is the normal account path.
The file workflow below remains an optional recovery method.

**Chat backups** is available from Wallet → Account recovery and the profile's
storage settings. Prepare a backup, save its 24-word Lenz phrase, check three
words and download the encrypted file. Open that file with its phrase to verify
and read the saved conversations. Saving the page offline permits later offline
opening and reload. Wallet's Save offline also includes this page.

Opening history does not change the account. In an empty browser, **Restore chat**
installs the authenticated successor after explicit confirmation. An existing
account can view history but cannot be replaced. Closing history, switching
actions, pressing Escape or hiding the page clears visible secrets and cancels
an unconfirmed review. Leaving the page cancels a pending installation, including an active database
write. An installation already committed remains saved.
JavaScript cannot guarantee erasure of strings or garbage-collected memory.

Restored conversations open in Conversations. Original messages are labelled
**From backup**, with no delivery receipts or payment actions. A separate AES-GCM
device key encrypts their text at rest; newer messages use the regular encrypted
chat store. Installation checks for an empty account inside the same Web Lock
as the IndexedDB write. Existing identities, contacts, messages and additional
stored fields all block installation. A failed write leaves the previous state.

Use **Share contact → Save updated ID** to download the dual-signed public update.
A contact opens it through **Add someone**, reviews it and confirms **Use updated
ID**. Verification requires their saved earlier contact. Its locally chosen name,
earlier ID, messages and payment records remain saved. Different successors for
the same earlier ID are rejected; timestamps do not choose a winner.

A restored account uses its saved phrase for subsequent backups. The file keeps
the original encrypted archive plus an encrypted snapshot of newer chats. Opening
both verifies the same successor ID. The combined limit is 500 contacts and 1,000
text messages, within a 16 MB file. Saving more messages than that does not silently
truncate a backup: preparation fails. Accepted contact-update records and delivery
receipts are not included; saved contact profiles and text history are included.

Only contacts and authenticated text messages are included. The preparation
screen counts excluded payment/trade messages. Financial vaults, reservations,
pending instructions and payment records remain on the source device. The
archive validator rejects monetary fields and financial message payloads;
malformed or unsupported messages stop preparation. Limits are 500 contacts,
1,000 stored messages and 8 MB decrypted archive data. History order follows
the captured local order; it is not an independently verified delivery timeline.

## Cryptographic scope

Existing P-256 keys remain nonextractable. While they still work, the source
device derives an AES key for each archived packet through the existing
ECDH/HKDF message construction. These individual keys and original signed
ciphertexts are encrypted in the backup. Static ECDH shared secrets and original
private keys are not exported. The archived keys cannot decrypt a different,
later message in the same conversation. This does not add forward secrecy to
the underlying chat protocol.

The generated phrase derives a distinct successor identity through the
[Lenz identity format](identity-recovery.md). Both identities sign a
`lenz/chat-recovery-link/v1` link limited to `chat-continuity`. A contact verifying
that link must supply its already trusted old ID. The old signing key also
signs a digest binding the complete archive body, including the link, profiles,
messages and packet keys. Phrase possession alone cannot change that signed body.
Each opened packet must pass its sender's signature and AES-GCM authentication.

The envelope uses AES-256-GCM, fresh 32-byte salt and 12-byte IV, and an
authenticated header. HKDF-SHA256 derives its key from 256-bit phrase entropy
with the `lenz/legacy-chat-archive/v1` label. The phrase is randomly generated;
user-chosen passwords and existing-wallet seed phrases are not supported.
File size remains visible. Someone holding the file and phrase can read its
contents and derive its successor signing/encryption keys. Protect both.

The successor has different signing keys and cannot spend notes owned by the old
key. A continuity link grants no payment authority. Installed successors carry a
chat-only access marker. Application checks reject financial signing, incoming
payments and encrypted payment-vault access/writes. The payment service also
rejects recipients learned through chat updates. The wallet displays unavailable
offline funds and disables their actions; external wallets retain separate keys.

These are application restrictions, not cryptographic revocation. Hostile
same-origin code can remove metadata or invoke unlocked CryptoKeys directly.
Neither the marker nor the signed update revokes an old identity or establishes
exclusive device ownership. Multiple restored copies can use the same successor
keys. A prepared backup covers only its captured history; it does not recover
later messages, an already lost legacy key or financial obligations.

## Verification

Run `node web/verify-legacy-recovery.mjs` with Playwright available through
`NODE_PATH`. [Nine Node tests](../web/legacy-recovery-verification.json) verify
independently decrypted/re-encrypted OpenSSL archives, altered signatures,
identity binding, financial exclusions, caller mutation and later-message
confidentiality. Twelve altered guards must fail assertions.

[Seven browser groups](../web/legacy-recovery-browser-results.json) cover file
download/phrase checks, signed history in two fresh offline Edge contexts after
closing the source, unchanged existing keys and financial records, stale file
reads, invalid input, safe text, secret clearing and offline app dependencies. Both themes, phone,
landscape and enlarged text were inspected. These checks do not establish
physical-device compatibility or an external cryptographic audit.

Run `node web/verify-chat-restore.mjs` and `node web/chat-restore-browser.test.cjs`
for installation. [Nine Node tests and thirteen detected guard alterations](../web/chat-restore-verification.json)
cover empty-state/cancellation races, history tampering, signing policy, valid
payment rejection, vault access and trusted contact updates. The history AAD
and signed-link identity checks overlap; neither is claimed as an independently
necessary guard. [Ten browser groups](../web/chat-restore-browser-results.json)
exercise offline installation, composer/file exchange, signed contact updates,
repeat backups, failed writes, real cross-tab locks, stale reviews and a forced
funding submission. The server receives no financial submissions.
