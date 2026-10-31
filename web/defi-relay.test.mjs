import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDefiRoute } from './defi-relay.mjs';
function req(url, input = {}, changes = {}) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), { url, method: 'POST',
    headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' }, ...changes });
}
function res() { return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = JSON.parse(text); } }; }
test('local API forwards quote requests to the actual adapter boundary', async () => {
  const calls = [], route = createDefiRoute({
    rheaQuote: async input => { calls.push(input); return { state: 'quote', provider: 'rhea' }; },
    intentsPreview: async input => { calls.push(input); return { state: 'quote', provider: 'near-intents' }; },
    intentsTokens: async () => [],
  });
  for (const name of ['rhea', 'intents']) {
    const response = res(); assert.equal(await route(req(`/api/defi/${name}/quote`, { amount: '20' }), response), true);
    assert.equal(response.status, 200); assert.equal(response.body.state, 'quote'); assert.equal(response.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls.length, 2);
  const response = res(); await route(req('/api/defi/intents/tokens'), response); assert.deepEqual(response.body, []);
});
test('foreign pages, rebinding hosts and wrong methods cannot invoke providers', async () => {
  const route = createDefiRoute({ rheaQuote: () => assert.fail('Provider must not run') });
  for (const changes of [
    { headers: { host: '127.0.0.1:4173', origin: 'https://foreign.example' } },
    { headers: { host: 'foreign.example:4173', origin: 'http://127.0.0.1:4173' } },
    { method: 'GET' },
  ]) { const response = res(); await route(req('/api/defi/rhea/quote', {}, changes), response); assert([403, 405].includes(response.status)); }
});
test('oversized payloads and unknown routes cannot invoke a provider', async () => {
  const route = createDefiRoute({ rheaQuote: () => assert.fail('Provider must not run') });
  const response = res(); await route(req('/api/defi/rhea/quote', { data: 'x'.repeat(5000) }), response); assert.equal(response.status, 400);
  const missing = res(); await route(req('/api/defi/spend'), missing); assert.equal(missing.status, 404);
  assert.equal(await route(req('/money.html'), res()), false);
});
test('provider failure stays an error instead of a successful quote', async () => {
  const route = createDefiRoute({ rheaQuote: async () => { throw new Error('No liquidity'); } });
  const response = res(); await route(req('/api/defi/rhea/quote'), response);
  assert.equal(response.status, 400); assert.equal(response.body.error, 'No liquidity');
});
