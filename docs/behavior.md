# Behavior and safety boundaries

Chat and the standalone wallet share one identity and ledger. Payments do not require a conversation. Names and avatars help identify contacts visually; they do not authenticate a person. Contact-card imports require confirmation of their source.

## Offline payments

A recipient can receive a locally valid payment and use its output in an onward transfer before reconnecting. A voluntary carrier can submit the signed history to NEAR; no local validator group is required. The carrier cannot change the signed recipient or amount.

Local acceptance remains provisional. A copied wallet can authorize conflicting histories, and offline validation cannot reveal all hidden conflicts. Final settlement checks input consumption and rejects competing use. The implementation does not guarantee redemption of every offline claim. Pending and confirmed value must remain distinct in storage and in the interface.

## Swaps and reservations

A saved swap records authorization and bounds. It is not an executed exchange or a promise of available liquidity. Execution requires a connected route and the relevant contract state. Reconnecting does not start a swap automatically.

A signed reservation must not be released just because its deadline elapsed. Release requires authenticated evidence that the liability is resolved or the earlier authorization can no longer be used. Refunds go to the NEAR account bound by the signature. A wallet success message or transaction hash alone cannot credit a balance.

## Privacy

Encrypted chat, native shielded Zcash and private NEAR settlement are separate claims. Chat files are encrypted, while routing and timing may remain visible. The current NEAR reserve exposes settlement data, including amounts and authorization ancestry. The Zcash companion uses separate test accounts; it does not shield the NEAR reserve.

The local PLONK step proof establishes only its implemented circuit relation. It does not establish a complete private transfer system, private witness delivery or guaranteed offline redemption. The browser, release artifacts, signer and upgrade authorities remain trust boundaries.

## Identity and recovery

Profile edits must preserve existing keys, contacts, messages, balances and reservations. A contact QR contains public identity information and is not a backup. Safe account recovery and new-device portability remain incomplete. Old snapshots and two restored devices can create conflicting authorizations; recovery must reconcile those liabilities before treating funds as available.

## Test scope

tUSD is the Lenz Test Dollar, with six decimals and a zero starting balance. Earlier synthetic funds remain labelled as an earlier prototype. They are not backed tUSD. Browser network emulation does not demonstrate physical BLE, native transport, Safari or iPhone behavior.
