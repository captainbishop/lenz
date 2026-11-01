import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AURORA_TESTNET, MAX_RPC_BYTES, readAuroraQuantity } from './rpc.mjs';

const reply = result => ({ jsonrpc: '2.0', id: 1, result });
const fixture = body => async () => Response.json(body);

test('only network identity and block height can be requested', async () => {
  for (const method of ['eth_chainId', 'eth_blockNumber']) {
    const value = await readAuroraQuantity(method, { fetchImpl: async (url, options) => {
      assert.equal(url, AURORA_TESTNET); assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), { jsonrpc: '2.0', id: 1, method, params: [] });
      return Response.json(reply('0x4e454153'));
    } });
    assert.equal(value, 1313161555n);
  }
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_call']) {
    await assert.rejects(readAuroraQuantity(method, { fetchImpl: () => { throw Error('Unexpected network request'); } }), /Unsupported Aurora read method/);
  }
});

test('valid zero and 256-bit quantities preserve exact integer values', async () => {
  for (const value of ['0x0', '0x1', '0x' + 'f'.repeat(64)]) {
    assert.equal(await readAuroraQuantity('eth_blockNumber', { fetchImpl: fixture(reply(value)) }), BigInt(value));
  }
});

test('rejects mismatched, error, batch and noncanonical quantity responses', async () => {
  for (const body of [null, [], [reply('0x1')], {}, { ...reply('0x1'), id: 2 },
    { ...reply('0x1'), jsonrpc: '1.0' }, { ...reply('0x1'), error: { code: -1 } },
    ...[null, 1, '1', '-0x1', '0x', '0x00', '0x01', '0xAA', '0x' + 'f'.repeat(65)].map(reply)]) {
    await assert.rejects(readAuroraQuantity('eth_blockNumber', { fetchImpl: fixture(body) }), /Invalid Aurora RPC quantity response/);
  }
});

test('limits actual streamed bytes even without a Content-Length header', async () => {
  let cancelled = false, pulls = 0;
  const stream = new ReadableStream({
    pull(controller) { pulls++; if (pulls === 5) controller.close(); else controller.enqueue(new Uint8Array(MAX_RPC_BYTES / 2)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readAuroraQuantity('eth_blockNumber', { fetchImpl: async () => new Response(stream) }), /response is too large/);
  assert(cancelled); assert(pulls <= 5);
  const json = JSON.stringify(reply('0x1'));
  const exact = json + ' '.repeat(MAX_RPC_BYTES - Buffer.byteLength(json));
  assert.equal(await readAuroraQuantity('eth_blockNumber', { fetchImpl: async () => new Response(exact) }), 1n);
});

test('rejects invalid JSON, invalid UTF-8 and HTTP failures', async () => {
  for (const bytes of ['{', new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(readAuroraQuantity('eth_chainId', { fetchImpl: async () => new Response(bytes) }), /Invalid Aurora RPC JSON/);
  }
  await assert.rejects(readAuroraQuantity('eth_chainId', { fetchImpl: async () => new Response('unavailable', { status: 503 }) }), /Aurora HTTP 503/);
});

test('a real HTTP redirect is not followed', async () => {
  let followed = false;
  const server = createServer((req, res) => {
    if (req.url === '/redirected') { followed = true; res.end(JSON.stringify(reply('0x1'))); }
    else { res.writeHead(302, { location: '/redirected' }); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const local = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(readAuroraQuantity('eth_chainId', { fetchImpl: (_url, options) => fetch(local, options) }), TypeError);
    assert.equal(followed, false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('deadline aborts a real HTTP response that stalls after its headers', async () => {
  let bodyStarted = false;
  const server = createServer((_req, res) => { res.writeHead(200); res.write('{'); bodyStarted = true; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const local = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(readAuroraQuantity('eth_blockNumber', {
      timeoutMs: 250, fetchImpl: (_url, options) => fetch(local, options),
    }), error => error.name === 'TimeoutError' || error.name === 'AbortError');
    assert(bodyStarted, 'The test must exercise a stalled body, not only connection timeout');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
