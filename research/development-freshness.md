# Market overview and artwork, November 7, 2026

Overview displays supported market counts, active USDC spot/perpetual markets,
current funding and dated on-chain reserve/pool observations. Exact market links
clear old filters; missing markets do not fall back to a different instrument.
Manual refresh and save include public on-chain sources. Saved data is available
across sections offline; paused startup still completes its one-shot catalogue read.

Five local vector illustrations and themed solid surfaces distinguish activities.
The artwork registry adds 314 spot/builder mappings backed by 298 WebP images.
Unavailable or unsupported artwork retains a fallback. Both offline workers include
the new modules and images. Provider SVG markup is rasterized before bundling.

The isolated sources passed 50 Node tests, 14 Overview browser checks, 24
Hyperliquid browser checks, 18 legacy stream checks, 24 Degen browser checks and
2 failed/successful offline-cache upgrade checks. Disposable browser checks cover
navigation, delayed data, public snapshots, control focus, artwork and responsive
layout. Root light/dim/dark layouts were also checked at 320, 375 and 1360 pixels;
minimum sampled text contrast was 4.98:1. The isolated base supports light/dark;
its unsupported dim preference resolves to light. A live preview confirmed the
illustrated summary with current market data and restored logos.

These are read-only market changes. Tests do not establish production feed latency,
offline execution or settlement privacy. No paid service, signing or financial action
ran. Existing homepage sources, videos and posters remain unchanged.

# Degen request pacing, November 5, 2026

Public data reads are paced instead of exhausting a minute budget in one burst.
Cold charts have queue priority; bounded fairness prevents trade/history starvation.
Queued reads return retry instructions within ten seconds, and long provider
cooldowns return immediately. Foreground reads cancel when their final viewer
leaves. Saved data returns before its bounded background refresh, retaining its
original timestamp. The native Lenz chart and external-frame restriction remain.

The isolated staged snapshot passed 53 Node tests, 24 general Degen browser
groups, four loading groups, two recovery groups and two offline cache upgrade
checks. Independent reviews reproduced and verified the queue timeout, capacity
and fairness corrections. Browser and Node evidence uses fixtures and disposable
contexts. It does not establish millisecond delivery or unrestricted provider
availability. No paid access, financial action, private record or new media is
included. Recorded homepage source/video/poster bytes are unchanged.

# Degen chart and trade recovery, November 5, 2026

Selected-token candles use one provider request with response identity checks.
Trade sides and quantities follow that token, including quote-side listings.
Saved trades retain their original timestamps during failures. Chart retries
survive feed refreshes and unrelated saved-data updates between tabs.

The exact staged sources passed 42 Node tests, 24 general browser groups,
four loading groups, two recovery groups and two cache-upgrade checks. The
new same-tab regression first observed four requests inside a 30-second retry
window; the corrected code makes one while an interval change starts its own
request. Disposable contexts covered phone and desktop, hostile metadata,
stale responses and preserved fixture identity/vault/reservation state.
No live-provider latency test or financial request ran in this checkpoint.
Provider quota and coverage still bound availability. Recorded homepage app
sources, videos and posters are unchanged.

# Mobile conversation layout, November 5, 2026

An existing profile now opens the message interface on phones, including before
the first contact. People navigation keeps the selected conversation and draft.
The compact options menu restores focus after its dialogs close. Desktop keeps
both panels. Five disposable-browser groups and two cache-upgrade checks pass;
profile regression checks also pass on the working application. No external
message delivery or financial action ran. Physical-device checks remain open.

Ten replayed desktop crops and the original receipt chain match their saved
versions. Videos and posters remain unchanged. The source review records only
the affected code hashes and the unchanged-frame comparison.

# Wallet connection wording, November 5, 2026

The connection prompt uses one short sentence. Wallet account permission,
native balance reads and payment approval behavior are unchanged. The wallet
cache revision refreshes the prompt for saved installations. The current
disposable provider/browser checks pass; no wallet signature or transaction ran.

# Wallet receiving instructions, November 5, 2026

Receive preserves the external wallet address while selecting ETH, USDC or WETH
updates the network-qualified QR. Optional wallet payment links bind a Lenz
identity, wallet signature, exact asset, network and expiry. Only the link
expires; existing addresses and transferred funds are unaffected. Link sharing
discloses the identity/address association and remains under a collapsed section.

Send accepts supported EIP-681 links, verified Lenz receiving links or ordinary
wallet addresses with an explicit receiving network. Changed signatures,
addresses, assets, networks and expired instructions stop before wallet dispatch.
Existing durable transfer recovery, consent and finality checks are retained.

Sixty-nine Node tests and thirty browser groups pass. Four isolated guard removals
fail their named tests. Both themes were visually reviewed on phone and desktop.
The existing recording source/video/poster hashes still match. These checks use
disposable accounts and synthetic wallet responses; no live wallet operation,
deposit, financial transaction or confidential settlement was performed.
Automatic Lenz ID lookup, confidential funding and cross-chain execution are
separate integrations. See [wallet receiving links](../docs/wallet-receiving-links.md).

# Receiving and NEAR AI integration preparation, November 5, 2026

The Intents client validates the asset catalogue and dry same-asset confidential
funding requests. Requests bind the selected asset, integer amount, destination
account, refund address and deadline. Catalogue browsing is not presented as a
working Receive action. No deposit or spendable balance is created.

The prepared NEAR AI component has explicit sharing, signed requests, durable
usage limits and a worker timeout. The pinned Node SDK requests model encryption
and verifies matching model-signed response bytes before returning text. The Lenz
server can read AI text; personal chats and wallet data are excluded. The component
is not mounted on the product chat page before access and useful context are
connected. Browser tests load it explicitly.

Fifty-six Node checks and fifteen browser groups pass, including existing
account-recovery, wallet and cache-preservation regressions. Actual public token
lookup returned 215 assets across 38 networks. The SDK imports locally; audit
reports three low entries from one transitive cryptography advisory. No live
inference, deposit, signing or settlement was performed. See
[receiving](../docs/receiving-assets.md) and [AI preparation](../docs/near-ai-chat.md).
Existing presentation recordings and receipt evidence are preserved.

# Wallet navigation and receiving assets, November 5, 2026

The wallet groups Tokens, DeFi and NFTs beneath the account and actions. Send
and Receive choose tUSD/Lenz ID or the connected native asset/network first.
Account changes invalidate the external asset choice. Payment history, people
and existing offline approvals remain available through expandable sections.
NFT ownership is not connected; the view reports availability without balances.

Seven browser groups cover asset selection, navigation, source-bound account
preservation, invalid fragments, responsive themes and offline cache use.
Existing wallet, connection, balance-visibility, ID, payment, swap, approval and
cache-upgrade suites pass. See [wallet flows](../docs/wallet-tokens.md). These
checks use disposable browser accounts, provider/RPC fixtures and local carriers;
no user funds or financial transactions were used. The tUSD payment asset and
external-wallet authority are unchanged. Presentation recordings are unchanged.

# Market charts and trade history, November 5, 2026

Degen and perpetuals share a locally bundled candlestick renderer with eight
intervals, MA7/25/99, separate volume, UTC readouts and keyboard/pointer chart
navigation. Degen offers scoped chain discovery and a colored trade table.
Duplicate reads share relay responses; provider cooldowns schedule retries,
and validated public candle history survives server restarts with saved dates.

Forty-six local checks and eleven detected guard alterations cover discovery,
interval construction, persistent history, moving averages and the prepared
NEAR AI adapter. Twenty Hyperliquid tape checks and six guard alterations
pass. Browser coverage includes responsive charts, navigation, stale responses,
trade polling and offline caches. See [market charts](../docs/market-charts.md)
for source-bound reports and the distinction between current and saved data.

The NEAR AI adapter has fixture evidence only. No live inference or financial
operation ran. Provider capacity, AI access and physical-device behavior retain
the documented boundaries. Presentation recordings remain unchanged.

# Degen discovery, November 4, 2026

Markets now includes cross-source token search, GeckoTerminal trending/new pools,
exact-pool candles and device-local watchlists. Observations stay read-only and
are grouped by chain/address. The new relay bounds public requests, rejects
redirects and validates pool/token identity. Root and chat caches include the
new screen; query-bearing market navigation uses the cached market document.

Twelve Node checks and six detected guard alterations pass. Twenty-two browser
checks cover 1360/390px, both themes, filters, keyboard candles, watchlists,
source failure, stale replies, safe metadata and category navigation. Live
provider reads and a disposable-browser offline reload pass. Existing six
navigation and six form-control groups pass; presentation sources, receipts,
frames, videos and posters remain unchanged. See [Degen discovery](../docs/degen-discovery.md).

Discovery does not grant execution authority or provide a private trading
route. Saved observations and watchlists use local storage; they are not part
of encrypted account backup. No user wallet or financial operation ran.

# Automatic account backup, November 4, 2026

Passkey account creation and sign-in support encrypted profile, contact and text
chat backup. Local changes upload after reconnection; separate sessions check
for newer chats and reconcile verified content. A matching SQLite commit and
ciphertext acknowledgement establish backup status. Pending financial state
stays on its original device. Legacy enrollment preserves source keys and uses
a signed chat successor for restoration.

Twelve Node tests, twelve browser groups and twelve detected guard alterations
cover separated keys, encrypted archives, HTTP authorization, durable retries,
revision conflicts, quotas, setup races, real Web Locks and three isolated
browser sessions. Multi-session tests seed the same disposable PRF input; native
passkey tests use a virtual synced authenticator. Physical-device cloud passkey
synchronization, hosted durability and funds reconciliation are separate checks.

Recovery, wallet, contact, profile, homepage, form controls and offline-cache
regressions pass. The account service responds on localhost with the preview
carrier configuration retained. Only a challenge was requested from that service.
All ten saved presentation crops and receipt data match the preceding replay;
existing videos and posters remain unchanged. New account and wallet layouts
were inspected in light and dark themes at narrow widths.

The service stores only encrypted archives, a separate backup identity and
revision metadata. Fresh-device rollback against a malicious host and public
service availability require independent protection. Synced chat keys and
application access markers do not revoke older keys or establish exclusive
financial authority. See [account backup](../docs/automatic-backup.md).

# Market navigation, November 4, 2026

Hiding the network picker for Prices previously repeated a visibility mutation
inside the shared form observer and prevented the page from processing clicks.
The wrapper now changes visibility only when its state changes.

The regression fails on the previous implementation and passes with the fix.
Six browser checks cover repeated Prices/Perpetuals/Liquidity/Credit/All markets
switching and hidden/disabled control restoration at three widths. Existing
form-control and live-feed checks pass. The saved presentation replay retains
all ten frame hashes and receipts. Both offline shells refresh the corrected
control. No account or financial state changes are part of this correction.

# Chat installation and contact continuity, November 4, 2026

[Chat restoration](../docs/legacy-chat-backups.md) installs the signed successor
and encrypted original history into an empty browser. Normal Conversations can
exchange new messages; subsequent backups preserve both histories and the same
successor ID. A signed contact update requires a trusted earlier contact and
keeps earlier contacts, messages and financial records.

Nine Node tests and thirteen detected guard alterations cover atomic empty-state
checks, cancellation, encrypted history, trusted updates and application payment
restrictions. Ten disposable Edge browser groups exercise offline installation,
file exchange through the composer, repeated backups, actual Web Locks, failed
IndexedDB writes, occupied-account races, delayed reviews and forced funding.
Light/dark mobile screenshots were inspected. No financial submission occurred.

The browser pass exposed a text-field rule stretching the consent checkbox and
a recovery error falling through to the network-error message. Both are corrected.
Wallet recovery status is visible in the existing connection line; reconnecting
does not re-enable the payment refresh control. History encryption's identity
binding overlaps signed-link validation, so the surviving AAD alteration is
not counted as an independently detected guard.

Contact sharing retains dark text on its white QR card in both themes. The
wallet's general heading rule had overridden that colour; the existing contrast
assertion and visual inspection exposed it. The card rule now takes precedence.
The cache-upgrade fixture loads the historical crypto/payment dependencies
together, then verifies all three new recovery modules in the replacement cache.

The access marker is application policy. It does not prevent hostile same-origin
code from using unlocked keys, revoke earlier keys, reconcile financial liabilities
or establish one-device ownership. Device and external-audit coverage are unchanged.

# Existing-account chat backup verification, November 4, 2026

[Chat backups](../docs/legacy-chat-backups.md) prepare encrypted text history
from existing nonextractable identities and open it in a separate read-only
view. Backup creation checks saved phrase words; opening the downloaded file
verifies its contents. Per-message keys preserve original signed ciphertext
without granting access to later messages in the same old conversation.

Nine Node tests, seven browser groups and twelve altered guards pass. Two fresh
offline Edge contexts restore after closing the source context. Tests preserve
existing keys and financial records, reject invalid archives, discard stale
file reads and clear visible secrets on dismissal. Light/dark phone and desktop
layouts were inspected. The wallet passes six browser groups, wallet actions
seven, form controls six and cache upgrades two.

The first confidentiality regression reproduced decryption of a later message
using an archived static shared secret. Packet-specific keys close that path.
The view does not install successor keys, change contacts or restore funds.
Multiple copies can derive the same successor; old-key revocation, financial
reconciliation and physical-device compatibility are outside these checks.

# Form controls and market picker verification, November 4, 2026

Themed choice menus retain native values and validation across Markets, Drafts,
Wallet and Conversations. Searchable phone market selection, underlined fields,
ink keyboard focus and plain checkbox ticks share the existing page colours.

Six form-control groups and six market-picker groups pass, including keyboard
navigation, disabled choices, safe labels, responsive positioning, 150% CSS zoom
and offline reload. The terminal passes seven groups and one stale-reply guard
alteration; route drafts eleven, DeFi approvals sixteen, market feed lifecycle
eight, wallet six, wallet actions seven and cache upgrade two. Light/dark
screenshots were inspected. Physical devices and screen readers were not tested.

The saved preview states were replayed through current sources. All ten cropped
frames match the previous replay byte for byte; payment receipts and video/poster
bytes are unchanged. Videos were not rerendered. The source review and hashes are
in [preview-control-review.json](../web/preview-control-review.json).

# Identity/chat recovery verification, November 4, 2026

New identities derive separate signing/encryption keys from a 24-word phrase.
Encrypted archives accept profile, contacts and authenticated text chat only;
restoration produces staged data without overwriting an active account. Monetary
records and payment messages are rejected. This does not recover legacy keys,
restore funds or connect the product Create/Restore flow.

Seven Node groups, one browser group restoring into two fresh offline contexts,
and seven detected guard alterations passed. Independent HKDF/OpenSSL comparison
checks derivation; each restored context preserves its existing account. Source
hashes and pinned bundle provenance accompany the reports. Device exclusivity,
financial recovery, legacy migration and external cryptographic audit remain open.

# Wallet and market revision review, November 4, 2026

Selected perpetual markets load public candles on opening, with a faint opposing-L
mark and Lenz wordmark behind the plot. Refresh controls use accessible icons.
Search focus uses an underline. Market statistics and wallet balance breakdowns
are expandable; pending/reserved funds stay flagged. Wallet Supply/Borrow/Liquidity
links open the corresponding market action, whose unavailable execution remains
visible. No simulated balances or deposit forms are shown.

The terminal passed seven browser groups and a stale-reply guard alteration.
Both themes and 320–1440px layouts were inspected. Seven live browser groups
returned 97 candles and 20 book levels per side. Four live oracle groups read all
18 feeds. Four automatic-price groups observed two updates taking 11,358 and
3,116 ms in that run. These timings do not establish upstream availability.

An earlier live run reached the perpetual quote/review but failed to open a swap
because EVM market sources were unavailable. A direct sandbox read returned
Windows EACCES; the authorized read succeeded. After restarting the preview, the
complete live run passed. Earlier missing-market and missing-second-update
failures remain recorded without an established cause. The transfer browser test
now waits for restored encrypted history before checking finality status.

Six original homepage examples were replayed/rendered without repeating funding
or transactions. Composition checks, seven playback groups and decoded visual
review passed; current provenance matches 53 recorded source files. The separate
DeFi gallery and prominent hero placement remain. Product visual acceptance,
Supply/LP execution, private settlement and recoverable onboarding remain open.

# Offline budget rehearsal, November 4, 2026

[Limited ETH budgets](../docs/offline-budgets.md) now have 16 passing local
contract/signing/browser groups and ten detected guard alterations. Disposable
Edge signs and encrypts offline using cached modules, preserves ciphertext across
reload, and hands it in process to an executor for actual isolated EVM execution.
Replay rejection, synthetic recipient output and owner remainder recovery are
verified. Networks moved into wallet settings; cache v58 includes the modules.

Surrounding network, connection and transfer checks pass at 13/eight/nine,
12/seven/six and 25/six/nine Node/browser/alteration groups respectively. Six
wallet and two cache-upgrade groups pass. Eight reports bind 78 current source
hashes; 142 scoped and 678 repository document links resolve. Scope scan: 1,004
files, zero findings; whitespace passes and index stays empty. Settings were inspected
in light/dark desktop and phone views. No full-product visual acceptance claim.

Review reproduced and fixed shared venue-caller reward theft through separate
budget callers. Real token/proxy behavior, private settlement, actual encrypted
carrier handoff, provider routes, production recovery and external finality remain
unverified. No real funds, user wallet operation or deployment occurred. The global
freshness manifest is unchanged; the earlier recording-source drift remains open.

# Wallet network controls — November 4, 2026

[Network controls](../docs/wallet-networks.md): 13 Node tests/eight disposable
Edge groups/nine detected guard alterations pass. Existing connection, transfer,
wallet and cache-upgrade checks pass: 12/seven/six, 25/six/nine, six and two
respectively. Network reports bind final source bytes. Light/dark phone/desktop
screenshots were inspected; no overflow at 320–1280px.
Cache v57 includes the network modules. Scope scan: 989 files/zero findings;
50 top-level links resolve, whitespace passes and index remains empty.

Initial browser assertion failure was traced to native Edge focusing BODY at
dialog Tab wrap; the test now permits that while rejecting outside page controls.
Custom network tests cover consent revocation, metadata changes, failed saves,
same-provider stale replies and preserved pending history. Syntax validation and
matching wallet chain IDs do not authenticate custom networks. No live wallet,
custom RPC, physical device, financial operation or publication occurred.

The global freshness manifest and existing media are unchanged. Prior recording
source drift remains open; this is scoped verification, not full-build freshness,
visual acceptance, recoverable onboarding or complete DeFi execution.

# Connected-wallet sends — November 4, 2026

[Wallet transfers](../docs/wallet-transfers.md) now cover native ETH and reviewed
USDC/WETH through explicit wallet approval. Twenty-five Node tests include actual
isolated EthereumJS execution with recipient balance checks; six new Edge groups
and nine deliberate guard alterations pass. Existing connection verification has
12 tests/seven browser groups/six alterations. Six wallet and two cache-upgrade
groups pass. Source-bound reports match final bytes; both themes and 320–1280px
receipts were inspected. Scope scan: 981 files/zero findings; 50 top-level document
links resolve and whitespace passes. Cache v56 includes all new transfer modules.

The 8985-byte address validator includes pinned dependency hashes/licenses.
Build failures from a virtual esbuild entry and a nested license path were fixed;
the unchanged-chain mutation fixture was corrected. A dark-theme selected-asset
contrast issue was fixed, and duplicate form/review content was removed.
No production contract/dependency lock, deployed code or financial state changed.

Installed-wallet/live-chain fees and finality, physical devices, replacements,
Create/Restore/migration, custom networks and complete DeFi recovery remain open.
No real wallet/signature/transaction was used. The prior four recording-source
mismatches below remain unresolved. The global freshness manifest was preserved;
component verification is not whole-build freshness or visual acceptance.

# Browser wallet connection — November 4, 2026

Whole-build freshness remains unverified: the final command rejects recorded
source drift in carrier-ui.js, contact-card.js, contact-ui.js and nearby-ui.js.
These changes predate this connection slice. The existing videos/posters still
match their recorded hashes; affected recording source review/refresh is pending.
The previous freshness manifest is preserved, rather than certifying this state.
Wallet-specific reports match their current source bytes. Scope scan: 963 files,
zero findings; 48 top-level documentation links and whitespace checks pass.

[Existing-wallet connection](../docs/wallet-connection.md) adds explicit injected
Ethereum/Arbitrum/Base account access, native balances and chain-specific Receive
QR addresses. Eleven Node tests/seven disposable Edge groups and six guard
alterations pass. Six existing wallet, two failed/successful cache-upgrade and
six wallet-actions groups pass; current cache v55 includes both new modules.
No account permission, signing or financial operation used a real user wallet.
The connection leaves Lenz identity/history/vault unchanged in the tested scope.

The initial cancelled-prompt race was reproduced and fixed by invalidating during
cancel/click, before the deferred native close event. Its guard removal fails.
The old wallet test asserted before recipient loading completed; it now waits
for the hidden amount field. The upgrade test had a stale v54 cache name; it now
binds to the worker's current cache and verifies the exact new module bytes.
Theme screenshots now wait for colour transitions to finish before capture.

Provider observations are not independent chain proofs or proof of ownership.
Installed-wallet/device compatibility, Create/Restore migration, custom networks,
send/signing, full DeFi execution/recovery and visual acceptance remain open.
Prior media bytes/provenance were not changed by this slice. Wider historical
market/oracle evidence below was not rerun by the connection checks.

# Automatic markets and Chainlink prices — November 4, 2026

Markets now loads and saves public data automatically. Swap Receive recalculates
on input from the current Base pool price; separately permitted checked quotes
follow after a short debounce. The pause control is under Data settings and the
theme control uses an accessible icon. Cached prices retain their age offline.
See [market workspaces](../docs/trading-workspace.md).

[Chainlink reference prices](../docs/oracle-prices.md) connect 18 feeds on Ethereum,
Arbitrum, Base and HyperEVM. The live browser run read all 18, with exact onchain
identity/precision, round age, canonical-block and applicable sequencer checks.
Thirty-five reader/transport/feed/relay tests and four new browser groups pass.
Existing swap, market, draft, terminal, homepage and cache regressions also pass;
final source-report refresh follows display and cache revisions.

No user wallet, signature, funding, financial submission or deployment was used.
Source updates follow their published conditions; polling is not a latency
measurement. Saved calculations do not implement carrier-delivered fresh prices
or full offline execution. Broader strategies, account positions, private
settlement, recovery and connected execution remain active.

# DeFi action surfaces — November 4, 2026

UX2.2 replaces the stacked market/wallet entry layout with opposing asset amounts,
reserve-limit and position views, a chart/depth workspace with an order rail, and
editable receipt limits. No mandatory NEAR bridge is introduced. Unavailable
account positions, LP ranges/fees, staking/farming and claims are explicit.

Public Hyperliquid candles/depth use strict checked snapshots and fixed native
HTTPS endpoints. Forty Node checks, six tape guard alterations, seven workspace
groups with late-reply mutation, eleven draft UI groups/five mutations, sixteen
wallet DeFi groups, fourteen Markets/quote groups and two cache-upgrade groups
pass. Seven actual provider/browser groups cover perps, Base swap, credit and
liquidity in both themes and responsive layouts. Screenshots were inspected;
visual acceptance remains pending. Wallet guard verification is refreshed
separately. No user identity, funding, signature, financial transaction or deployment.

Chat cache v47 and the home shell include the new surface/tape modules and styles.
Original homepage gallery/recording/media bytes are unchanged. Native HTTPS was
selected after global-fetch EACCES/timeouts while curl and native HTTPS succeeded.
Windows sandbox logon later failed with error 1909; final checks used approved
normal-account execution. The failed attempts remain recorded in continuity.

# Product draft controls and offline cache — November 3, 2026

Markets now saves reviewed Uniswap/Hyperliquid estimates atomically with exact route terms. A separate Drafts page reads encrypted records offline and supports explicit public refresh and revision-checked deletion. The shared identity, wallet ciphertext and reservations are preserved. Quote/provider data remains unauthenticated and non-executable. No signing, financial transaction or deployment ran.

Eleven product browser groups/five UI guard alterations, nine storage groups/seventeen binding and storage guard alterations, 39 Node groups, fourteen existing Markets/quote browser groups and two failed/successful wallet-cache upgrade groups pass. The home shell includes all draft dependencies; chat cache v45 includes Markets/Drafts. Original hero/gallery media bytes and recorded app sources are unchanged. Both themes and responsive modal/page screenshots were inspected locally.

Legacy amount rendering and unreadable-state bugs were reproduced and fixed; viewport changes now retain visible modal focus. Initial root-route cache fixture and native browser-chrome focus assumptions were corrected. Full fees/accounts, private quotes, cross-chain execution, authorization and recovery remain open.

# Route drafts and publication verification — November 3, 2026

November 3: same-chain route/estimate binding and encrypted browser draft storage now pass seven fixture and seven browser groups, with 15 detected guard alterations. Precise Uniswap assets/minimums and explicitly scaled Hyperliquid sizes/limits are checked; private/public substitution and unsupported funding/return legs are rejected. The service remains non-executable, with no product draft controls, offline page cache, signed quote authentication, complete fees/accounts or execution/recovery. Docs: docs/route-drafts.md. No financial action, wallet-identity change or deployment ran.

Public Markets, wallet approvals, homepage/gallery and existing protocol checks were rerun. Wallet copy now names saved swaps/approvals; v44 refreshes the app cache with the tested upgrade path. The original hero recording and existing media provenance are unchanged; the reviewed five-chapter gallery remains illustrative. The route service does not change wallet balances or reservations. All outgoing paths and both prior unpublished commits undergo separate exact-byte publication review.

Retained failures: the first binding test tried to mutate a frozen fixture, corrected by cloning; the early provider guard is redundant with later chain/action/asset checks and not counted as independently detected. A media-check command used a nonexistent singular filename; the corrected plural test passed. Windows sandbox logon later failed with error 1909; authorized checks used the normal account.

# Development freshness review

## Public quote previews, November 3, 2026

[Quote adapters and UI](../docs/market-quotes.md) add Uniswap WETH/USDC simulations
and Hyperliquid buy/sell book estimates. New shared numeric/request validation,
quote modules and the existing market relay retain explicit public consent,
immutable non-executable results and expiry. The ABI adds fixed simulation/read
methods; discovery still uses finalized blocks while quotes use recent blocks.

Nineteen quote tests/19 detected guard changes, 26 discovery tests/20 guard changes
and 38 surrounding regressions pass. Seven new and seven existing Markets browser
groups pass, plus four live quote browser groups. Direct public reads succeeded
for both swap directions and both perpetual sides. Both themes, phone and live
screenshots were inspected. No wallet state, signing, funding or transaction.

The estimate controls precede expandable market statistics. The service-worker
shell adds the two quote modules; original app recording inputs and video/poster
bytes remain unchanged. Account/position checks, full fees, private routes,
objective binding, durable offline approval and execution remain open.

## Markets and concise interface copy, November 3, 2026

[Public market discovery](../docs/market-discovery.md) adds bounded read-only
Uniswap/Aave Base and Hyperliquid readers, a local API, optional offline snapshots,
a Markets screen and exact route candidate matching. Twenty-three tests and
twenty detected guard alterations pass. Thirty-eight surrounding regressions
pass. Seven Markets browser fixture groups and four real API/provider browser
groups pass; no wallet database, financial operation or automatic saved data.

Markets and the homepage DeFi section use short functional headings and fewer
paragraphs. The promotional Markets section is removed. Both themes and phone
screens were visually inspected; seven gallery, five home and three screen
response groups pass. The worker refreshes the changed shell while preserving
cached proof assets and wallet storage. Existing recorded app/video/poster
inputs are unchanged. Full execution, privacy and recovery remain open.

## Homepage gallery and shared route foundation, November 3, 2026

The homepage retains the original hero and working wallet/chat/profile demos,
with a five-chapter DeFi gallery below. Both gallery recordings are exact copies
of the previously decoded design media; their hashes are recorded separately in
[the media manifest](../web/defi-preview-media.json). They show illustrative
flows, not connected markets. Existing application recording inputs are unchanged.
The service-worker shell now includes the gallery modules, styles and both media
themes. Only display preferences use existing homepage localStorage keys.

Fresh browser evidence: seven gallery groups, five homepage groups and three
screen-response groups pass. The gallery covers system/manual themes, preserved
chapters, keyboard control, hold/pointer behavior, offline playback and local-only
GET requests. Both themes and the phone gallery were visually inspected. Static
checks resolve 62 homepage cache routes and 74 chat routes. Desktop Edge evidence
does not establish physical-device compatibility or a completed all-screen design.

The [route foundation](../docs/route-planner.md) has no wallet, storage, network,
signing or dispatch capability. Fifteen tests and eleven removed guards verify
the bounded synthetic scope; 23 existing authentication/quote/relay tests pass.
Live discovery, exact provider deployment/asset/fee evidence, durable steps and
execution/recovery remain open. No dependency or contract changed.

Initial browser checks encountered a stopped app server; the restarted server
passed. A fixture alias masked an intended decimals conflict until one reference
was replaced. The mutation runner initially supplied a file URL to the Node CLI;
the filesystem-path fix passed. Earlier evidence below retains its original scope.

The [cross-chain architecture](../docs/crosschain-defi.md) now explicitly covers
Hyperliquid, EVM liquidity/credit, yield and additional venue actions. This is
active product scope and a shared routing/authorization design, not new execution
evidence. LI.FI Composer/Earn/Perps and Relay documentation was checked; perps
access, exact NEAR/EVM routes and route-wide privacy remain unverified in Lenz.
The completed browser checks below are unchanged by this documentation update.

## DEX privacy and explicit executor delivery, November 2, 2026

The [DeFi workspace](../docs/defi-workspace.md) now requires private execution
by default, exposes DEX amount/rate/slippage controls and offers explicit public
testnet approval. Executor review freezes the person and terms, then saves the
reservation and encrypted request atomically. File/carrier delivery reuses one
saved envelope; storage receipts remain unverified for execution and cannot
change available money. Supply, borrow, liquidity and general withdrawals remain
unconnected, with their availability stated in the interface.

Verification passes 16 new Edge cases and 11 deliberate alterations, 13 existing
wallet-service cases and 11 alterations, 11 Rhea UI cases, five wallet cases,
two cache-upgrade cases and 69 executor/intake/money/carrier regressions. The
service evidence binds unchanged service sources after their carrier import.
No live financial request or personal browser identity is used by these checks.

App cache v43 includes the new modules and preserves saved identity and funds
through failed and successful upgrades. The saved preview flow was replayed
against the current sources without new funding or settlement. All six
compositions were rebuilt, checked with the browser audit, visually reviewed,
rendered and inspected as decoded frames. Seven playback checks pass. The
existing small-text, silent-film, repeated-image and profile-container warnings
remain visible in the external reports; no lint/runtime/contrast error is hidden.
The new profile frames use another disposable identity; the three saved payment
accounts remain unchanged. Public testnet boundaries and the original receipts
remain part of the preview evidence.

Provider documentation describes Rhea's broader cross-chain lending/aggregation,
NEAR confidential/signed intents and Aurora cross-chain signing. Those are
candidates; specific Uniswap/Aave markets, supported private asset routes,
partner access, nearby executor intake, automatic wallet execution, verified
wallet credit and recovery are still open. Earlier sections retain their dated
scope and counts.

## Durable wallet approval, November 2, 2026

The [new browser service](../carrier/defi-wallet.md) saves executor authorization,
the existing Rhea reservation and encrypted handoff together. It preserves one
request across retries and commits before returning a packet or receipt success.
Thirteen Edge cases, eleven deliberate alterations and 63 existing regressions
pass. The test origin uses disposable stores and synthetic funding; no live
financial call or user identity change occurs. The API is not imported by the
app entry points yet, so cache versions and preview videos remain unchanged.
Approval UI, delivery and verified result/credit integration remain open.

## Development checkpoint checks, November 2, 2026

Fresh verification passes 112 application/protocol/authentication regressions,
28 proof/provenance/dependency/worker tests, and 16 reserve plus 26 adapter native
tests. Guard suites pass for intake (13 alterations), executor/recipient (18),
proof provenance (seven) and empty authentication (seven). These suites overlap;
their counts are not a coverage percentage or a count of distinct vulnerabilities.
The web build preserves all twelve recorded browser/metadata file hashes. Eight
dependency metadata policies pass. Existing browser evidence remains dated to
its original runs; it was not relabelled as a fresh device test. The reviewed
preview frames and exact source/video/poster hashes remain unchanged.

## Dependency cleanup and recipient checks, November 2, 2026

The [cleanup record](security/dependency-cleanup-2026-11-02.md) binds the final
Intents helper, proof utility and Rust compression changes. The isolated helper
tree has one dependency and zero advisories; proof tooling retains 15 low entries;
NEAR retains the documented crypto/runtime/maintenance findings. Checks pass 26
authentication/quote/HTTP/receipt tests, seven auth alterations, 28 proof-related
tests and 16/26 native contract tests. Both Wasm builds and the web build pass.
All twelve saved browser/metadata file hashes and seven original proof artifact
hashes match. The cache-provenance discrepancy for older Wasm targets is retained.

The [recipient verifier](../carrier/defi-results.md) is a new developer module;
the combined executor suite passes 21 tests and 18 guard alterations. It is not
imported by the browser and cannot create wallet credit or release reservations.
No app-runtime/cache or preview changes arise from this increment. No new preview
render is required. Earlier sections record their original check counts.

## Intents protobuf update, November 2, 2026

The [protobuf compatibility review](security/intents-protobuf-refresh-2026-11-02.md)
records a scoped cross-major override from 6.11.6 to 7.6.6, its required long
4.0.0 to 5.3.2 change and two removed unused packages. SDK 0.93.0 and complete
ICS23 generated-code package hashes are unchanged. A harmless bytes-default
code-injection regression fails before and passes after. All 25 compatibility,
quote, local HTTP and receipt tests pass; eight npm metadata policy checks pass.
The updated Intents audit has 50 affected-package entries: 22 low, ten moderate,
18 high and zero critical. Earlier 52-entry snapshots remain historical.

No quote implementation, HTTP route, browser source/cache, preview or contract
changed. No video refresh or app cache increment is needed. No user-wallet,
live authentication, signing, execution or deployment ran. Remaining signer
dependencies, bridge coverage, partner access, funded routes, privacy and recovery
requirements remain open. The earlier proof-tooling report's metadata-policy
hash identifies its historical check; the current policy report includes the
updated Intents lock. Original advisory/proof evidence remains unchanged.

## Proof-tooling utility update, November 2, 2026

The [compatibility review](security/proof-dependency-refresh-2026-11-02.md)
updates only `ws` and `underscore`, removing the four high-severity affected-package
entries from the proof-tree registry result. Twenty low/moderate entries remain;
the original snapshot below is historical. Cryptographic package versions and
all seven original artifact hashes are unchanged. The explicit compatibility
record preserves original build provenance while binding the refreshed lock and
installed sources. Its directory digest uses unambiguous file records after a
reproduced delimiter-encoding flaw; the review preserves that failure and the
historical snapshot's comparison limit.

Fresh checks pass 27 tests and seven deliberate provenance alterations. The
browser build and eight-project dependency metadata policy check pass. Generated
asset snapshot digests match; there is no app runtime, service-worker, identity,
wallet, video or poster change from this update. No cache increment or preview
re-export is required for these build-only changes. The combined runner's initial
wrong-directory failure is retained alongside the passing corrected run.

Intents and Rust advisories, proof residuals, full cryptographic/recovery review,
physical devices and executor activation remain open. This slice does not approve
publication or real-fund use. Earlier sections retain their dated scope.

## Executor and security review, November 2, 2026

The developer executor adds pinned final-block checks, durable dispatch attempts
and reconciliation for existing supported NEAR actions. It preserves saved final
observations and prevents a regressed chain response from causing a new dispatch.
Intake conflict slots now bind the spending key, including older per-profile
records. [Executor evidence](../carrier/defi-executor-results.json) passes 18 tests
and 11 guard alterations; [intake](../carrier/defi-inbox-results.json) passes 18
and 13. Wallet consent/atomic reservation, nearby handoff, independent recipient
verification and live executor testing remain required before product activation.

A relay cancellation during initial consent previously opened a socket. A new
pre-construction abort check has a failing-before/passing-after regression and
guard-removal control. Cache v41 loads the exact fixed module after a successful
upgrade; a failed update retains the old offline app without changing identity,
vault or reservations. The relay tooling now has the same lifecycle-script and
exact-version policy as the other seven npm projects. No lockfile changed.

The [component review](security/review-2026-11-02.md) records native reserve/adapter,
Zcash, EVM, browser, ownership-model and dependency results with their limits.
The explicit Solidity proof check passes separately from the 105-test default
Aurora suite. The 52 Intents and 24 proof-tooling affected-package entries remain
unresolved. The offline proof timeout remains unexplained; its failed and passing
reports are both retained. These checks do not resolve private settlement,
restoration, independent release authority, funded routes or device requirements.

The later review assembled all twelve Solidity specialty passes and eight
preparation areas, added their bounded contract scope and retained two unproved
verifier leads. Source checks confirm the reviewed contracts are unchanged. The
[Rust advisory snapshot](security/rust-dependency-audit-2026-11-02.json) adds scans
of three unchanged Cargo locks using a pinned official database. The two NEAR
locks share four vulnerability IDs in native-test dependencies; their Wasm build
trees exclude those packages but retain an unmaintained allocator. The inspector
has zero advisory matches within its narrower scope. Fresh intake/executor/relay
and explicit EVM-proof checks pass; saved wider browser/native/media results were
inspected with their limits. No product dependency or contract source changed.

The saved preview flow was replayed in both themes without changing its three
accounts. All six compositions and decoded-video checks pass; all 22 scene frames
were visually reviewed. The videos total 2.99 MB and bind to 53 source files.
Seven Edge playback checks pass, including offline seeking and unchanged account
data. No new financial flow, funding, deployment, physical-device test or Git
publication ran. The sections below retain their earlier dated scopes.

## Encrypted DeFi intake, November 2, 2026

A developer inbox verifies encrypted Rhea swap and refund-return requests bound to
an owner, executor, exact operation, expiry and explicit public-testnet disclosure.
It commits ciphertext before acknowledging storage, retains conflict records across
expiry/restart and never changes wallet funds. Existing contract signatures and
funding/finality requirements remain in force.

[Verification](../carrier/defi-inbox-results.json) passes 17 local tests and detects
11 guard alterations. Tests exercise actual WebCrypto, SQLite and two loopback HTTP
carriers using disposable identities and synthetic reserve roots. The existing
carrier, reserve, swap and deposit suites pass 31 additional tests. No chain call,
funding, user-wallet change or physical-device test ran.

[Implementation limits](../carrier/defi-inbox.md) distinguish intake from executor
dispatch and settlement. Wallet approval, nearby DeFi handoff, chain execution,
verified results and additional protocol/privacy adapters remain open. The new
module is not imported by the app, so no UI, cache or preview source changes are
required. Existing video/poster source hashes remain applicable. Carrier container
runtime, chain contracts and dependencies are unchanged.

## Wallet display controls, November 2, 2026

The shared Lenz ID dialog uses accessible share, copy and download icons. The
wallet eye button masks balances, payment amounts and saved-swap amounts, with a
browser-local preference that survives tabs and offline reloads. Transaction inputs
and approval amounts remain visible. This changes display privacy, not chain
visibility, payment authorizations or storage encryption. Readiness notices clear
after 3.5 seconds; subsequent errors cancel that timer and remain visible.

[Five visibility checks](../web/wallet-visibility-browser-results.json),
[three ID checks](../web/lenz-id-browser-results.json),
[five wallet checks](../web/money-browser-results.json),
[eight offline payment checks](../web/near-wallet-browser-results.json) and
[two cache-upgrade checks](../web/near-payment-cache-results.json) pass in disposable
Windows Edge contexts. The local swap fixture uses integer base units. Keys,
encrypted vault bytes and outstanding reservations are preserved. Funding responses
in the handover suite are fixtures; no live funding or settlement ran.

The app cache advances to v40. All six Hyperframes composition checks and decoded
video checks pass; seven homepage playback checks cover both themes, gestures,
keyboard, reduced motion and offline use. The ID preview uses the same three symbols.
The saved flow replay preserves its three test accounts and original payment
receipts. The regenerated videos bind 53 presentation sources. Reviewed screenshots
show the icon row and masked wallet in both themes. Backend, contract, Aurora and
dependency-lock sources are unchanged.


## Aurora token-transfer receipts — November 2, 2026

A read-only developer checker binds independent token/from/to/amount expectations
to exact direct-transfer calldata, final successful receipts, canonical true return
and one matching Transfer event. False, absent, malformed and mismatched evidence
cannot become a reported transfer. It changes no journal state or wallet balance.

The full suite passes 105 Aurora tests and one independent SDK check. Eleven new
transfer guard alterations are detected, alongside the existing 24 submission and
receipt controls. Fourteen transfer checks include actual local Solidity/EVM
execution and balance reads. A deliberately dishonest token reports the matching
event without moving balances; [verification and limits](../aurora/engine-transfers.md)
retain that counterexample. Matching events require token/code trust before any
settlement decision. The surrounding NEAR receipts are synthetic, and no live
transaction or funding ran. App, contract, carrier, dependency-lock and preview
sources remain unchanged; their recorded preview provenance remains applicable.


## Aurora access-key preflight — November 2, 2026

The submission journal now checks the exact signed account/key at finality before
broadcast. Restricted receiver/method, nonce bounds, exhausted allowance and
invalid or unavailable evidence stop dispatch without replacing the saved call.
Receipt recovery remains available after revocation. A reproduced reporting race
now gives a concurrent final receipt priority over a failed key check.

The full Aurora suite passes 91 tests plus one independent SDK check. Sixteen
submission and eight receipt guard removals are detected. [Access-key evidence](../aurora/engine-access.md)
records the local and loopback HTTP scope, fixture corrections and remaining
permission/approval boundaries. Verification rejects input changes during a run.
No live transaction, key change, funding or wallet operation ran. Web, preview,
contract, carrier and dependency lockfile sources remain unchanged; their existing
preview provenance remains applicable. User approval binding and funded Aurora
execution remain open.


## Aurora submission recovery — November 1, 2026

The developer journal validates a signed Engine call and commits it before
broadcast. Restart recovery checks the original hash; explicit retry can resend
only the original bytes after checking status. Two reproduced resend regressions
now pass. The complete Aurora suite passes 79 tests, with one additional pinned
NEAR SDK interoperability test. Nine submission and eight receipt guard removals
are detected. [Reproduction and limits](../aurora/engine-submissions.md) and
[source-bound results](../aurora/engine-submission-results.json) describe SQLite
write failures, child-process termination, concurrent access, CLI checks and real
loopback HTTP alongside synthetic receipts.

Aurora status and setup documentation reflect this developer-only capability.
Account authorization, deployment, a funded route and payment-effect verification
remain open. There was no live chain submission, funding or wallet-state change.
Web, contract, dependency lockfile, carrier and preview sources are unchanged;
existing preview provenance remains applicable. This step adds no UI controls.


## Recipient-specific delivery status — November 1, 2026

Chat and wallet show nearby delivery only for the paired recipient. Changing
contacts, refreshing the wallet or disconnecting updates the controls. An active
nearby route stays visible when the browser reports no internet. Carrier and
public-relay consent and send-time checks are unchanged; payment confirmation
remains separate.

The new regression failed on the previous implementation: selecting an unpaired
contact displayed Send. After the fix, eight nearby browser checks and eight
protocol tests pass. Eleven carrier and ten public-relay browser checks pass.
Both cache-upgrade checks preserve identity, encrypted vault and a pending
reservation; the first run exposed a stale expected cache version in the test,
which was corrected before the passing run. The app worker is
`proof-u-chat-v39-delivery-status`, with 68 cached routes and all static module
dependencies present. The optional Meteor adapter loads only for internet-gated
wallet actions.

Six checked preview compositions were exported and visually reviewed in both
themes. Their 3.02 MB of videos match 53 recorded source files. Seven video and
five homepage checks pass, including offline seeking, direct gestures, theme
changes, reduced motion and narrow layouts. The saved payment replay preserves
all three stored accounts and makes no financial request.

These checks use disposable Windows Edge profiles and fixture-backed payments.
No physical-phone test, new live settlement, funding or deployment ran.

November 1 conversation delivery review: chat Send, chat Pay and wallet Send
request automatic delivery after saving their encrypted packet when the existing
carrier preference is enabled. They retain manual file sharing when it is off.
Eleven local carrier browser checks cover the send actions, offline reload,
recipient acknowledgements and cross-tab opt-out. Fifty-five payment, receipt,
message and legacy protocol Node tests pass; the separate freshness regression
also passes. Five browser compatibility checks preserve existing demo records
while rejecting new imports, including when testnet configuration is unavailable.

The app removes demo funding/trading controls and adds a local conversation
wallpaper in both themes. Existing identities, vaults and archived messages remain
intact. Thirty page/theme/viewport combinations, enlarged text and keyboard
navigation pass. Two cache-upgrade checks preserve an encrypted vault and pending
reservation through failed and successful upgrades. The current worker is
`proof-u-chat-v34-conversations`, with 58 cached routes. SVG files now participate
in source freshness checks and preview provenance. Contract execution, private
settlement and recovery capabilities are unchanged. The six light/dark preview videos
and their posters were visually reviewed against 59 recorded sources. The replay
preserved all three saved accounts and made no financial request.


November 1 naming and interface review: ENS Aurora-record lookup and native NEAR
account reads use final blocks and fixed public RPC endpoints. Verification passes
56 Aurora tests, six name API/display checks and four quote-API regressions. Six
removed guards are detected. Three live read-only naming observations are recorded
separately from nine Edge fixture checks. Both themes and desktop/narrow captures
were visually reviewed. [Name evidence](../aurora/names.md) documents missing and
off-chain records, RPC trust, ownership limits and the mutation controls.

The homepage, wallet, conversations, profile editor and developer pages use shorter
copy and expandable explanations. Payment warnings and carrier metadata disclosures
remain beside their actions. Input labels no longer receive the focus outline
intended for visually hidden file inputs. The app worker is
`proof-u-chat-v33-simpler-flow`. Both cache-upgrade checks preserve identity,
encrypted vault and the pending reservation. The preview captures were replayed
from the existing verified payment records; all three stored accounts were
unchanged and no financial action was repeated. Six light/dark videos and their
posters match 59 recorded sources. Name ownership binding, portable login,
signing and funded Aurora execution remain open.


November 1 Aurora receipt review: the read-only transaction checker matches the
expected call against a complete final receipt graph and decodes the returned
Engine result. Forty-three Aurora tests and twelve existing adapter-recovery
regressions pass. Eight deliberate guard removals are detected; the controls bind
the receipt source, tests and codec by hash. Actual loopback HTTP checks cover
redirect rejection and a stalled body. [Transaction evidence](../aurora/engine-transactions.md)
keeps fixture results separate from live execution and payment settlement.
The malformed-Engine-error classification failure and its regression are recorded.
No wallet, contract, dependency lockfile, cache, preview or carrier runtime changed.
Authorization, funded asset routing and durable payment recovery remain open.

November 1 container review: the carrier image includes the MIT license and pins
the verified Node base-image digest. Eight actual container checks verify its
contents, configured restrictions, encrypted custody, persistence and inbox
authentication. Compose configuration validation passes. [Container evidence](../carrier/container-results.json)
records the exact runtime source hashes. Application, wallet, contract and preview
sources are unchanged. Remote HTTPS, independent operators and load tests remain
open; the build failures are retained in [verification](../carrier/verification.md).

November 1 Aurora Engine review: call/view encodings, token mapping encodings and
bounded version-7 result decoding pass 23 tests with the existing Aurora suite.
Four removed codec guards are detected. The live read-only check reports the
expected chain ID and an empty successful EVM view; the configured tUSD mapping
is absent at the checked final block. [Interface evidence](../aurora/engine-interface.md)
retains the earlier query-shape failure and the source/deployed-code distinction.
No wallet, contract, cache, preview or dependency version changed. Authorization,
funded asset routing and settlement recovery remain open.

November 1 repository configuration review: shared exclusions cover build output,
generated browser assets and private runtime data. Dependency discovery follows
Git's file inventory and local exclusions while still checking tracked files.
The dependency-discovery and freshness regressions pass; all seven project npm
lockfiles pass metadata checks. Freshness now covers `.gitignore`. Application,
contract, cache and preview sources are unchanged in this configuration update.

November 1 carrier network review: opt-in delivery now sends new encrypted messages,
payment files and recipient receipts through configured independent carrier servers.
Six protocol/network tests, seven Edge carrier checks and three detected guard
removals pass. A three-hop route recovers after its middle carrier restarts; offline
onward payments remain available. The 33 affected Node regressions, nine social and
eight wallet browser checks, and two cache-upgrade checks pass. Identities, encrypted
vaults and expired reservations are preserved. [Verification](../carrier/verification.md).

The app worker is `proof-u-chat-v31-carrier-network`, with 52 cached routes. Both
themes and narrow/landscape delivery controls were visually reviewed. The existing
recorded flow was replayed through current renderers without changing any of its
three stored accounts. All six videos were rendered; 22 sampled frames were reviewed.
Five playback, three screen-response and five homepage checks pass. Source, poster
and video hashes match. The sandbox denied the existing encoder; the authorized
run completed. This presentation replay did not execute automatic carrier delivery.

New deployment files have a restricted Docker build context and are included in the
freshness gate. The gate also detects drift in Dockerfile, ignore, Compose, proxy and
example-environment files. Publication/freshness regressions pass. Carrier queues
and operator settings remain private. Remote hosting, ingress controls and device checks are still
required. NEAR, Rhea, Intents, Aurora, Zcash, private settlement and recovery code is
unchanged; no funding, deployment or financial transaction ran in this feature.

November 1 Aurora dependency review: pinned EthereumJS replaces the local Hardhat
runner and removes Zod from the clean installation and lockfile. The fresh npm
audit has zero findings. Fourteen Node tests, three VM guard-removal controls,
both contract compilations, the local state/event probe and the existing proof
checks pass. Proof gas, calldata length, runtime size, verifier and circuit hashes
match the recorded measurement. [Verification](../aurora/dependency-resolution.md).
No Solidity, browser, cache or preview source changed, and no deployment, funding
or network transaction ran. The remaining Aurora adapter/asset-route work and all
other integration, privacy, recovery and device requirements remain open. The
older audit observations below describe the dependency tree at those checkpoints.

November 1 Aurora network-reader review: the two read-only network queries now
enforce a streamed 16-KiB reply limit, a deadline through the response body,
matching JSON-RPC IDs and canonical integer results. Seven tests and three removed
guard controls passed; an actual read-only request returned the expected testnet
ID. [Reader evidence and limits](../aurora/rpc-validation.md). The initial sandbox
network failure remains distinguished from the authorized successful read.
The dependency audit still reports four high findings; a compatible patched
Hardhat/Zod combination has not been established. Package versions and locks,
contracts, web sources, caches and preview media are unchanged. This check does
not extend offline payment, privacy, Zcash, Rhea or Intents execution evidence.

November 1 offline delivery review: chat and wallet can generate, reopen and verify
an encrypted acknowledgement of an exact saved file. Delivery status remains
separate from money confirmation; receipt handling leaves vault bytes unchanged.
Chat now removes the download action on a conflicted payment card, matching the
wallet. [Receipt behavior and evidence](../docs/delivery-receipts.md) records 55 Node
tests, eight new browser checks and four rejected guard removals. Existing social,
confirmation and wallet checks passed (9, 13 and 8 respectively), plus two cache
upgrades. The new module is cached in `proof-u-chat-v30-delivery-receipts`.

Both themes and narrow/landscape layouts were checked. Receipt, pending-confirmation
and confirmed-payment captures were visually reviewed. The existing recorded flow
was replayed through current renderers with all three stored accounts unchanged.
All six videos were rendered; 22 sampled frames were reviewed. Five playback,
three screen-response and five homepage checks passed. All 48 app cache routes
resolve, and the recording/source hashes match the updated homepage cache.
NEAR contracts, Rhea, Intents, Aurora, Zcash and proof code are unchanged; their
partner-access, signing, recovery, private-settlement and device gates remain open.
Receipt tests use fixture backing and no financial requests. They do not extend
the earlier live settlement evidence or prove automatic mesh delivery.

November 1 unsigned Zcash output review: the developer page now verifies recipient,
amount, fee, commitments and owned change through the pinned read-only native
inspector. Seven actual Edge checkpoints and final native controls inspected one
unsigned test request; output verification passed and the separate network result
was expired. The request was discarded. Both native balances and transaction
histories match pre-feature evidence. [Output verification](../zcash/payment-effects.md)
records the dummy-signature, fixture-value, report-format and dependency failures.

Forty Node tests, three Rust tests, ten fixture browser checks, six removed output
guards and four expiry guards passed. Light/dark result cards were visually reviewed;
layout checks cover narrow and desktop widths. Dark button borders remain visible. Two cache
upgrade checks preserve identity, vault and reservations with
`proof-u-chat-v29-zcash-output-review`. All 47 static routes resolve, and the six
homepage preview source/video/poster hashes still match: this developer page is
outside those recordings. No preview recapture or financial replay was needed.

NEAR, Rhea, Intents, Aurora and proof code are unchanged. The current component
status retains partner access, external signing, private settlement, recovery and
device gates. Zcash input availability, current witnesses, complete note-encryption
validation, signing approval and submission recovery remain open. Older dated
reviews below retain their original observations.

November 1 live payment-failure review: seven live checkpoints verified actual
NEAR response-loss recovery and a deliberately conflicting offline branch passed
onward. The wallet now identifies its conflicted outgoing file and removes its
download button. [Evidence and limits](payment-status.md) include the original
display failure, pre-submission relay failures, final transaction and unchanged
backing. Four saved-evidence checks and four altered-record controls passed.

Regression checks passed: 25 Node tests, 13 payment-status browser checks, two
cache-upgrade checks, eight wallet checks and nine offline-social checks. The new
outgoing-state assertion failed before the fix. Light/dark conflict cards fit at
375 and 1280 pixels. App cache `proof-u-chat-v28-conflicted-outgoing` preserves
existing storage namespaces, identities and swap reservations.

All six previews were rendered from the saved flow with no financial requests;
the replay preserved the three existing accounts. Twenty-two sampled composition
frames and both new conflict screenshots were visually reviewed. Five playback,
three screen-response and five homepage checks passed; 47 static cache routes
resolve. The encoder initially returned `ENOENT` in the restricted environment,
then rendered successfully with access to the installed executable.

NEAR contracts, Rhea, NEAR Intents, Aurora, Zcash and proof implementations are
unchanged. Their private-settlement, signing, partner-access, recovery and device
requirements remain open. This review closes the bounded live conflict/interruption
evidence gap, not those wider integration requirements. Older dated reviews below
retain the evidence available at their respective checkpoints.

November 1 pending-confirmation review: chat and wallet persist an attempt before
submission, display it after reload, and separate status reads from an explicit
retry of the same signed payment. [Behavior, checks and limits](payment-status.md)
cover 25 Node tests, 12 fixture browser checks, two removed-guard controls and two
cache-upgrade checks. The app cache is `proof-u-chat-v27-pending-confirmation`.
This does not complete live conflict/interruption evidence, recovery or private
settlement. NEAR contracts, Rhea, Intents, Aurora and Zcash implementations are
unchanged; their open gates below still apply.

The offline wallet's eight browser checks and nine social-flow checks passed.
All six previews were rendered again from the recorded flow without financial
requests; the replay preserved all three stored test accounts. Five playback checks,
three screen-response checks and five homepage checks passed. Twenty-two sampled
composition frames and the new pending-state screenshots were visually reviewed in
both themes. The preview refresh initially stopped because the local server was
unavailable; it completed after the server was started.

November 1 documentation review: component summaries distinguish the confirmed native Zcash transfer, unsigned browser review, configured Rhea recovery and remaining integration work. Dated reports retain their original test results and failure evidence. Application, contract and circuit code and recorded media are unchanged by this documentation review.

October 31 payment-status review: chat and wallet now share receipt validation, status checks and confirmation. [Evidence and retained failures](payment-status.md) cover 25 Node tests, 41 grouped Edge checks, cache preservation and a read-only check of six live notes. The new cache includes the shared status module. Six light/dark previews were refreshed by presentation replay with all three stored test accounts unchanged. Live browser conflict/interruption evidence remains open; no contract, Rhea, Intents, Aurora, Zcash, proof or recovery implementation changed in this pass.

Reviewed October 31, 2026. NEAR, Rhea, NEAR Intents, Aurora, Zcash, private settlement and recovery remain active requirements. Progress in one does not complete or defer the others. [Development status](../docs/status.md) records scope and missing prerequisites.

| Area | Evidence checked against the implementation | Remaining gate |
| --- | --- | --- |
| Chat and wallet | Current renderers share identity and tUSD state. [Live social evidence](offline-social-live.md) records funded offline/onward payments and NEAR settlement. Homepage videos now replay a separately verified, existing-funded offline/onward flow and private message handover through current renderers in both themes. Profile clips use fresh zero-balance accounts; see [preview evidence](preview-motion.md). | Recovery, target-device behavior and the broader privacy guarantees remain open. |
| NEAR reserve | [Deposit upgrade](../contracts/upgrade/README.md) preserved 74 existing state entries. Current reserve/config and saved social evidence agree on the testnet contract. | Public settlement still exposes amounts and ancestry. External wallet signing remains unverified after Meteor's recorded 403. |
| Rhea | [Configured recovery rollout](../contracts/adapter/redemption-recovery/rollout-review.md) matches the configured adapter/code hash. Signed swaps, refunds and backed return have testnet evidence. | Other callback stages, external refund signing, aggregate liabilities and independent release approval. |
| NEAR Intents | Installed SDK, authenticated empty payload and fixture quote-signature checks are separate from the [failed confidential quote](../integrations/README.md). | Partner key, supported funded route, live provider signature, signed confidentiality binding and execution/refunds. Testnet tUSD is not a mainnet route. |
| Aurora | [Local EVM and verifier evidence](../aurora/README.md), configured chain ID and package locks exist. The EthereumJS toolchain removes Zod and passes a zero-finding npm audit. | No Lenz Aurora deployment, asset/execution adapter or separate Aurora Intents connection. |
| Zcash | [Native shielded transfer](../zcash/pczt.md) is confirmed. [Unsigned browser review and expiry check](../zcash/payment-freshness.md) are separate; the checked saved payment was expired. | Browser signing approval, current witnesses, safe recovery, ambiguous submission and the shielded ZEC/DeFi route. |
| Private settlement and recovery | [Behavior and safety boundaries](../docs/behavior.md) and existing local proof evidence retain their limited scope. | Full graph-hiding settlement, recipient-controlled authority, durable recovery/reconciliation and actual device measurements. |

This review corrected obsolete funding/integration claims in the homepage, chat About panel, earlier proof page, integration overview and research notes. Historical experiments are labelled by scope, not rewritten to imply capabilities they lacked. Failed requests, the proof timeout and build provenance retain their recorded outcomes. Financial flows were not repeated to make evidence look recent.

## Apply this to every development phase

1. Read the active acceptance criteria and prerequisites for **all** affected components. Inspect source/config and the evidence behind a status claim; a passing fixture, installed SDK or screenshot is not live execution.
2. Update current UI copy, component documentation, development status where behavior or a blocker changed. Keep historical results dated and linked. List unverified paths explicitly.
3. Refresh affected recordings after UI/module changes. Run the relevant behavioral checks, cache checks and video playback/theme checks. Change the appropriate service worker when cached content changes; verify an existing cache can update without altering identity or reservations.
4. Run `node tooling/check-freshness.mjs`. It detects changes across the tracked component sources, configs, tests, JSON evidence and documentation since this review. Inspect the changed areas and update this review before using `--record` to acknowledge them. Recording hashes does not run tests or establish correctness.
5. Before committing, review the exact staged paths/diff and run `node tooling/check-freshness.mjs --staged` to check the staged freshness record and preview provenance. Commit product work and supporting evidence under the author's configured identity. Review all outgoing commits for private information before pushing.

The automated gate detects content drift, including less-visible components. It cannot decide whether a statement is true, detect new upstream vulnerabilities or certify a changing provider/deployment. Those still need targeted inspection and dated evidence. Never refresh evidence by repeating funding, deployment or a completed financial flow without a new scoped reason.

## Video previews

`node web/record-preview-videos.cjs` exports six checked 1200 × 1320, 30-fps H.264 compositions. Chat and payments use the [verified source flow and read-only presentation replay](preview-motion.md); Lenz ID scenes use a fresh zero-balance account. [Rendering setup](../web/preview-rendering.md). Rendering sends no financial request. Original captures, edited frames and receipts are distinct in the evidence. The installed encoder, private checkpoints and intermediate media remain ignored. Use `--frames` to review the compositions before encoding.

The homepage loops the matching video for its theme and selected panel. Tap the left/right half of a preview to change scenes; hold to pause. Arrow keys navigate, and Space or Enter toggles playback. There are no separate playback buttons or decorative dotted path. Videos pause when off-screen or hidden and respect reduced motion. A viewer's account is never opened by playback. There is no embedded wallet or broadened framing permission.

`node web/verify-preview-videos.mjs` checks video/poster hashes against the recorded source snapshot and checks the homepage's cache revision. After recording or changing homepage code, `--update-cache` updates the worker marker only after these media/source checks pass. The staged freshness gate checks the same source and media provenance. It cannot replace visual review: watch the clips and inspect both themes before publishing. The freshness gate now includes source PNGs, so an altered capture also requires review.

`node web/video-previews.test.cjs` checks actual decoding/playback, theme/tab switching, pause behavior, narrow layouts, offline playback and unchanged existing account data. [Recording evidence](../web/preview-recording.json) and [browser checks](../web/video-preview-results.json). Windows Edge coverage is not evidence of Safari/iPhone or Android behavior.

The October 31 preview correction restores pointer tilt on a stable parent region and keeps controls outside the transformed surface. It fixes the actual app’s dark payment-state contrast and advances the app worker cache version. New browser coverage checks six viewport sizes in both themes, stationary controls and reduced motion. Read `preview-motion.md` for the source run, replay boundary and retained capture failures. No contract, Intents, Aurora, Zcash, proof or recovery code changed in this pass; their gates above remain open.

## November 1 internet delivery

[Public relay delivery](../docs/internet-delivery.md) adds a separate privacy choice,
standard NIP-59 wrappers around authenticated Lenz fragments, durable exact-event
retries and existing payment/receipt validation. Fifteen protocol/socket checks,
including a guard-removal control, pass. Disposable Edge evidence is separate from
the public relay acceptance/readback check. nos.lol and Primal accepted test
ciphertext; Damus failed to connect and offchain.pub refused it. The two working
services are the defaults. The fresh dependency audit reports zero advisories
after a transient registry DNS failure.

The app worker is `proof-u-chat-v38-nearby` with 68 routes. Failed and
successful upgrades preserve identity, encrypted vault and an expired reservation.
The existing three-carrier suite still passes eleven checks. No financial API,
funding, deployment or existing account migration is part of this transport work.
NEAR, Rhea, Aurora, Intents, Zcash, private settlement and recovery requirements
retain their existing scope. Public transport does not make asset settlement private.

## Lenz ID and product preview verification — November 1, 2026

Sharing now starts with a stable public Lenz ID. Four codec checks and three
browser checks verify both public keys, canonical encoding, typo rejection,
clipboard/paste, contact confirmation and an encrypted message round trip.
Nine existing profile checks and two cache-upgrade checks preserve identities,
encrypted history, vaults and reservations. No account-recovery claim is added.

Six Hyperframes compositions passed runtime, layout and contrast checks. Each
video has three or four distinct product scenes, rendered at 1200 × 1320. The
exporter checks UTF-8 text, decoded motion, scene regions, dimensions and duration.
All 22 decoded scene frames were reviewed in light/dark phone sheets. The six
files total 3.01 MB. Seven browser checks cover playback, exact offline seeking,
left/right taps, hold-to-pause, themes, visibility and unchanged account storage.
Edge touch emulation also checks cancellation and vertical scrolling without
accidental scene changes. Five homepage checks and three responsive-layout groups
cover both themes and six viewport sizes; physical phone testing remains open. The saved flow was replayed without
financial requests or changes to its three test accounts.

Public delivery also passed fifteen Node and ten browser checks with the final
contact UI, plus three browser security checks. Relay acceptance remains distinct
from recipient delivery and financial settlement. The current videos are labelled
as illustrated replays. Private settlement, recovery, native mesh, Aurora execution
and NEAR Intents execution retain their separate open requirements.

Video seeking uses single-byte-range responses from both the local server and
offline cache. The range parser checks open-ended and suffix ranges, rejects
unsatisfiable requests, and returns exact partial bytes. Browser checks assert
the requested time and scene boundary; a seek event alone is insufficient.
Offline scenes use a crossed-out Wi-Fi symbol, and the complete message is typed
before it appears in the sent bubble. The QR panel keeps dark text on white in
both themes.

## Nearby delivery verification — November 1, 2026

[Nearby transfer](../docs/nearby-delivery.md) adds signed, expiring QR pairing and
direct WebRTC host channels to chat and wallet. Eight Node checks and seven Edge
browser checks cover identity/fingerprint binding, QR decoding, bounded fragments,
private messages, signed receipts, explicit old-history consent and onward payments.
A forced receipt-save failure recovers by resending the exact saved payment after
re-pairing; the recipient is not credited twice. Backing is a fixture, HTTP is
blocked, and there are no financial API calls. Physical devices remain untested.

The cache-upgrade checks preserve identity, encrypted vault and expired reservation
when the nearby module is unavailable, then load the complete module set offline
after a successful upgrade. Three browser security checks pass. Eleven carrier checks and ten public-relay checks also pass. Their consent
remains separate from the temporary direct session.
The preview replay and source provenance are refreshed after the app changes.

## Native market streaming, November 7

Reviewed same-origin public Hyperliquid streaming, interval and lifecycle cancellation, bounded connection recovery, independent chart/book freshness, source ordering and the shared chart cursor/live-edge behavior. Exact isolated checkpoint:44 Node tests,18 streaming browser checks,24 Degen browser checks and2 offline upgrade checks passed. Native reads for BTC, ETH and SOL returned history plus real book/candle events. No account, signing or settlement actions ran. Free external DEX coverage and production-throughput guarantees remain unverified. See docs/market-streaming.md for supported behavior and reproducible checks.

## Hyperliquid catalogue, November 7

Reviewed read-only native spot, perpetual, builder-venue and outcome discovery, including sparse token/context joins, quote units, side selection, text-only templates, malformed-source isolation, cancellable reads, combined stream quotas and delayed-chart labels. Activity navigation opens a matching market automatically. Local logos, inline timeframe buttons, labelled utility icons and neutral focus styling retain the native chart interface. Keyboard selection retains focus; offline navigation explains unavailable history.

The isolated checkpoint passed 50 Node tests, 22 catalogue browser checks, 18 existing streaming checks, 24 Degen checks and 2 offline upgrade checks. The empty-panel reproduction failed before automatic selection and passed afterward. Live reads returned 1,003 markets; native book/trade events were observed across all four instrument classes. Candle pushes were observed for spot/native perps in the final short run and for an outcome in an earlier run. Empty history and a one-sided spot book remained usable. No account, signing, payment or settlement action ran. External-chain pool coverage and a guaranteed delivery cadence remain outside this feature. See docs/hyperliquid-markets.md.

## Shared appearance, November 7

Reviewed shared illustrated headers and local theme-specific artwork across Markets,
Wallet, Drafts, Account, Recovery and Conversations. Light, Dim and Dark have
separate text/surface palettes. Markets retain their richer colours; homepage
frames and selected panels blend their accents into the darker page. Large cards
lift their visual contents while keeping the click target fixed. Action arrows
use the same directional transition. Reduced motion and Motion off remain respected.

Verification: 78 desktop/phone appearance cases, 14 Overview checks, 24 Hyperliquid
checks, 7 appearance-menu groups, 5 homepage groups, 7 gallery groups and 2 cache
upgrade checks passed. Edge-click and drag-away cancellation checks passed. The
saved message/payment replay passed in all three themes with all three stored
accounts unchanged. Existing illustrated media bytes were retained; see
web/preview-style-review.json for the scope. Screenshots and exploratory records
remain outside Git. No new signing, transaction or settlement action ran.
