import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLendingExecutionHttpRoute } from './intent-lending-execution-http.mjs';
import { buildLendingPermissionReview, lendingPermissionDigest } from './public/intent-lending-account.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { LENDING_DEPLOYMENT } from './public/intent-lending-deployment.js';
import { buildLendingSupplyPreparation, lendingSupplySignals } from './public/intent-lending-supply.js';
import { keccak256 } from './public/evm-vendor/offline-budget.js';
import { Wallet } from '../aurora/node_modules/ethers/lib.esm/index.js';

const base = '/api/intents/lending/';
const now = 1000000;
function permission() {
  const wallet = Wallet.createRandom(), account = '0x' + '44'.repeat(20), factory = LENDING_DEPLOYMENT.lendingFactory;
  const route = { chainId: LENDING_TESTNET.chain, factory };
  for (const key of ['pool', 'link', 'usdc', 'aLink', 'variableDebt']) { route[key] = LENDING_TESTNET[key]; route[key + 'CodeHash'] = LENDING_DEPLOYMENT.codeHashes[key]; }
  const identity = { lenzIdentity: 'aa'.repeat(32), chainId: LENDING_TESTNET.chain, ownerAddress: wallet.address.toLowerCase(), account, accountId: account, route, nonce: '0', deployed: true };
  const review = buildLendingPermissionReview(identity, { kind: 'Cancel', terms: { nonce: '0', deadline: '2000' } }, { now });
  const digest = lendingPermissionDigest(review);
  return { review, signed: { type: 'lenz/lending-signed-permission/v1', reviewId: review.id, digest, signature: wallet.signingKey.sign(digest).serialized.toLowerCase(), createdAt: now } };
}

async function fixture(options = {}) {
  const server = http.createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const route = createLendingExecutionHttpRoute({ origin, ...options });
  server.on('request', (request, response) => {
    route(request, response).then(handled => {
      if (!handled) { response.writeHead(404); response.end('Other route'); }
    }).catch(() => { if (!response.destroyed) { response.writeHead(599); response.end('Uncaught route error'); } });
  });
  return { origin, route,
    post: (operation, body = {}, { headers = {}, path = base + operation, ...request } = {}) => fetch(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body), ...request,
    }),
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await route.close?.(); },
  };
}

test('unconfigured lending reports unavailable without opening a service or signer', async () => {
  let opened = false;
  const f = await fixture({ openService: async () => { opened = true; throw Error('Unexpected signer open'); } });
  try {
    const response = await f.post('config');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), { available: false, execute: false });
    assert.equal(opened, false);
    assert.equal((await f.post('snapshot')).status, 404);
  } finally { await f.close(); }
});

test('lending HTTP carries the original reviewed permission through each configured service operation', async () => {
  const request = permission(), received = [];
  const result = { intentId: request.review.id, artifactId: request.signed.digest, status: 'pending', verified: false };
  const service = { configuration: async () => ({ available: true, execute: true }), prepare: async value => { received.push(value); return { review: value, available: true, execute: true }; } };
  for (const name of ['submit', 'reconcile', 'resume']) service[name] = async value => { received.push(value); return result; };
  const f = await fixture({ service, now: () => now });
  try {
    assert.deepEqual(await (await f.post('config')).json(), { available: true, execute: true });
    assert.deepEqual(await (await f.post('prepare', { review: request.review })).json(), { review: request.review, available: true, execute: true });
    for (const name of ['submit', 'reconcile', 'resume']) {
      const response = await f.post(name, request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    }
    assert.deepEqual(received, [request.review, request, request, request]);
  } finally { await f.close(); }
});

test('Repay funding HTTP forwards only the exact original owner and account and keeps private fields out', async () => {
  const input = { owner: 'a'.repeat(64), ownerAddress: '0x' + '4'.repeat(40), account: '0x' + '5'.repeat(40) }, received = [];
  const service = {};
  for (const operation of ['Submit', 'Reconcile', 'Resume']) service['repaymentFunding' + operation] = async body => { received.push(body); return { status: 'pending', verified: false }; };
  const f = await fixture({ service });
  try {
    for (const operation of ['submit', 'reconcile', 'resume']) assert.equal((await f.post('repayment-funding/' + operation, input)).status, 200);
    for (const extra of [{ amount: '1000001' }, { asset: 'USDC' }, { privateKey: 'secret' }, { account: '0x' + 'A'.repeat(40) }]) assert.equal((await f.post('repayment-funding/submit', { ...input, ...extra })).status, 400);
    assert.deepEqual(received, [input, input, input]);
  } finally { await f.close(); }
});

test('lending HTTP rejects foreign origins, unsupported methods and changed public permissions before opening the sponsor', async () => {
  let opened = 0;
  const f = await fixture({ serviceOptions: { fixture: true }, openService: async () => { opened++; return { configuration: async () => ({ available: true, execute: true }) }; }, now: () => now });
  const request = permission();
  try {
    for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { Origin: '' },
      { Host: 'attacker.example', Origin: 'http://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
      assert.equal((await f.post('config', {}, { headers })).status, 403);
    }
    const hostStatus = await new Promise((resolve, reject) => {
      const call = http.request(f.origin + base + 'config', { method: 'POST', headers: { Host: 'attacker.example', Origin: f.origin, 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      call.once('error', reject); call.end('{}');
    });
    assert.equal(hostStatus, 403);
    assert.equal((await f.post('config', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await fetch(f.origin + base + 'config', { headers: { Origin: f.origin } })).status, 405);
    assert.equal((await f.post('config', {}, { path: base + 'config?rpc=https://attacker.example' })).status, 400);
    for (const name of ['snapshot', 'borrow', 'sign', 'submit/', 'recover']) {
      const response = await f.post(name);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'Other route');
    }
    for (const body of [null, [], 1, { key: 'secret' }, { rpc: 'https://attacker.example' }]) assert.equal((await f.post('config', body)).status, 400);
    for (const body of [{}, { review: {} }, { ...request, privateKey: 'secret' }, { ...request, signed: { ...request.signed, signature: '0x' + '00'.repeat(65) } },
      { ...request, review: { ...request.review, terms: { ...request.review.terms, nonce: '1' } } }]) assert.equal((await f.post('submit', body)).status, 400);
    assert.equal((await f.post('prepare', { review: request.review, signed: request.signed })).status, 400);
    assert.equal(opened, 0);
    assert.equal((await f.post('config')).status, 200);
    assert.equal((await f.post('config')).status, 200);
    assert.equal(opened, 1);
  } finally { await f.close(); }
});

test('lending HTTP caps request and response bytes and rejects malformed JSON and UTF-8', async () => {
  const f = await fixture({ service: { configuration: async () => ({ text: 'x'.repeat(32768) }) } });
  try {
    assert.equal((await f.post('config', JSON.stringify({ padding: 'x'.repeat(32768) }))).status, 413);
    assert.equal((await f.post('config', '{')).status, 400);
    assert.equal((await f.post('config', {}, { body: Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x3a, 0x31, 0x7d]) })).status, 400);
    const response = await f.post('config');
    assert.equal(response.status, 503);
    assert((await response.text()).length < 200);
  } finally { await f.close(); }
});

test('lending HTTP limits chunked and incomplete bodies before service admission', async () => {
  let opened = false;
  const f = await fixture({ timeoutMs: 30, serviceOptions: {}, openService: async () => { opened = true; throw Error(); } });
  async function chunks(parts, end) {
    let request;
    const result = new Promise((resolve, reject) => {
      request = http.request(f.origin + base + 'config', { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      request.setTimeout(500, () => request.destroy(Error('Request exceeded its deadline')));
      for (const part of parts) request.write(part);
      if (end) request.end();
    });
    try { return await result; } finally { request.destroy(); }
  }
  try {
    assert.equal(await chunks(['{"padding":"', 'x'.repeat(32769), '"}'], true), 413);
    assert.equal(await chunks(['{'], false), 504);
    assert.equal(opened, false);
  } finally { await f.close(); }
});

test('lending HTTP limits requests per minute and releases the rate window', async () => {
  let clock = now;
  const f = await fixture({ now: () => clock });
  try {
    for (let index = 0; index < 30; index++) assert.equal((await f.post('config')).status, 200);
    assert.equal((await f.post('config')).status, 429);
    clock += 60000;
    assert.equal((await f.post('config')).status, 200);
  } finally { await f.close(); }
});

test('lending HTTP times out a stalled service operation and aborts its original signal', async () => {
  let signal;
  const finish = Promise.withResolvers();
  const f = await fixture({ timeoutMs: 30, service: { configuration: async (_, options) => { signal = options.signal; return finish.promise; } } });
  try {
    const response = await f.post('config', {}, { signal: AbortSignal.timeout(500) });
    assert.equal(response.status, 504);
    assert.equal(signal.aborted, true);
  } finally { finish.resolve({ available: false, execute: false }); await f.close(); }
});

test('lending HTTP admits at most two running operations including requests that time out', async () => {
  const both = Promise.withResolvers(), releases = [];
  const f = await fixture({ timeoutMs: 100, service: { configuration: async () => {
    const pending = Promise.withResolvers(); releases.push(pending.resolve);
    if (releases.length === 2) both.resolve();
    return pending.promise;
  } } });
  const pending = [f.post('config', {}, { signal: AbortSignal.timeout(1000) }), f.post('config', {}, { signal: AbortSignal.timeout(1000) })];
  try {
    await both.promise;
    assert.equal((await f.post('config', {}, { signal: AbortSignal.timeout(500) })).status, 429);
    for (const response of await Promise.all(pending)) assert.equal(response.status, 504);
    assert.equal((await f.post('config', {}, { signal: AbortSignal.timeout(500) })).status, 429);
    for (const release of releases) release({ available: true, execute: true });
  } finally {
    for (const release of releases) release({ available: true, execute: true });
    await Promise.allSettled(pending);
    await f.close();
  }
});

test('lending HTTP uses static backend errors and closes only the opened service', async () => {
  let closed = 0;
  const f = await fixture({ service: { configuration: async () => { throw Error('PRIVATE_CONFIG_SECRET'); }, close: async () => { closed++; } } });
  try {
    const response = await f.post('config');
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /PRIVATE_CONFIG_SECRET/);
  } finally { await f.close(); }
  assert.equal(closed, 1);
});

test('lending HTTP rejects nonlocal configuration and invalid deadlines', () => {
  for (const origin of ['https://localhost:4173', 'http://attacker.example', 'http://localhost:4173/path', 'http://user:secret@localhost:4173', 'http://localhost:4173/?rpc=x', 'http://localhost:4173/#x']) {
    assert.throws(() => createLendingExecutionHttpRoute({ origin }), /local Lenz origin/);
  }
  for (const timeoutMs of [0, 60001, Infinity, 1.5]) assert.throws(() => createLendingExecutionHttpRoute({ timeoutMs }), /timeout/);
});

test('lending HTTP aborts a disconnected operation and serves a later request after it settles', async () => {
  const started = Promise.withResolvers(), cancelled = Promise.withResolvers();
  let first = true;
  const f = await fixture({ service: { configuration: async (_, { signal }) => {
    if (!first) return { available: true, execute: true };
    first = false;
    signal.addEventListener('abort', () => cancelled.resolve(signal.aborted), { once: true });
    started.resolve();
    await cancelled.promise;
    return { available: false, execute: false };
  } } });
  const controller = new AbortController();
  try {
    const pending = f.post('config', {}, { signal: controller.signal });
    await started.promise;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(await cancelled.promise, true);
    assert.deepEqual(await (await f.post('config')).json(), { available: true, execute: true });
  } finally { controller.abort(); await f.close(); }
});

test('lending HTTP does not submit after a cancelled request finishes opening its service', async () => {
  const started = Promise.withResolvers(), opened = Promise.withResolvers();
  let submitted = false;
  const f = await fixture({ timeoutMs: 30, now: () => now, serviceOptions: {}, openService: async () => { started.resolve(); return opened.promise; } });
  try {
    const pending = f.post('submit', permission());
    await started.promise;
    assert.equal((await pending).status, 504);
    opened.resolve({ submit: async () => { submitted = true; return { status: 'pending' }; } });
  } finally { await f.close(); }
  assert.equal(submitted, false);
});

test('lending HTTP retains expired signatures for reconciliation while refusing stale unsigned review', async () => {
  const request = permission();
  const f = await fixture({ now: () => now + 61000, service: {
    reconcile: async value => ({ intentId: value.review.id, status: 'unknown', verified: false }),
    prepare: async () => { throw Error('Stale review reached service'); },
  } });
  try {
    assert.equal((await f.post('prepare', { review: request.review })).status, 400);
    const response = await f.post('reconcile', request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { intentId: request.review.id, status: 'unknown', verified: false });
  } finally { await f.close(); }
});

test('closing lending HTTP waits for accepted work before releasing its journal and refuses new work', async () => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  let closed = 0;
  const f = await fixture({ service: {
    configuration: async () => { started.resolve(); await finish.promise; return { available: false, execute: false }; },
    close: async () => { closed++; },
  } });
  const pending = f.post('config');
  try {
    await started.promise;
    const closing = f.route.close();
    await Promise.resolve();
    assert.equal(closed, 0);
    assert.equal((await f.post('config')).status, 503);
    assert.equal(closed, 0);
    finish.resolve();
    await closing;
    await pending;
    assert.equal(closed, 1);
    await f.route.close();
    assert.equal(closed, 1);
  } finally { finish.resolve(); await Promise.allSettled([pending]); await f.close(); }
});

test('the configured deployment rejects a substituted factory before opening the lending sponsor', async () => {
  let opened = false;
  const f = await fixture({ now: () => now, serviceOptions: { deployment: { lendingFactory: '0x' + '66'.repeat(20) } }, openService: async () => { opened = true; throw Error(); } });
  try {
    assert.equal((await f.post('submit', permission())).status, 400);
    assert.equal(opened, false);
  } finally { await f.close(); }
});

function supplyRequest() {
  const config = { ...LENDING_TESTNET, ...LENDING_DEPLOYMENT };
  const preparation = buildLendingSupplyPreparation({ ownerAddress: '0x' + '88'.repeat(20), plan: { beneficiary: '0x' + '66'.repeat(20), refundRecipient: '0x' + '66'.repeat(20), minScaledCredit: '900000000000000000', deadline: '2000', salt: '0x' + '77'.repeat(32) }, root: '0x' + '0'.repeat(63) + '1', nullifierHash: '0x' + '0'.repeat(63) + '2' }, { config });
  const proof = '0x' + 'ab'.repeat(256), publicSignals = lendingSupplySignals(preparation);
  const artifactId = 'lending-supply-proof:' + keccak256(new TextEncoder().encode(JSON.stringify({ intentId: preparation.id, proof, publicSignals }))).slice(2);
  return { preparation, request: { ...preparation, proof, publicSignals, artifactId } };
}

test('setup, Supply and funding share exact bounded HTTP methods and original public bodies', async () => {
  const supply = supplyRequest(), setup = { owner: '0x' + '88'.repeat(20), account: '0x' + '66'.repeat(20) };
  const funding = { owner: 'a'.repeat(64), ownerAddress: setup.owner, account: setup.account, commitment: '0x' + '0'.repeat(63) + '3' };
  const calls = [], service = {};
  const cases = [
    ['setup', 'setup', setup], ['setup-status', 'setupStatus', setup],
    ['supply/config', 'supplyConfiguration', {}], ['supply/prepare', 'supplyPrepare', supply.preparation],
    ...['submit', 'reconcile', 'resume'].map(name => ['supply/' + name, 'supply' + name[0].toUpperCase() + name.slice(1), supply.request]),
    ['supply/recover', 'supplyRecover', { operation: 'withdrawRefund', request: supply.request }],
    ['funding/config', 'fundingConfiguration', {}],
    ...['submit', 'reconcile', 'resume'].map(name => ['funding/' + name, 'funding' + name[0].toUpperCase() + name.slice(1), funding]),
  ];
  for (const [, method] of cases) service[method] = async (body, { signal }) => { calls.push({ method, body }); assert.equal(signal.aborted, false); return { accepted: method }; };
  const f = await fixture({ service, now: () => now });
  try {
    for (const [operation, method, body] of cases) {
      const response = await f.post(operation, body); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { accepted: method });
    }
    assert.deepEqual(calls, cases.map(([, method, body]) => ({ method, body })));
    assert.equal((await f.post('supply/snapshot')).status, 404);
  } finally { await f.close(); }
});

test('new execution namespaces reject changed authority, witness secrets and unknown operations before opening a signer', async () => {
  let opened = 0;
  const f = await fixture({ serviceOptions: {}, openService: async () => { opened++; throw Error('Unexpected signer'); }, now: () => now });
  const supply = supplyRequest(), setup = { owner: '0x' + '88'.repeat(20), account: '0x' + '66'.repeat(20) };
  const funding = { owner: 'a'.repeat(64), ownerAddress: setup.owner, account: setup.account, commitment: '0x' + '0'.repeat(63) + '3' };
  try {
    for (const [operation, body] of [
      ['setup', { ...setup, privateKey: 'hidden' }], ['setup-status', { ...setup, owner: '0x' + '00'.repeat(20) }],
      ['funding/submit', { ...funding, amount: '2' }], ['funding/resume', { ...funding, commitment: '0x' + 'f'.repeat(64) }],
      ['supply/prepare', { ...supply.preparation, plan: { ...supply.preparation.plan, beneficiary: setup.owner } }],
      ['supply/submit', { ...supply.request, nullifier: 'secret' }], ['supply/resume', { ...supply.request, publicSignals: supply.request.publicSignals.with(2, '1') }],
      ['supply/recover', { operation: 'fulfill', request: supply.request }], ['supply/recover', { operation: 'recover', request: { ...supply.request, proof: '0x' } }],
      ['supply/config', { rpc: 'https://attacker.example' }], ['funding/config', { key: 'hidden' }],
    ]) assert.equal((await f.post(operation, body)).status, 400);
    for (const operation of ['setup/resume', 'funding/approve', 'supply/fulfill', 'supply/recover/', 'funding/submit/']) assert.equal((await f.post(operation)).status, 404);
    assert.equal((await f.post('funding/submit', funding, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await f.post('supply/submit', supply.request, { path: base + 'supply/submit?chain=1' })).status, 400);
    assert.equal(opened, 0);
  } finally { await f.close(); }
});

test('unconfigured Supply and funding disclose unavailability without opening private state', async () => {
  let opened = 0;
  const f = await fixture({ openService: async () => { opened++; throw Error(); } });
  try {
    for (const operation of ['config', 'supply/config', 'funding/config']) {
      const response = await f.post(operation); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { available: false, execute: false });
    }
    assert.equal((await f.post('setup', { owner: '0x' + '88'.repeat(20), account: '0x' + '66'.repeat(20) })).status, 503);
    assert.equal((await f.post('supply/submit', supplyRequest().request)).status, 503);
    assert.equal(opened, 0);
  } finally { await f.close(); }
});
