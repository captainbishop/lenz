# NEAR AI in conversations

The prepared NEAR AI component opens a separate conversation. It is not mounted
on the product chat page while live access and useful context are unconnected. Only text typed there and its
earlier AI replies are submitted, after explicit sharing consent. Personal
messages, contacts, names, avatars, balances and transaction tools are excluded.
AI replies render as text and have no signing or execution authority. Closing or
clearing the dialog discards this temporary conversation; it is not backed up.

## Data path

The browser sends the selected AI conversation over the app connection to the
Lenz server. The server can read this text and the requesting Lenz identity's
public key material. This is disclosed before sending. The API does not log or
persist prompts and replies, but a server operator or compromised server could
observe them. Production hosting needs HTTPS. This is not browser-to-model
end-to-end encryption and does not change person-to-person chat encryption.

The server uses NEAR AI SDK 0.2.1's Node entry point, model E2EE and strict
`UpToDate` policies for both gateway and model attestations. A reply is returned
only after SDK byte verification yields the matching completion ID and a
`provider_tee` signature. Gateway-only results and tool/function calls are
rejected. Neither plaintext fallback nor an unverified streaming preview exists.

The SDK disables inference retries. Each request runs in a separate worker with
a 45-second lifetime; disconnect and timeout terminate that worker before its
local concurrency slot is released. Stopping cannot undo a request already
accepted or billed upstream. The UI keeps the draft after a failed request and
does not automatically retry on reconnection.

## Host configuration

Install the isolated lock with `npm ci --ignore-scripts` in
`integrations/near-ai`. The runtime must be Node 24.22.1 or later. Configure
`NEARAI_API_KEY`, `LENZ_AI_MODEL` and `LENZ_AI_ACCOUNTS` as host settings. The last
value is a comma-separated allowlist of at most 32 Lenz identity IDs; never place
secret values in browser files or source control. Select a supported NEAR TEE
Chat Completions model and verify it live before enabling access.

The current relay is restricted to the local app origin
`http://127.0.0.1:4173`. Status checks contain no account or secret data. Sending
requires an allowlisted identity and a P-256 signature binding that identity,
origin, single-use 60-second challenge, disclosure version and exact request
digest. Backup/payment signatures cannot authorize inference. Recovered chat
identities may sign this AI domain without gaining financial permissions.

Limits are one inference at a time, nine alternating messages ending with a user
message, 2,000 characters per question, 8,000 per reply, 16,000 total characters
and 1,200 output tokens. Durable SQLite counters reserve allowance before the
provider call: 20 requests per account and 100 across the host per UTC day.
Failures still count. Only IDs, dates and counts are stored, with seven days of
retention. This is an operator-controlled local access policy, not public signup
or billing infrastructure.

## Evidence and activation boundary

`node --test web/ai-chat.test.mjs` covers the context boundary, response
verification, signed HTTP requests, replay/substitution, quota persistence,
concurrency, cancellation and recovered-account permissions.
`node web/receive-ai-browser.test.cjs` covers explicit consent, no personal-data
export, text-only replies, unavailable access, stop/late-response handling,
session clearing and both themes at phone/desktop widths. The test explicitly
mounts the prepared component; ordinary chat has no inactive AI control. Tests use
synthetic SDK and HTTP responses, not live attestation or paid inference.

The pinned SDK imports locally. npm audit on November 5 reports three low entries
from `elliptic` via `@phala/dcap-qvl`, including the direct SDK's inherited entry;
there is no reported fix. See
[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84).
The current runtime is 24.21.0 and no funded API access is configured, so sending
is disabled. Runtime compatibility, the dependency advisory and actual gateway,
model and response verification need review before live activation.

The separate chart-analysis adapter still accepts only normalized public chart
data and an explicit question; this change does not wire chart context into AI.

Source: [NEAR AI JavaScript SDK](https://docs.near.ai/cloud/inference-sdk/javascript).
