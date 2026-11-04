# Existing-account chat backups

**Chat backups** is available from Wallet → Account recovery and the profile's
storage settings. Prepare a backup, save its 24-word Lenz phrase, check three
words and download the encrypted file. Open that file with its phrase to verify
and read the saved conversations. Saving the page offline permits later offline
opening and reload. Wallet's Save offline also includes this page.

The viewer does not install an identity, replace current contacts or messages,
or restore funds. Closing history, switching actions, pressing Escape or hiding
the page clears its visible phrase and history. Nothing from the archive is
written to IndexedDB or local storage. Theme preference is stored separately.
JavaScript cannot guarantee erasure of strings or garbage-collected memory.

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
key. A continuity link grants no payment authority. The viewer discards the
staged successor keys and shows history only. The link does not revoke the old
identity, choose between competing successor links, automatically update
contacts, or prove exclusive device ownership. Multiple restored copies can
use the same successor keys. A prepared backup covers only its captured history;
it does not recover later messages or an already lost legacy key.

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
