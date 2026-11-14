# Nearby transfer

Open **Nearby** in chat or wallet. Both people must already have added and verified
each other’s Lenz ID. Join the same reachable Wi-Fi network or hotspot, choose the
person, and select **Create code**. The other person scans it and shows a reply QR;
the first person scans that reply. Pasting the codes works too.

Once connected, new messages and payments to that person send directly. Keep both
pages open. **Send saved items** explicitly includes older unacknowledged items;
pairing alone never sends existing history. Closing the dialog keeps the connection
open. **Disconnect**, closing the page or losing the connection ends the session.
Create fresh codes to reconnect; saved items retain their original signatures.

## Carried deliveries

In **Nearby**, expand **Nearby delivery** and turn on **Allow nearby delivery**.
Pair with a verified courier, choose the recipient, then select **Send via** that
person. The courier must also opt in. The sender can close Lenz after **With nearby contact**
appears. The courier keeps an encrypted copy across reloads and forwards it when
paired with the verified recipient, who must also enable carried deliveries.

Previously queued courier jobs retry on reconnection. A recipient's signed receipt
can return through the courier when they meet the sender again. If that return
path is lost, the sender can stop retrying the old job and explicitly select a
replacement courier. Duplicate delivery preserves the original item and receipt;
it does not credit the payment twice.

Turning couriers off pauses new handoffs and admission. **Stop retrying** or
**Stop carrying** removes the local courier job or copy. These actions cannot recall
items already sent to another device, and never release a payment reservation or
remove the source message. An expired source job can be queued again through its
selected courier with fresh retention around the unchanged original item.

This path supports saved chat, tUSD payments, approved Rhea executor requests,
local chain-31337 budget instructions and their storage receipts. Other DeFi
protocols are not yet carried by this module.
Courier storage is encrypted, limited to 32 jobs and 4 MB, including reserved space
for forwarding. A courier accepts at most eight items per sender and each inner
envelope is limited to 90,000 bytes. The sender offers a bounded batch; a courier
with less free storage can reject later items while retaining earlier admissions.
Check each item's status before leaving.

Couriers cannot open the inner content. They can see sender and recipient IDs,
item size, creation time and delivery expiry. Static message keys do not provide
forward secrecy: later key compromise can expose previously captured items.

## DeFi requests

After saving a Rhea approval in the wallet, choose **Send with someone nearby**. Pair
with your courier and select the chosen executor as recipient. The original
signed approval, amount, minimum output, receiving wallet and deadline remain
unchanged. The wallet shows waiting and courier-storage states. Stopping a
courier job does not release the reserved input.

The chosen recipient must enable nearby delivery and receiving swap requests.
Its inbox validates the original sender, signed
request, expiry and locally configured Rhea route. It retains an encrypted
request and a signed storage receipt atomically, then returns that receipt
through the courier. A different approval for the same economic input is
rejected, including after the old approval expires. Inbox limits are 32 requests,
4 MB and eight requests per sender. Failed writes acknowledge nothing.

Open a received request to review its amount, minimum output, receiving wallet
and deadline. Receiving does not execute it. The sender's receipt records only
that the chosen device stored the request; execution status, funds and
reservations are unchanged. A saved receipt can return after approval expiry or
through a replacement courier. A changed DeFi route makes incompatible approvals
unavailable while ordinary chat and saved receipt delivery remain usable.

This uses the existing, explicitly approved public NEAR testnet Rhea route.
Private-required approvals remain blocked; there is no fallback to this route.
Production private execution, connecting this browser inbox to durable executor
dispatch, and independent result reconciliation remain separate work.

## Local spending approvals

The local chain-31337 rehearsal can carry previously approved budget instructions
through the same courier queue. The recipient must separately opt in and be
provisioned with the approved sender, deployment, budget, signer and public
rehearsal policy. A packet cannot supply its own trusted policy. This service API
does not add product funding or signing controls.

The receiving inbox commits the checked request and return receipt together.
Conflicting instructions for the same budget nonce are refused, including after
expiry. Duplicate delivery returns the original receipt. Inbox limits are 32
requests, four MB and eight requests per sender. Failed writes acknowledge
nothing; expiry and pause are rechecked before dispatch and acceptance.

The returned receipt confirms storage only. The sender retains the signed
instruction and occupied nonce; stopping transport never withdraws an instruction
already disclosed or frees that nonce. Private-required policies remain blocked.
Executor submission, independent outcomes, production funding and private
settlement are still separate work.

Chat and payment actions follow the selected recipient. A paired contact shows
**Nearby** even when the browser reports no internet; another contact retains
file sharing unless internet delivery is enabled. Disconnecting clears the nearby
indicator. Wallet refreshes preserve the person selected in an open payment form.

## Network requirements

The app must first be saved from a secure HTTPS origin, or run on localhost. A
plain HTTP LAN address is not a secure browser origin and does not supply the
required WebCrypto, camera and service-worker capabilities. Both devices need a
local route to one another; client isolation on guest Wi-Fi can prevent it.

The data channel uses WebRTC host candidates with an empty ICE server list. No
signalling service, STUN service, TURN relay or public internet relay is configured.
The nearby module does not use the browser’s online indicator to decide whether
the local network is reachable. Public relay/carrier delivery remains a separate
opt-in feature.

The first Edge probe used the browser’s blanket offline switch, which also
prevented its local data channel from opening. The successful checks instead
block web requests while retaining the local interface. They establish direct
transport between three isolated browser profiles on one Windows machine; they
do not establish physical phone, hotspot or cross-platform interoperability.

## Identity and privacy

Offer and answer codes contain the selected sender/recipient IDs, a fresh session,
expiry and the exact SDP/DTLS fingerprint. Each code is signed by the existing
P-256 Lenz identity. The reply also commits to the exact offer. Altered signatures,
wrong recipients, unrelated replies, expired codes, media tracks and relay
candidates are rejected before setting a remote description.

Codes expire after three minutes; a connected session lasts at most thirty minutes.
Codes include temporary connection credentials and local addressing information.
Show them only to the selected person. QR encoding uses bounded gzip compression;
decoding stops at 12,000 bytes to reject oversized inputs. Camera frames are decoded
locally and are not uploaded.

WebRTC protects the channel with DTLS. Transferred files retain their original
Lenz encryption and signatures. Peers and the local network can still observe
traffic and addresses. Static Lenz message keys do not provide forward secrecy.
Nearby delivery is neither anonymous mesh routing nor private blockchain settlement.

## Persistence and bounds

Ordinary Send saves encrypted history before notifying the connected transport.
A packet is at most 205,000 ASCII bytes, split into ordered 8,192-character chunks.
A receiver allows one active assembly, rejects reordering and excess size, and
checks its content hash before invoking the application validator. Assemblies expire
after ten seconds without progress. The receive work queue is capped at 256 KiB;
individual frames are limited to 10,000 characters and a session to 10,000 frames.

Only the selected contact’s packets are accepted. Existing message, payment and
conflict checks still run. Receipt generation and the received file/payment are
committed together before the transport acknowledges storage. The independently
signed, encrypted recipient receipt is what the app displays as acknowledgement.
Neither acknowledgement confirms settlement or guarantees a payment’s value.

Sends are serialized and wait at most fifteen seconds for a storage acknowledgement.
Incomplete, rejected or disconnected transfers never become wallet entries. A lost
acknowledgement can leave a file saved at the recipient while its sender remains
uncertain. Reconnect and resend the same saved item; duplicate validation prevents
another credit. Delivery failures do not release payment reservations.

## Verification

```sh
node --test web/nearby-protocol.test.mjs
node web/nearby-browser.test.cjs
node --test web/nearby-courier-browser.test.cjs
node web/nearby-courier-flow.test.cjs
node --test web/defi-courier-browser.test.cjs
node web/defi-courier-flow.test.cjs
node --test web/budget-courier-browser.test.cjs
node web/verify-budget-courier.cjs
node web/near-payment-cache.test.cjs
```

Eight Node checks cover identity/session binding, expiry, fingerprint tampering,
QR decoding bounds, fragments and an explicit removed-signature-guard control.
[Eight browser checks](../web/nearby-browser-results.json) exercise actual QR
encoding/decoding, real WebRTC host channels, new-message delivery, signed receipts,
explicit saved-history sharing, payments and offline onward transfer. A forced
receipt-save failure closes the connection; resending the exact payment after
pairing again leaves the recipient’s encrypted vault unchanged. A foreign-recipient
code is rejected and both themes fit the narrow test viewport. The recipient-status
regression first failed when an unpaired contact displayed Send. It now checks
contact changes in chat and wallet, wallet refresh, disconnect, internet-delivery
fallback and an offline browser indicator while the local interface stays enabled.

The browser test blocks HTTP after app-cache preparation. The only recorded HTTP
attempts are denied service-worker update checks. Test backing is a fixture;
there are no chain requests, grants, deployments or financial signatures outside
the disposable Lenz payment protocol. [Cache checks](../web/near-payment-cache-results.json)
preserve identity, encrypted vault and an outstanding expired reservation after
both failed and successful updates.

Bluetooth discovery, routed offline mesh, automatic nearby discovery, physical
phones and recovery remain separate work. File sharing remains available when
pairing or local networking fails.
