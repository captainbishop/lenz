# Funded offline social flow

Verified October 31, 2026. The social wallet now has evidence using actual NEAR testnet funding and Rhea execution. The ordinary wallet's **Add tUSD** already calls the deployed reserve; this run exercises that button with isolated profiles instead of supplying fixture backing. tUSD is a test token with six decimals, no cash backing and no claim to dollar value.

The existing contracts passed read-only code/configuration checks, so no deployment or upgrade was needed:

- Reserve: `tusd.lenz-dev-1792984696547.testnet`
- Adapter: `lenz-rhea-1792987934062.testnet`
- Rhea exchange: `ref-finance-101.testnet`, pool 2870
- Output: `wrap.testnet`, paid to the signed disposable receiver `lenz-dev-1792984696547.testnet`

## What ran

The [live browser runner](../web/offline-social-live.test.cjs) passed **13 checks**. Three separate persistent Edge profiles created their own identities and confirmed contact cards. Amina requested **10 tUSD** through the normal wallet. The runner verified the actual final funding record and corresponding token-supply/reserve increases before taking all three browser contexts offline.

The profiles exchanged an encrypted message, then Amina paid Bola 6 tUSD and Bola passed 2 to Chidi through chat. Bola saved a signed 1-tUSD Rhea swap offline, retaining its reservation, and sent another 1 tUSD to Chidi from the standalone wallet. Chat and wallet showed the same balances after offline reloads. Uncached fetches failed and no API calls occurred during those offline steps. Reconnecting did not automatically submit the saved swap.

Chidi then confirmed the latest payment on NEAR. Its ancestry settled four signed transfers: the initial payment, onward payment, swap-input split and final wallet payment. Bola explicitly started the saved swap. Actual Rhea execution returned **0.005550620117927951877093 wrapped test NEAR**, above the signed minimum of **0.005495113916748672358322**. The recipient's balance increased by exactly the output amount. Chat displayed the final payment confirmation.

| Recorded value | Before | After |
| --- | ---: | ---: |
| Total tUSD supply | 423 | 433 |
| tUSD backing in reserve | 410 | 419 |
| Reserve liability | 410 | 419 |
| Adapter's tUSD balance | 0 | 0 |
| Receiver's wrapped test NEAR | 0.035452664883721630117921 | 0.041003285001649581995014 |

Final unspent on-chain notes belong to Amina (**4 tUSD**), Bola (**2 tUSD**) and Chidi (**3 tUSD**). The swap input is consumed by its exact signed redemption identifier. Nine of the ten newly minted tUSD remain reserved for those offline notes; the other one entered the exchange through the adapter. No old note was restored or reservation released by expiry.

## Receipts and verification

- [Funding transaction](https://testnet.nearblocks.io/txns/3m9jDWBJLf6pFZANLwWhikm3asATaD573mTRAsm61jhG)
- [Four-transfer settlement](https://testnet.nearblocks.io/txns/5usRYWFhcRAUrAhHc8Hh5L5fGxFFrpLLT9YxSuevbSLW)
- [Rhea exchange execution](https://testnet.nearblocks.io/txns/CGzEGwn5u8WoW2ZdcsTzwsRxF4KY5vujNBhUYSb3EnKk)
- [Final wrapped-token payout](https://testnet.nearblocks.io/txns/3qUPWMHKq5zT7wrM3tWWp7d3sJHGkxebuQduWeTcQGyZ)
- [Raw browser/API/chain evidence](../web/offline-social-live-results.json), [offline chat](../web/evidence/social-live-offline.png), [swap](../web/evidence/social-live-swap.png), [confirmed conversation](../web/evidence/social-live-confirmed-chat.png)

The runner saved eight transaction hashes directly returned by the API and fetched their final outcome graphs. None contains a failed outcome. The relay also repeats the already-settled ancestry before submitting the swap, but its API does not return that helper transaction hash. Eight is the captured transaction count, not a claim that only eight transactions occurred; these records are not a complete gas-cost report.

A separate [saved-evidence verifier](../web/verify-offline-social-live.mjs) passed **seven checks**. It decodes the actual transaction arguments, verifies funding/transfer/swap signatures, compares all four transfer outputs, reads token/exchange logs and reconciles final notes and balances. Two deliberately altered reports were rejected: a recipient balance changed by one base unit and an invalid swap signature. [Verification and hashes](offline-social-live-verification.json). This verification makes no network requests and submits nothing.

## Scope and failures

This run uses actual signatures, browser storage, contract funding and chain execution. It uses Windows Edge offline network emulation and manual encrypted file handover. It does not establish physical-phone, Safari, BLE or automatic peer-delivery behavior. Only disposable test profiles were used. Separate persistent test profiles and their nonextractable keys remain under ignored `contracts/.testnet/offline-social-live-2026-10-31/` for continuity; never treat those profiles as a recovery mechanism.

The first read-only preflight encountered sandbox network `EACCES`; the approved network retry passed. The live run had no failed test steps or page errors. The first saved-evidence verification incorrectly matched the word “offline” in the online stage “get an actual Rhea quote before going offline.” Inspection showed the only matching request was the intended online quote. Replacing that broad match with the explicit offline stage names resolved the verifier failure. No product or contract change was needed.

Finality and funding records are authenticated through the configured RPC, not a browser light client. Offline copies can still authorize conflicting paths; later settlement selects a valid history. Settlement amounts, keys and ancestry are public. Safe account recovery, private NEAR settlement, browser Zcash signing and its DeFi route, Intents access and external NEAR signing remain active prerequisites. This run is not a security audit or completion of the full product. The original offline-proof timeout remains unexplained and its evidence is unchanged.

## Reproduce without repeating funding

```powershell
node web/verify-offline-social-live.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/offline-social-live.test.cjs
```

The first command verifies the saved evidence offline. The second performs only read-only live preflight against the existing contracts and local server. The original execution command was `node web/offline-social-live.test.cjs --run`. Completed checkpoints prevent that command from funding or executing again; preserve the result file and test profiles together. Do not delete them to manufacture a fresh run as a health check.
