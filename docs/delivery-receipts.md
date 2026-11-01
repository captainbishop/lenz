# Offline delivery receipts

November 1, 2026. A contact can acknowledge an encrypted message or tUSD payment by choosing **Share receipt** in Conversations. The wallet offers **Save receipt to share** under **Received payment files**, so payments do not require a conversation. Share the encrypted receipt back through the same file handover. The sender opens it in Conversations, or opens a payment receipt through the wallet's Receive action.

Receipts are optional. Opening a file, reloading or reconnecting does not send one automatically. A receipt records the recipient key's acknowledgement of a specific file. It does not prove that a person read the content, that a device will retain it indefinitely, or that money settled. NEAR confirmation and conflict states remain independent and take priority on payment cards. A conflicted payment's chat card no longer offers its download button, matching the wallet's existing behavior.

## Binding and storage

`lenz-delivery-receipt-v1` travels inside the existing signed, encrypted message envelope. The encrypted payload contains only the kind, original message ID and SHA-256 of the original packet's canonical field array, including ciphertext and signature. The recipient signs it with the same existing identity; the original sender verifies both the signature and the exact-file binding. JSON property order does not change the binding.

Generation requires the original incoming file in saved history. The encrypted receipt is committed before the UI exposes it. Repeated sharing returns that same saved receipt. Import requires the matching outgoing file and its actual recipient, and payment receipts must match the selected contract. Invalid signatures, altered content, extra fields and unrelated receipts fail without modifying state. A duplicate receipt adds no message or balance, and receipts cannot acknowledge other receipts.

The optional `receiptToShare` and `receivedReceipt` properties live beside the original encrypted history entry. Existing identities, nonextractable keys, storage namespaces and history remain intact. The UI verifies the saved acknowledgement before showing its status. Receipt handling does not write the tUSD vault, settle a transfer, release a reservation or contact a relay. Like existing messages, receipt routing identities and lengths remain visible; the original message reference is encrypted. This adds no forward secrecy or recovery guarantee.

## Verification

- **55 Node tests** pass across receipt, payment, confirmation, message cryptography and earlier trade behavior. They cover wrong recipient/hash/contract, tampering, duplicates, unsupported files and unchanged encrypted vault bytes, including signed swap reservations and onward transfers.
- **Eight offline Edge checks** use two disposable identities, actual WebCrypto, IndexedDB and file handover. They cover failed storage before sharing, reload, duplicate/forged receipts, chat-to-wallet acknowledgement, wallet-only sharing, conflict priority and both themes. Backing and conflict observations are fixtures; no chain transaction occurred. [Browser results](../web/delivery-receipts-browser-results.json).
- **Four removed guards** cause behavioral test failures: file binding, wallet scope, contract binding and verification of stored receipts. [Results](../web/delivery-receipts-mutations.json).
- Existing browser regressions passed: nine offline social checks, thirteen confirmation checks, eight wallet checks and two cache-upgrade checks. The cache test upgrades the previous published app to `proof-u-chat-v30-delivery-receipts`, including a failed download of the new module, while preserving identity, vault and reservations.

Reviewed fixture views: [light](../web/evidence/delivery-receipt-light.png), [dark](../web/evidence/delivery-receipt-dark.png). These show a received acknowledgement alongside an unresolved payment conflict; acknowledgement does not remove the conflict.

The first negative-test pass exposed two fixture problems: replacing a ciphertext prefix with `00` did not guarantee a change, and a conflict fixture referenced a nonexistent vault property. The tamper test now flips a hex digit and the conflict fixture uses `chainConsumed`. Visual review also found the pre-existing chat download action on a conflicted payment; the corrected behavior is covered by the browser test. These are separate from the retained earlier proof/network failures.

```powershell
node --test web/delivery-receipts.test.mjs web/near-payment-service.test.mjs web/near-payment-status.test.mjs web/peer.test.mjs web/trade.test.mjs
node web/delivery-receipts-mutations.mjs
# With Playwright and Edge available:
node web/delivery-receipts-browser.test.cjs
node web/near-payment-cache.test.cjs
```

Windows offline emulation does not establish physical-phone, Safari or BLE interoperability. Automatic delivery, safe account recovery and private NEAR settlement remain open. Existing Zcash, Rhea, Intents and Aurora evidence retains its separate scope.
