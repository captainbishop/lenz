# Lenz interface design

The homepage now includes the five-chapter DeFi gallery below the original hero
recording. Light and dark page/gallery backgrounds match; both media themes,
chapter selection, keyboard controls, hold-to-pause and pointer tilt work from
the offline cache. The gallery is visibly illustrative. This homepage slice
does not complete the market, wallet, chat and recovery interface work below.

Lenz needs a recognizable visual identity across conversations, markets, positions,
payments, approvals, recovery and every empty/error state. The visual standard is
bespoke product design, reviewed on actual screens. A popular component template
or an attractive colour palette alone does not meet it.

## Visual foundations

- Use the two opposing L forms as the identifying mark. Their open corners and
  opposing alignment can inform selection/focus and the direction of movement;
  avoid repeating the logo as decoration behind every panel.
- Keep warm paper `#f5f5ef`, forest `#173f35`, ink `#193b31` and lime `#e1efa6`.
  Lime identifies the primary action or selected state. Dark surfaces use
  `#14291f` and `#20382b`, with readable text `#edf3e9`.
- Use Georgia for short display headings and Segoe UI for controls and reading.
  Use tabular numerals for financial values. Type hierarchy, aligned baselines
  and whitespace do more work than shadows, gradients or outlines.
- Use a deliberate 8-pixel spacing rhythm. Large financial workspaces use
  unequal columns according to the task; dense data uses rows and separators.
  Avoid making every item the same rounded card.
- Draw functional icons as a consistent SVG family. Use verified token/chain
  assets where available; a fallback symbol must not impersonate a token logo.

## Screens should fit their work

Keep the recorded product screen in the homepage hero beside the main statement.
New market, position and route views belong further down the page. Broaden the
demonstration to cross-chain actions, Hyperliquid, yield and position management
while distinguishing tested recorded behavior from proposed integrations.

The exchange is a market workspace with token/chain discovery, route comparison,
price context and a clear order area. Perpetuals need a real order book/chart,
position and margin controls. Yield needs position/exit information and sourced
rates. None should be a renamed copy of the swap form.

The [market workspaces](trading-workspace.md) use action-specific compositions:
opposing asset amounts joined by a swap route; sourced credit limits and position
actions; pool assets, ranges and fees; and price/depth above a compact order rail.
Phone perpetuals use Chart/Book/Order tabs. Reviews are editable receipts with
inline limits. Wallet swaps use the same opposing asset alignment.

Do not reuse stacked entry forms across DeFi actions. Necessary inputs belong
inside their asset, position or reviewed transaction. Unsupported actions show
their unavailable position data, without simulated rates or placeholder entry
forms. This applies to liquidity, staking, farming, claims and exits as well as
perpetuals. Use sans-serif/tabular type on financial workspaces; reserve display
serif for appropriate homepage content. Screenshots support review; user visual
acceptance remains pending.

Conversation screens should emphasize people, readable messages and delivery.
The wallet should distinguish spendable offline value, pending money and positions.
An approval is a readable receipt of the exact decision, with the consequential
terms visible before signing. Diagnostics belong outside these everyday flows.

Connection, privacy and money status are functional parts of the composition:
show which data is cached, which action is waiting, who can see it, and what is
confirmed. Avoid decorative lock badges that suggest more privacy than exists.
Empty states should explain what can happen next, without simulated markets or
invented balances. Broad [DeFi scope](crosschain-defi.md) does not justify fake
interactive controls for unconnected protocols.

## Interaction and review

Keep visible wording short and specific: screen names, actions, amounts and
necessary state or risk information. Omit promotional headings, generic slogans,
repeated explanations and decorative copy. Data screens begin with their controls
and data, without a marketing hero. Put technical evidence under expandable
details; keep fees, public visibility, pending outcomes and failures visible
where they affect the decision.

Use the faint opposing-L mark and Lenz wordmark behind candle plots, with data
and price labels above them.
Refresh controls use the standard circular-arrow SVG with an accessible name.
Search and amount-field focus use an underline without a heavy surrounding
rectangle. The phone market picker uses a searchable dialog in the page theme;
retain keyboard selection, Escape, focus return and saved-market access offline.
Small choice menus use the same page colours, a selection tick and underlined
trigger. Keep checkbox marks plain and keyboard focus visible in ink. Avoid
native blue option menus and heavy lime focus borders across forms and reviews.

Automatic price updates need no prominent start/refresh control. Keep the pause
control under Data settings and use accessible icons for theme changes. Reference
price screens use aligned asset/network rows with visible source age, without
extra input forms.

Open selected-market candles automatically. Put secondary market statistics and
wallet balance breakdowns under details. Keep pending or reserved funds visible
in the details label, and retain separate consent before sharing order amounts.

Use restrained motion to show state changes and movement: typically 120–180 ms
for controls and 200–260 ms for panels. Respect reduced motion. Avoid perpetual
pulsing, floating shapes and animations that delay a financial decision.

Review both themes at phone, landscape, tablet and desktop sizes, with large text,
keyboard navigation and visible focus. Tap targets remain at least 44 pixels,
primary actions 48 pixels. Text must retain appropriate contrast. Long token
names, balances, errors and translated-length copy must not break the layout.

Visual approval needs actual screenshots and working interactions, including
loading, offline, empty, pending, failure and recovery. Mechanical tests support
that review; they do not establish that a design is distinctive or superior.
The current DEX is a first UI slice, not the completed visual redesign of Lenz.


## Wallet interaction revision

[Wallet actions](wallet-tokens.md) select a person before entering an amount,
with scanning in the recipient step. Receive opens directly on the Lenz QR.
Send, Receive, Add and close use accessible SVG controls. Use Lenz colours for
recipient selection; do not restore the native blue dropdown. Token imports
show exact network/contract data and keep watched balances separate from offline
tUSD. Short section links aid navigation. No design acceptance is inferred from
passing UI checks; the wallet remains under review.

Apply [workflow privacy boundaries](privacy-workflows.md) to every approval and
status. Avoid phrases implying the user's device must reconnect for all offline
DeFi, or implying carrier storage is execution. Show the actual request state.
