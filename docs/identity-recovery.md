# Identity and chat recovery

A generated 24-word Lenz phrase recreates the same P-256 signing and encryption
keys. An encrypted archive can carry the profile, contacts and authenticated text
messages. The derivation module stages these results without writing to storage.
The [chat restore flow](legacy-chat-backups.md) can install a signed successor
from an existing-account backup into an empty browser. The [automatic backup flow](automatic-backup.md) derives the same identity
from a passkey without a phrase screen. Optional device-only profiles retain
the earlier name-based onboarding.

The phrase is a Lenz recovery secret. Never enter an existing wallet's seed phrase
into Lenz. Wallet connection keeps that wallet's signing keys with its provider.
A Lenz phrase alone does not recreate missing messages or financial state.

## Key format

`crypto.getRandomValues` generates 256 bits of entropy. The pinned ethers BIP-39
English implementation encodes it as 24 words with its checksum. Recovery accepts
only that length and valid checksum. It uses the decoded entropy directly;
this is a versioned Lenz derivation, not an Ethereum HD wallet derivation, and no
optional BIP-39 passphrase is supported.

HKDF-SHA256 uses salt `lenz/identity-recovery/v1` and separate information labels
`signing/0` and `encryption/0`. If a 32-byte result is not a valid P-256 scalar,
the counter increases, up to 255. Distinct labels separate signing from ECDH.
WebCrypto imports the active private keys as nonextractable. The Lenz ID retains
the existing hash of the public signing and encryption keys and protocol domain;
changing a name does not change it.

Temporary byte arrays are overwritten after use. JavaScript strings, JWK fields,
library internals and garbage-collected copies cannot be reliably erased. A
compromised page or device can use unlocked keys or capture a revealed phrase.
Nonextractability alone does not protect against malicious application code.

## Chat archive

AES-256-GCM encrypts the complete profile/contact/message snapshot. A fresh
32-byte salt and 12-byte IV accompany each archive; the header is authenticated.
The encryption key uses HKDF-SHA256 from the 256-bit entropy with the archive salt
and `lenz/chat-archive/v1` label. This supports randomly generated recovery secrets,
not user-chosen passwords. No raw private key or phrase is written to the archive.
Archive size remains observable.

Before returning a restored identity, validation checks the profile/key binding,
each contact, message signature, recipient and decrypted text payload. Unknown
fields, missing contacts, duplicates, malformed ciphertext and excess sizes are
rejected. Limits are 500 contacts, 1,000 messages and 8 MB of plaintext. Invalid
archives never write to the active account because this module has no storage
interface. The caller receives a staged result marked `chat-only` and
`financialState: not-restored`.

Payment messages, vaults, balances, reservations and other financial fields are
rejected. The module does not silently drop them. Restored signing keys still
have cryptographic authority wherever that identity was previously authorized;
the return marker is not a cryptographic spending lock. Manual product installation accepts the signed successor format. Passkey
sign-in can install its authenticated same-identity archive; both apply
chat-only access checks. Neither restores an archive as a financial account.
Two restored copies can both sign chat messages. No single-device exclusivity
or safe payment recovery is claimed.

A new phrase cannot recreate an existing identity's nonextractable keys. The
separate [existing-account backup](legacy-chat-backups.md) preserves signed text
history with per-message keys and an old-key-authorized successor link. Its
restore flow installs that successor only into an empty account. This identity module
rejects an archive whose keys differ from the supplied phrase's derived keys.

## Verification

Run `node web/verify-identity-recovery.mjs` with the existing Playwright dependency
available through `NODE_PATH`. [Verification](../web/identity-recovery-verification.json)
includes independent HKDF/OpenSSL public-key comparison and deliberately altered
guards. [Browser evidence](../web/identity-recovery-browser-results.json) closes
the source browser context, restores into two new offline contexts, decrypts old
messages, and verifies an existing account in each remains unchanged.

The [implementation](../web/public/identity-recovery.js) uses the
[pinned browser bundle](../web/identity-recovery-build.json). No new package or lock
version was installed. Review covers malformed archives, altered identities,
wrong secrets, signatures, duplicated messages, field substitution and caller
mutation. It does not constitute an external cryptographic audit or iPhone test.
The product restores chat with backup confirmation and signed contact updates.
Encrypted financial-vault recovery and identity revocation are outside this format.
