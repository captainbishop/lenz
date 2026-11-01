# Offline money in conversations

[Payment checks and confirmation in chat](payment-status.md) share the wallet's validated final-state handling, including persisted pending confirmation and live conflicting-onward-payment checks. The wallet labels conflicted outgoing files and removes their download buttons. The current app cache is `proof-u-chat-v28-conflicted-outgoing`. The implementation and its recorded checks are described below.

October 31, 2026. Chat Pay now uses the same offline tUSD mechanism as the wallet. Earlier synthetic assets remain under Earlier prototype.

People can exchange messages and pass received tUSD onward with the same local identity. The interface distinguishes local acceptance, pending settlement and final confirmation. Offline validation cannot establish global spend uniqueness; private settlement and account recovery remain incomplete.

## Implemented behavior

- Chat's ordinary **Pay** sends tUSD from the same encrypted vault as the standalone wallet. Its sidebar displays the same available balance. No synthetic grant is created; new accounts still start at zero.
- Both payment entry points commit the signed spend, encrypted outbox and encrypted conversation record in the same IndexedDB update. No shareable file is exposed until the write completes. A user can still pay entirely from the wallet without visiting chat.
- The conversation's file importer accepts tUSD payments only for the configured testnet contract, verifies the encrypted envelope and signed ancestry, and updates the same vault. Reopening a packet through either screen cannot credit it twice. A previously imported wallet payment can gain its conversation record without reviving a spent balance.
- Payment cards show names, amounts, pending delivery/confirmation and a wallet link. Incoming money can be passed onward offline. Cards distinguish local use or reservation from final NEAR confirmation. The file is encrypted; settlement data remains public.
- Earlier synthetic payments/trades remain under **Earlier prototype** in chat, preserving their identity, balances and controls. Those assets are not relabelled as funded tUSD.
- The composer links directly to the wallet's Swap section. Saved swaps show connection guidance, and online-only start/check/recovery/rate controls disable while the browser reports offline. Reconnection changes guidance only: it sends no request, signs no transaction and releases no reservation. Users still choose execution explicitly.
- The initial integration used cache `proof-u-chat-v19-offline-social-money`; the current cache is identified above. IndexedDB namespaces, keys and existing protocol serialization are unchanged. No migration or deletion is performed. New outgoing wallet payments acquire conversation history; older outbox-only records stay available in the wallet.

The shared history retains the prototype's 1,000-message storage limit. Local history and balance commits are atomic, but this is not backup, new-device recovery or synchronization between disconnected copies. The browser's online indicator is a connectivity hint, not proof that the relay or NEAR is reachable.

## Evidence

The separate [live social flow](offline-social-live.md) passed **13 checks** using 10 tUSD minted by the deployed contract, offline onward payments, NEAR settlement and an actual 1-tUSD Rhea swap. Seven saved-evidence checks and two deliberately altered-report rejections passed. No new deployment was needed. The fixture evidence below remains the broader regression coverage and is not relabelled as live execution.

Fresh verification: **54 Node tests**, **50 browser checks** and **41 static cache routes**. The browser breakdown is nine integrated offline-social checks, eight standalone tUSD-wallet checks, eleven Rhea-wallet checks, nine profile checks and thirteen earlier-trade checks. [Source/report hashes and commands](offline-social-verification.json).

The [new social scenario](../web/offline-social-browser-results.json) uses three disposable Edge profiles on Windows. A fixture gives Amina 10 tUSD. With all three contexts offline and uncached fetches failing, Amina sends Bola 6, Bola passes 2 to Chidi, Bola reserves 1 for a swap, then sends another 1 from the standalone wallet. Final available balances are 4, 2 and 3 tUSD, with 1 reserved. The same balances appear in chat and wallet. The scenario records zero API requests and checks encrypted messages, failed storage commits, replay/tamper rejection, offline reload and narrow/landscape layouts. [Conversation screenshot](../web/evidence/offline-social-chat.png).

Initial backing/configuration and browser recovery responses are fixtures. The signatures, encryption, IndexedDB operations and file handovers are actual browser operations. The pre-existing NEAR deployment/live evidence is separate. No new chain transaction, faucet request, deployment, real-fund action or user-profile access occurred. Safari, physical phones, BLE, automatic peer delivery and native interoperability remain untested.


## Failures retained

The first browser run failed at initialization because a new `connection` function was shadowed by an existing DOM variable. Renaming it to `refreshSwapConnection` fixed the demonstrated failure; both affected browser suites then passed. [Initial failure](../web/offline-social-browser-startup-failure.json).

The social test next matched both a chat bubble and its contact-list preview; its selector was narrowed to the messages region. [Test failure](../web/offline-social-browser-failure.json). The legacy trade test initially read an empty string from the newly collapsed Earlier prototype section after reload; the test now opens that section before interacting/reading. No balance fix was made for that test failure. All final suites exited zero.

The earlier proof timeout remains unexplained and its evidence is untouched. Browser Zcash signing and the shielded DeFi route, private settlement, Intents access, external NEAR signing, other adapter callback failures, independent release/signing authority and safe account recovery remain active in [development status](../docs/status.md).

## Reproduce

From the project root:

```powershell
node --test web/near-payment-service.test.mjs web/near-protocol.test.mjs web/rhea-protocol.test.mjs web/trade.test.mjs web/contact-card.test.mjs web/peer.test.mjs
node web/verify-chat-static.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
$env:LENZ_LIVE_TESTNET='0'
node web/offline-social-browser.test.cjs
node web/near-wallet-browser.test.cjs
node web/rhea-wallet-browser.test.cjs
node web/profile-browser.test.cjs
node web/trade-browser.test.cjs
```

The last two browser suites use the existing local server at `http://127.0.0.1:4173`; the others serve local fixtures. Existing cached browsers can use Save for offline use while connected, then reload to pick up the new cache.
