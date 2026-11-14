import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Wallet, verifyMessage } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { base58 } from '@scure/base';
import { createIntentsAccount } from './intents-account.mjs';

const clock = 1794196800000;
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function fixture({ wallet = Wallet.createRandom(), change = value => value } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://free.rpc.fastnear.com') return response({ jsonrpc: '2.0', id: 'lenz-auth-salt', result: { result: [...Buffer.from('"e110f317"')] } });
    if (url.endsWith('/v0/auth/authenticate')) {
      const { signedData } = JSON.parse(options.body), payload = JSON.parse(signedData.payload);
      assert.equal(signedData.standard, 'erc191');
      assert.equal(payload.signer_id, wallet.address.toLowerCase());
      assert.equal(payload.verifying_contract, 'intents.near');
      assert.deepEqual(payload.intents, []);
      const bytes = base58.decode(signedData.signature.slice('secp256k1:'.length));
      assert([0, 1].includes(bytes[64]));
      assert.equal(verifyMessage(signedData.payload, '0x' + Buffer.from(bytes).toString('hex')), wallet.address);
      return response(change({ accessToken: 'secret-access-token', refreshToken: 'secret-refresh-token', expiresIn: 60, refreshExpiresIn: 3600 }));
    }
    assert(url.endsWith('/v0/account/balances'));
    assert.equal(options.headers.Authorization, 'Bearer secret-access-token');
    return response(change({ balances: [{ tokenId: 'nep141:eth.omft.near', available: '9007199254740993123456789', source: 'private' }] }));
  };
  const session = createIntentsAccount({ address: wallet.address, signMessage: text => wallet.signMessage(text), fetcher, now: () => clock });
  return { session, calls, wallet, fetcher };
}

test('wallet ownership opens a private read session without exposing tokens or funding authority', async () => {
  const { session, calls, wallet } = fixture();
  assert.throws(() => session.receivingAccount(), /Authenticate/);
  const connected = await session.connect();
  assert.equal(connected.accountId, wallet.address.toLowerCase());
  assert.equal(connected.state, 'authenticated');
  assert.deepEqual(session.receivingAccount(), { type: 'CONFIDENTIAL_INTENTS', id: wallet.address.toLowerCase() });
  const balances = await session.readBalances();
  assert.equal(balances.balances[0].available, '9007199254740993123456789');
  assert.equal(balances.evidence, 'authenticated-provider-response');
  assert.equal(balances.spendableOffline, false);
  assert.equal(balances.settlementVerified, false);
  assert(!JSON.stringify([connected, balances, session]).includes('secret-'));
  assert.equal(calls.length, 3);
  for (const { url, options } of calls.filter(c => !c.url.includes('fastnear'))) {
    assert.equal(new URL(url).origin, 'https://1click.chaindefuser.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['X-API-Key'], undefined);
  }
  session.disconnect();
  assert.throws(() => session.receivingAccount(), /Authenticate/);
  await assert.rejects(session.readBalances(), /Authenticate/);
});

test('expired access refreshes once without another wallet signature and rejected sessions are discarded', async () => {
  const f = fixture(); let time = clock, signs = 0, refreshes = 0, reject = false;
  const session = createIntentsAccount({ address: f.wallet.address, now: () => time,
    signMessage: text => { signs++; return f.wallet.signMessage(text); },
    fetcher: async (url, options) => {
      if (url.endsWith('/v0/auth/refresh')) {
        refreshes++;
        assert.deepEqual(JSON.parse(options.body), { refreshToken: 'secret-refresh-token' });
        assert.equal(options.headers.Authorization, undefined);
        return response({ accessToken: 'renewed-access-token', expiresIn: 60 });
      }
      if (url.endsWith('/v0/account/balances')) {
        assert.equal(options.headers.Authorization, 'Bearer renewed-access-token');
        return reject ? new Response('', { status: 401 }) : response({ balances: [] });
      }
      return f.fetcher(url, options);
    } });
  await session.connect(); time += 60001;
  assert.deepEqual((await session.readBalances()).balances, []);
  assert.equal(signs, 1); assert.equal(refreshes, 1);
  reject = true;
  await assert.rejects(session.readBalances(), /401/);
  assert.throws(() => session.receivingAccount(), /Authenticate/);
  await assert.rejects(session.readBalances(), /Authenticate/);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('disconnect ends a waiting wallet request and its late signature cannot authenticate', async () => {
  const f = fixture(), signing = deferred(), started = deferred();
  const session = createIntentsAccount({ address: f.wallet.address, fetcher: f.fetcher, now: () => clock,
    signMessage: async payload => { started.resolve(payload); return signing.promise; } });
  const pending = session.connect().then(() => 'authenticated', error => error.message);
  const payload = await started.promise;
  session.disconnect();
  const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))]);
  signing.resolve(await f.wallet.signMessage(payload));
  assert.match(outcome, /disconnected/);
  await pending;
  assert.equal(f.calls.filter(c => c.url.endsWith('/auth/authenticate')).length, 0);
});

test('wrong-account, changed-payload and malformed signatures cannot reach authentication', async () => {
  for (const mode of ['wrong-account', 'changed-payload', 'malformed']) {
    const f = fixture();
    const signMessage = mode === 'wrong-account' ? payload => Wallet.createRandom().signMessage(payload)
      : mode === 'changed-payload' ? payload => f.wallet.signMessage(payload.replace('intents.near', 'other.near'))
        : async () => '0x' + '00'.repeat(64) + 'ff';
    const session = createIntentsAccount({ address: f.wallet.address, signMessage, fetcher: f.fetcher, now: () => clock });
    await assert.rejects(session.connect(), /signature|recovery byte/);
    assert.equal(f.calls.length, 1);
    assert.throws(() => session.receivingAccount(), /Authenticate/);
  }
});

test('late private reads are discarded after disconnect and do not clear a new session', async () => {
  const f = fixture(), balance = deferred(), started = deferred(); let delay = true;
  const session = createIntentsAccount({ address: f.wallet.address, signMessage: text => f.wallet.signMessage(text), now: () => clock,
    fetcher: async (url, options) => {
      if (delay && url.endsWith('/account/balances')) { started.resolve(); return balance.promise; }
      return f.fetcher(url, options);
    } });
  await session.connect();
  const oldRead = session.readBalances().then(() => 'published', error => error.message);
  await started.promise; session.disconnect(); delay = false;
  await session.connect();
  balance.resolve(new Response('', { status: 401 }));
  assert.match(await oldRead, /disconnected/);
  assert.equal(session.receivingAccount().id, f.wallet.address.toLowerCase());
  assert.equal((await session.readBalances()).balances.length, 1);
});

test('duplicate requests do not open a second signer or refresh operation', async () => {
  const f = fixture(), signing = deferred(), started = deferred(); let signs = 0;
  const session = createIntentsAccount({ address: f.wallet.address, fetcher: f.fetcher, now: () => clock,
    signMessage: async payload => { signs++; started.resolve(payload); return signing.promise; } });
  const first = session.connect(); const payload = await started.promise;
  await assert.rejects(session.connect(), /already open|still open/);
  signing.resolve(await f.wallet.signMessage(payload)); await first;
  assert.equal(signs, 1);
});

test('expired signing and malformed session responses leave the account unauthenticated', async () => {
  const f = fixture(); let time = clock;
  const expired = createIntentsAccount({ address: f.wallet.address, fetcher: f.fetcher, now: () => time,
    signMessage: text => { time += 240001; return f.wallet.signMessage(text); } });
  await assert.rejects(expired.connect(), /expired/); assert.equal(f.calls.length, 1);
  for (const patch of [{ accessToken: 'bad\r\nheader' }, { refreshToken: null }, { expiresIn: 0 }, { expiresIn: 86401 }, { refreshExpiresIn: 999999999 }]) {
    const { session } = fixture({ change: value => ({ ...value, ...patch }) });
    await assert.rejects(session.connect(), /Invalid authentication session/);
    assert.throws(() => session.receivingAccount(), /Authenticate/);
  }
});

test('malformed, duplicate and public balances never become a private balance observation', async () => {
  const entry = { tokenId: 'nep141:wrap.near', source: 'private', available: '1' };
  for (const balances of [null, [entry, entry], [{ ...entry, source: 'public' }], [{ ...entry, available: 1 }],
    [{ ...entry, available: '-1' }], [{ ...entry, available: '01' }], [{ ...entry, available: '1'.repeat(79) }], [{ ...entry, tokenId: 'x\n' }]]) {
    const { session } = fixture({ change: value => Object.hasOwn(value, 'balances') ? { balances } : value });
    await session.connect(); await assert.rejects(session.readBalances(), /Invalid private balance/);
  }
});

test('responses are bounded and raw provider errors cannot expose session tokens', async () => {
  for (const bad of [() => new Response(' '.repeat(1_000_001)), () => new Response('{'), () => { throw Error('secret-access-token'); }]) {
    const f = fixture();
    const session = createIntentsAccount({ address: f.wallet.address, signMessage: text => f.wallet.signMessage(text), now: () => clock,
      fetcher: (url, options) => url.endsWith('/account/balances') ? bad() : f.fetcher(url, options) });
    await session.connect();
    const message = await session.readBalances().then(() => 'unexpected success', error => error.message);
    assert.match(message, /Invalid confidential account response|request failed/);
    assert(!message.includes('secret-access-token'));
  }
});

test('authentication, balance and refresh redirects never deliver credentials to a second endpoint', async () => {
  const captured = [];
  const target = createServer((request, reply) => {
    captured.push(request.url); request.resume(); reply.writeHead(200); reply.end('{}');
  });
  const source = createServer((request, reply) => {
    request.resume(); reply.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/capture` }); reply.end();
  });
  try {
    target.listen(0, '127.0.0.1'); await once(target, 'listening');
    source.listen(0, '127.0.0.1'); await once(source, 'listening');
    for (const endpoint of ['/auth/authenticate', '/account/balances', '/auth/refresh']) {
      const f = fixture(); let time = clock;
      const session = createIntentsAccount({ address: f.wallet.address, signMessage: text => f.wallet.signMessage(text), now: () => time,
        fetcher: (url, options) => url.endsWith(endpoint) ? fetch(`http://127.0.0.1:${source.address().port}/redirect`, options) : f.fetcher(url, options) });
      if (endpoint !== '/auth/authenticate') await session.connect();
      if (endpoint === '/auth/refresh') time += 60001;
      await assert.rejects(endpoint === '/auth/authenticate' ? session.connect() : session.readBalances());
      assert.deepEqual(captured, [], `${endpoint} followed a credential-bearing redirect`);
      session.disconnect();
    }
  } finally {
    await Promise.all([source, target].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  }
});

test('restoring wallet access starts a fresh session and never imports cached balances or old tokens', async () => {
  const f = fixture(); await f.session.connect();
  const account = f.session.receivingAccount(); f.session.disconnect();
  const restoredWallet = new Wallet(f.wallet.privateKey);
  const restored = createIntentsAccount({ address: restoredWallet.address, signMessage: text => restoredWallet.signMessage(text), fetcher: f.fetcher, now: () => clock });
  await assert.rejects(restored.readBalances(), /Authenticate/);
  await restored.connect(); assert.deepEqual(restored.receivingAccount(), account);
  const payloads = f.calls.filter(c => c.url.endsWith('/auth/authenticate')).map(c => JSON.parse(c.options.body).signedData.payload);
  assert.equal(payloads.length, 2); assert.notEqual(payloads[0], payloads[1]);
  assert.equal((await restored.readBalances()).spendableOffline, false);
});

test('expired refresh authority requires a fresh explicit sign-in without an automatic signature', async () => {
  const f = fixture(); let time = clock, signs = 0;
  const session = createIntentsAccount({ address: f.wallet.address, signMessage: text => { signs++; return f.wallet.signMessage(text); }, fetcher: f.fetcher, now: () => time });
  await session.connect(); time += 3600001;
  await assert.rejects(session.readBalances(), /Authenticate.*expired/);
  assert.equal(f.calls.length, 2); assert.equal(signs, 1);
});

test('reconnect cannot open another wallet prompt until the original signer settles', async () => {
  const f = fixture(), started = deferred(), firstSignature = deferred(); let signs = 0;
  const session = createIntentsAccount({ address: f.wallet.address, fetcher: f.fetcher, now: () => clock,
    signMessage: payload => { signs++; if (signs > 1) return f.wallet.signMessage(payload); started.resolve(payload); return firstSignature.promise; } });
  const oldConnection = session.connect().catch(error => error.message);
  const payload = await started.promise; session.disconnect(); await oldConnection;
  await assert.rejects(session.connect(), /wallet.*still open/i);
  assert.equal(signs, 1);
  firstSignature.resolve(await f.wallet.signMessage(payload));
  await new Promise(resolve => setImmediate(resolve));
  await session.connect(); assert.equal(signs, 2);
});

test('oversized salt replies are rejected before the wallet is asked to sign', async () => {
  const f = fixture(); let signs = 0;
  const session = createIntentsAccount({ address: f.wallet.address, now: () => clock,
    signMessage: text => { signs++; return f.wallet.signMessage(text); },
    fetcher: (url, options) => url.includes('fastnear') ? response({ jsonrpc: '2.0', id: 'lenz-auth-salt',
      result: { result: [...Buffer.from('"e110f317"')] }, padding: 'x'.repeat(1_000_001) }) : f.fetcher(url, options) });
  await assert.rejects(session.connect(), /salt|response/i);
  assert.equal(signs, 0);
});
