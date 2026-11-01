# Aurora network reader

November 1, 2026. The testnet reader accepts only `eth_chainId` and
`eth_blockNumber` at the fixed Aurora testnet endpoint. It has no wallet,
transaction submission or deployment method.

The reader caps actual streamed bytes at 16 KiB, regardless of Content-Length.
Its 20-second abort deadline covers connection, headers and response body.
Redirects and HTTP failures are rejected. Decoding requires valid UTF-8 and JSON,
JSON-RPC 2.0, the matching request ID and a canonical hexadecimal quantity of at
most 256 bits. Error responses and batches cannot become a network observation.
Values remain BigInt until the script checks the expected chain ID and serializes
the block height without precision loss. A failed read writes no new result file;
an older result remains a dated observation, not evidence of the failed attempt.

Seven tests cover the allowed request methods, exact integer boundaries, malformed
responses, stream-size enforcement, HTTP/encoding failures, an actual redirect
and a real local HTTP response that stalls after its headers. Three guard-removal controls fail the
tests: the method restriction, request-ID check and streamed-byte limit.

The separate [live observation](testnet-rpc-results.json) returned chain ID
1313161555 and block 275710282. Initial sandboxed access failed with EACCES;
the authorized read-only rerun succeeded. It sent no transaction or deployment.

```sh
node --test aurora/rpc.test.mjs
node aurora/rpc-mutations.mjs
# From aurora/, with network access:
npm run check:testnet
```

These checks validate a bounded reader, not RPC honesty or chain finality. They do
not authenticate an Aurora asset route, connect the wallet or establish private
NEAR settlement. The separate [toolchain migration](dependency-resolution.md)
removes the affected Zod dependency. The [integration work](../docs/status.md) stays open.
