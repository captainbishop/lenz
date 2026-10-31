# Contributing to Lenz

Lenz's sole project author and maintainer is [captainbishop](https://github.com/captainbishop).
Feedback and reproducible issue reports are welcome;
discuss code contributions with the maintainer before beginning a substantial change.
Do not assign authorship to someone who did not make or approve a contribution.

Read [development status](docs/status.md) and the relevant component README before integration work. Document missing prerequisites without secret values.

## Working changes

1. Start from current `main`; use a short feature branch for a substantial change.
2. Define the behavior to verify and make the smallest coherent change.
3. Run the relevant local tests. Clearly distinguish mocked responses, saved evidence
   and actual network transactions.
4. Review every candidate path and its purpose, then the diff. Stage explicit paths
   and run `node tooling/check-git-content.mjs --staged` to scan the exact index.
5. For future changes, use focused commits with factual titles and recorded validation.
   Keep test outcomes and commit dates accurate.

Never commit wallet keys, seeds, identity decryption files, private PCZTs, account
databases, API tokens or browser profile directories. The scan is a useful check,
not a guarantee that every secret format will be detected. Assistant skills, plugin
packages, local agent instructions, installation records, exploratory analyses and working notes stay local. Review documents for conversation excerpts and personal context; inspect media and binary metadata as well as filenames. Downloaded reference caches stay local. Passing application tests does not establish that a file belongs
in the repository. Before pushing, scan the committed tree with
`node tooling/check-git-content.mjs --tree HEAD` and review the outgoing file list.

Enable the repository's commit and push checks with
`git config core.hooksPath tooling/hooks`. The commit hook scans the index; the push
hook scans every outgoing commit, including files removed by a later commit.

Keep the web app usable without technical protocol knowledge. Preserve existing
storage identities and pending authorizations. Payments must remain available outside
chat, and onward transfers must not require a local validator group.

## Reporting a problem

Include the relevant component, version or commit, expected behavior, steps to
reproduce and redacted error information. Use disposable test data. Do not post a
wallet backup, seed, raw private transaction or identifying conversation history.
Follow [SECURITY.md](SECURITY.md) for vulnerabilities and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) when participating.
