# Homepage motion and offline flow

November 1, 2026. The homepage has six silent videos with distinct scenes for private messages, offline onward payments and sharing a Lenz ID. Text and vector elements render directly at 1200 × 1320, without scaling up interface screenshots. The sequences are illustrated replays of verified behavior.

The homepage now uses 1200 × 1320 compositions at 30 frames per second. Only the screen tilts; its contextual controls stay still. Light/dark themes, keyboard tabs, reduced motion, viewport visibility and offline playback remain supported. The normal app also received a targeted dark-theme payment-status contrast correction.

## What the sequences show

- **Private chat:** Amina prepares a message offline. The file carries encrypted content; Bola opens it offline. The source run rejected the third profile as a recipient and checked that the packet did not contain the message text. The envelope and local file movement illustrate encryption and sharing; the homepage labels the sequence as an illustrated replay. Routing and timing remain visible. This is not a claim of forward secrecy or protection from a compromised browser.
- **Offline payments:** one existing backed tUSD moves Amina → Bola → Chidi while all three isolated Edge contexts are offline. The second payment spends the exact output of the first. Both remain pending until Chidi reconnects and confirms the history on NEAR. Settlement amounts and accounts are public.
- **Lenz ID:** copy an address, paste it into Add a person, confirm the source and start an encrypted conversation. A fresh zero-balance account supplies the address. Separate browser checks verify the full-key round trip and encryption. An ID is not a recovery backup.

## Financial evidence and replay

[The source run](../web/preview-flow-results.json) used the existing funded test profiles from the earlier [live social test](offline-social-live.md). It made no funding, deployment or swap call. One new 1-tUSD onward-payment sequence settled in transaction [7oLrVJHQWXbPp1zwvinfH68N1UyV648pHDsSNfvdAdmd](https://testnet.nearblocks.io/txns/7oLrVJHQWXbPp1zwvinfH68N1UyV648pHDsSNfvdAdmd). Its two new receipts are recorded at block 275626846. The earlier 4/2/3-tUSD balance snapshot remains historical; this sequence leaves 3/2/4 tUSD locally allocated to Amina/Bola/Chidi.

The homepage clips are **edited replays**, not live executions in a viewer's account. Original captured frames and source hashes are retained. A separate read-only presentation pass decrypts the recorded packets and feeds their observed pending/final states to the current payment-card renderer. It never changes the persistent wallet, signs, restores an old wallet snapshot or calls a financial API. Every profile's complete stored state is compared before and after. This allows better framing and current theme styling without sending another payment or inventing balances.

`node web/reframe-preview-flow.cjs` checks the saved flow through current UI renderers. `node web/render-preview-stories.cjs` creates editable Hyperframes compositions in an external rendering workspace. After Hyperframes checks and visual review, `node web/record-preview-videos.cjs` exports the videos, probes dimensions and duration, and compares decoded scene regions. See [rendering setup](../web/preview-rendering.md). Source captures, public receipts, composition scripts and finished media are tracked; intermediate render files are external.

`node web/verify-preview-flow.mjs` checks the recorded receipt chain, the single settlement route and capture/source hashes. It reads saved evidence, not current chain state. `node web/verify-preview-videos.mjs` checks final media/provenance/cache integrity. Browser verification covers playback, themes, reduced motion, keyboard selection, six viewport sizes, stationary controls, offline loading and account preservation. Windows viewport emulation does not establish phone or Safari support.

## Failures retained

The first capture stopped after receiving the private message because its script tried to close a dialog the app had already closed. The recorded checkpoint prevented repetition; no payment had yet been sent. The resumed capture completed the financial sequence once.

The initial real-time screencast failed the minimum-changing-frame check. The renderer now renders every frame deterministically and checks distinct frame hashes. Visual inspection also found a light frame in the dark set, a clipped decorative payment label, and a low-contrast payment state. Original frames remain unchanged as evidence. The read-only replay corrects framing and waits for each theme. Its first attempt tried to click the intentionally hidden contact list; selection now uses the app's handler before capture. An existing service worker still served old CSS despite Playwright's worker-block option; the recording pass now explicitly bypasses that worker and the browser cache and asserts the computed dark status color. Production caches receive their own normal version update.

These are preview and capture corrections. They do not complete private NEAR settlement, Zcash browser signing, NEAR Intents execution, Aurora execution, recovery or target-device testing.

Actual browser playback also exposed a color-range mismatch: the initial H.264 files inherited full-range JPEG/ICC metadata and displayed washed-out highlights. The encoder now removes the frame ICC side data and writes explicit limited-range BT.709 video. A browser pixel comparison against the source passed before the full re-encode; the playback suite compares all six videos with their source posters to catch a recurrence.

## October 31 verification

Fresh runs passed five homepage checks, five video/account/offline checks, and three screen-response groups covering six viewport sizes in each theme. The media gate verified all six 30-fps clips (2.31 MB total), and the saved-flow verifier checked both receipts and the original/replayed source images. The freshness regression also rejects altered source PNGs. The original missing-response assertion was reproduced before the fix. These checks establish the listed browser behavior and saved evidence, not production readiness.

## November 1 interaction and seeking checks

The full two-sentence message types out before sending. A crossed-out Wi-Fi
symbol marks offline scenes. Click/tap and keyboard controls pause or resume;
previous/next controls use exported scene timings. Theme changes retain the
current playhead. Controls appear on interaction or pause, with visible touch
controls; no pause icon is burned into the video.

The local server and offline cache now return exact video byte ranges. Earlier
capture checks could receive a seek event while remaining at frame zero; the
updated checks assert the requested time and exercise scene navigation offline.
