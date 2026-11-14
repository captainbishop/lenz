import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLendingHttpRoute } from './intent-lending-http.mjs';

const endpoint = '/api/intents/lending/snapshot';
const owner = '0x' + 'ab'.repeat(20), account = '0x' + 'cd'.repeat(20);
const snapshot = { network: 'Sepolia', account: { status: 'unknown', position: null }, execute: false };

async function fixture(options = {}) {
  const server = http.createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port, selections = [];
  const route = createLendingHttpRoute({ origin, reader: { snapshot: async input => { selections.push(input); return snapshot; } }, ...options });
  server.on('request', (request, response) => {
    route(request, response).then(handled => { if (!handled) { response.writeHead(404); response.end(); } }).catch(error => {
      if (!response.destroyed) { response.writeHead(599); response.end(JSON.stringify({ error: error.message })); }
    });
  });
  return { origin, selections,
    post: (body, { path = endpoint, headers = {}, ...request } = {}) => fetch(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body), ...request,
    }),
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); },
  };
}

test('lending HTTP returns a noncached read-only snapshot for an optional public account selection', async () => {
  const f = await fixture();
  try {
    for (const input of [{}, { owner }, { account }, { owner, account }]) {
      const response = await f.post(input);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await response.json(), snapshot);
    }
    assert.deepEqual(f.selections, [{}, { owner }, { account }, { owner, account }]);
  } finally { await f.close(); }
});

test('Supply reads use the pinned proof reader and reject client-selected finality or deployment', async () => {
  const observed = [];
  const f = await fixture({ supplyReader: { snapshot: async input => { observed.push(input); return { ...snapshot, privatePool: { nextIndex: 1 } }; } } });
  try {
    const path = '/api/intents/lending/supply/snapshot';
    const response = await f.post({ owner, account }, { path });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).privatePool.nextIndex, 1);
    for (const body of [{ owner, blockTag: 'latest' }, { owner, privacyPool: account }, { owner, rpc: 'https://example.com' }]) {
      assert.equal((await f.post(body, { path })).status, 400);
    }
    assert.deepEqual(observed, [{ owner, account }]);
    assert.deepEqual(f.selections, []);
  } finally { await f.close(); }
});

test('lending HTTP bounds bodies and rejects invalid JSON and UTF-8 without a read', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post(JSON.stringify({ owner, padding: 'x'.repeat(4096) }))).status, 413);
    assert.equal((await f.post('{')).status, 400);
    assert.equal((await f.post({}, { body: Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x3a, 0x31, 0x7d]) })).status, 400);
    assert.deepEqual(f.selections, []);
  } finally { await f.close(); }
});

test('lending HTTP caps repeated network reads and resumes after its minute window', async () => {
  let now = 0;
  const f = await fixture({ now: () => now });
  try {
    for (let index = 0; index < 30; index++) assert.equal((await f.post({})).status, 200);
    assert.equal((await f.post({})).status, 429);
    assert.equal(f.selections.length, 30);
    now = 60000;
    assert.equal((await f.post({})).status, 200);
  } finally { await f.close(); }
});

test('lending HTTP hides backend errors and never advertises execution', async () => {
  const f = await fixture({ reader: { snapshot: async () => { throw Error('PRIVATE_CONFIG_SECRET'); } } });
  try {
    const response = await f.post({});
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE_CONFIG_SECRET/);
  } finally { await f.close(); }
  const executable = await fixture({ reader: { snapshot: async () => ({ ...snapshot, execute: true }) } });
  try { assert.equal((await (await executable.post({})).json()).execute, false); }
  finally { await executable.close(); }
});

test('lending HTTP expires a stalled read and aborts the original reader signal', async () => {
  let signal;
  const f = await fixture({ timeoutMs: 30, reader: { snapshot: async (_, options = {}) => { signal = options.signal; return new Promise(() => {}); } } });
  try {
    const response = await f.post({}, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 504);
    assert.equal(signal.aborted, true);
  } finally { await f.close(); }
});

test('lending HTTP rejects secrets, route overrides and malformed account selections before network reads', async () => {
  const f = await fixture();
  try {
    for (const input of [null, [], 1, { owner: null }, { owner: '' }, { owner: '0x' + '00'.repeat(20) }, { account: owner + '00' },
      { owner, rpc: 'https://attacker.example' }, { owner, chainId: '1' }, { owner, factory: account }, { privateKey: 'secret' }, { note: 'secret' }, { proof: 'secret' }]) {
      assert.equal((await f.post(input)).status, 400);
    }
    assert.deepEqual(f.selections, []);
  } finally { await f.close(); }
});

test('lending HTTP accepts only the exact local snapshot JSON POST route', async () => {
  const f = await fixture();
  try {
    for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { Origin: '' },
      { Host: 'attacker.example', Origin: 'http://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
      assert.equal((await f.post({}, { headers })).status, 403);
    }
    for (const operation of ['prepare', 'submit', 'sign', 'borrow', 'withdraw', 'config']) {
      assert.equal((await f.post({}, { path: '/api/intents/lending/' + operation })).status, 404);
    }
    assert.equal((await f.post({}, { path: endpoint + '?rpc=https://attacker.example' })).status, 400);
    assert.equal((await f.post({}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await fetch(f.origin + endpoint, { headers: { Origin: f.origin } })).status, 405);
    assert.equal((await f.post({}, { path: '/unrelated' })).status, 404);
    assert.deepEqual(f.selections, []);
  } finally { await f.close(); }
});

test('lending HTTP limits chunked bodies and ends an incomplete body at the deadline', async () => {
  const f = await fixture({ timeoutMs: 40 });
  async function sendChunks(chunks, complete) {
    let request;
    const result = new Promise((resolve, reject) => {
      request = http.request(f.origin + endpoint, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      for (const chunk of chunks) request.write(chunk);
      if (complete) request.end();
    });
    try { return await result; } finally { request.destroy(); }
  }
  try {
    assert.equal(await sendChunks(['{"padding":"', 'x'.repeat(4097), '"}'], true), 413);
    assert.equal(await sendChunks(['{'], false), 504);
    assert.deepEqual(f.selections, []);
  } finally { await f.close(); }
});

test('lending HTTP aborts a disconnected read and can serve a later snapshot', async () => {
  const started = Promise.withResolvers(), cancelled = Promise.withResolvers();
  let first = true;
  const f = await fixture({ reader: { snapshot: async (_, { signal }) => {
    if (!first) return snapshot;
    first = false;
    signal.addEventListener('abort', () => cancelled.resolve(signal.aborted), { once: true });
    started.resolve();
    return new Promise(() => {});
  } } });
  const controller = new AbortController();
  try {
    const pending = f.post({}, { signal: controller.signal });
    await started.promise;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(await cancelled.promise, true);
    assert.equal((await f.post({})).status, 200);
  } finally { controller.abort(); await f.close(); }
});

test('lending HTTP admits at most two simultaneous reads and releases the slot on completion', async () => {
  const bothStarted = Promise.withResolvers(), thirdStarted = Promise.withResolvers(), releases = [];
  const f = await fixture({ reader: { snapshot: async () => {
    const read = Promise.withResolvers(); releases.push(read.resolve);
    if (releases.length === 2) bothStarted.resolve();
    if (releases.length === 3) thirdStarted.resolve();
    return read.promise;
  } } });
  const pending = [f.post({}), f.post({})];
  try {
    await bothStarted.promise;
    assert.equal((await f.post({}, { signal: AbortSignal.timeout(1000) })).status, 429);
    for (const release of releases) release(snapshot);
    for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
    const later = f.post({});
    await Promise.race([thirdStarted.promise, later.then(() => { throw Error('The later read ended before reaching the chain.'); })]);
    releases[2](snapshot);
    assert.equal((await later).status, 200);
  } finally {
    for (const release of releases) release(snapshot);
    await Promise.allSettled(pending);
    await f.close();
  }
});

test('lending HTTP rejects nonlocal configuration and unbounded timeouts', () => {
  for (const origin of ['https://localhost:4173', 'http://attacker.example', 'http://localhost:4173/path', 'http://user:secret@localhost:4173', 'http://localhost:4173/?rpc=x', 'http://localhost:4173/#x']) {
    assert.throws(() => createLendingHttpRoute({ origin }), /local Lenz origin/);
  }
  for (const timeoutMs of [0, 60001, Infinity, 1.5]) assert.throws(() => createLendingHttpRoute({ timeoutMs }), /timeout/);
});
