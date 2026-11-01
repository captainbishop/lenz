# Nostr transport dependencies

`nostr-tools` supplies NIP-44/NIP-59 encryption and secp256k1 event signing for
Lenz's optional internet delivery. Versions and integrity hashes are pinned in
`package-lock.json`. `ws` is used only by disposable Node test relays.

```sh
npm ci --ignore-scripts
npm run build
npm audit --ignore-scripts
```

The browser loads the locally bundled `../public/nostr-vendor/nostr.js`.
`build.mjs` preserves dependency licenses and records source/bundle hashes in
`build.json`. No CDN script, source map or external runtime import is needed.
See [delivery protocol and verification](../../docs/internet-delivery.md).
