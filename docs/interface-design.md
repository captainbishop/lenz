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
