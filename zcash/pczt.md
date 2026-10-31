# Confirmed Zcash payment with local PCZT proving and signing

On October 31, 2026, disposable wallet A sent **0.1 test ZEC** to wallet B in a
version-6 **Ironwood** transaction. Both wallets recorded block **4,563,312** and
**14 confirmations** at known tip **4,563,325**. B's full received amount is
spendable. A retains **0.8999 test ZEC**, and the fee was **0.0001 test ZEC**
(10,000 zatoshis). No additional faucet request or deployment was needed.

Transaction: `04631896603d942c08b3e49e888db627e245e531cfbdcf2916524e53dd077940`.

[Run journal](pczt-results.json), [saved-evidence verification](pczt-verification.json),
[browser results](../web/zcash-companion-after-pczt-results.json),
[browser screenshot](../web/evidence/zcash-companion-after-pczt.png).

## What ran

1. Synchronize A, then create a PCZT from the existing 1-test-ZEC Ironwood note.
   Its two actions pay B and return change to A. The existing ZIP317 fee rule
   selects 10,000 zatoshis.
2. Inspect version, pools, values and transaction ID. Build the proof locally in
   **3.77 seconds**. The original signer returns success but extraction fails
   with `MissingSpendAuthSig` for Ironwood.
3. Build a separate [bounded signer](pczt-support/README.md) using the pinned
   library's Ironwood support. Check actual recipient and change ownership,
   value commitments, note commitments, input nullifiers and keys before signing.
   Wrong amount, excessive fee and a wrong recipient each reject without a signed
   output. Correct signing takes **235 ms**.
4. The original pinned executable extracts the candidate's transaction and verifies
   the proof and signatures in **2.438 seconds**. The transaction ID and inspected
   effects are unchanged. Journal its exact ID and signed-file hash, then submit
   that file through `testnet.zec.rocks`.
5. Synchronize both wallets and check the same mined transaction, confirmations,
   spendable notes and exact balance conservation. In isolated Windows Edge,
   five actual browser checks read the final balances through the existing local
   companion and confirm that no Lenz browser identity/storage is created.

Sixteen companion/HTTP Node regression tests passed. Eight saved-evidence checks
pass and four deliberately altered records are rejected. These are distinct from
the actual signing, submission, wallet synchronization and browser observations.

## Offline and privacy scope

PCZT creation, proof generation, review, signing and extraction ran in separate
local commands under the default sandbox, where a native network attempt failed
with Windows socket error **10013**. Source inspection shows no network calls in
those PCZT paths. Synchronization and submission ran with explicit network access.
This establishes local operation with native network access restricted; it is not
a physical airgap test or a phone/browser prover measurement. Settlement required
reconnection. The known input witness/anchor came from the synchronized wallet.

This is a native shielded Zcash payment. It does not implement Zcash offline onward
transfer, private NEAR settlement, a ZEC↔DeFi exchange route or the normal Lenz
wallet's production signing boundary. The developer browser reads and synchronizes the two separate test accounts and
provides a separate unsigned-payment review; it exposes no signing or send route. Original browser identities, tUSD,
contacts and messages were not accessed or migrated.

Both test wallets and their PCZTs are held on this Windows machine. PCZTs include
private transaction data and remain under ignored `zcash/.testnet/`. This report
deliberately discloses test amounts, addresses and transaction identity to make the
experiment reviewable; equivalent production logs would reveal payment metadata.
The server sees network requests and timing. Shielded transaction contents do not
hide every network-level correlation. No privacy claim about NEAR, Intents or
Aurora follows from this test.

## Failures and remaining work

The initial review expected a change ZIP32 annotation that the creator did not
supply. It stopped before signing; native ownership checks resolved that missing
evidence without regenerating the transaction. The original signer failure is
retained. The first confirmation check correctly refused to finish at seven
confirmations in A; the later check passed at fourteen in both wallets. The
sandbox network denial is distinct from those application results.

Earlier faucet failures, the two unexplained browser refresh failures and the
unrelated original offline-proof timeout are preserved. The source of A's original
1-test-ZEC funding remains unknown.

The completed run refuses to prepare, sign or submit again. Read it with
`node zcash/pczt-test.mjs`; validate saved evidence with
`node zcash/verify-pczt.mjs`. The browser check is
`node web/zcash-companion-live.test.cjs --after-pczt`; it preserves the earlier
funding/browser evidence. None of these commands sends another payment.

Next: a reviewed browser-to-companion signing boundary with explicit transaction
review, pending/expiry handling and recovery; restored-wallet/rescan evidence;
then a supported ZEC↔DeFi route with its exposure boundaries recorded. Private
NEAR settlement, Intents partner access, external NEAR signing and physical-device
checks remain active requirements.
