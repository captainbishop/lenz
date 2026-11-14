import test from 'node:test';
import assert from 'node:assert/strict';
import { createPopupTransport, METEOR_ORIGIN } from './near-connector/meteor-popup.js';
import { createMeteorWallet, ACCOUNT_KEY } from './near-connector/entry.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const listeners = new Set(), intervals = new Map(), timers = new Map(), storage = new Map(), popups = [];
  let serial = 0;
  const host = { crypto, location: new URL('http://localhost/wallet-lab.html?private=value#secret'),
    setInterval(fn) { intervals.set(++serial, fn); return serial; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { timers.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { assert.equal(type, 'message'); listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    btoa, fetch: async () => ({ ok: true, json: async () => ({ result: { header: { hash: '11111111111111111111111111111111' } } }) }),
    open(url) { const popup = { url: new URL(url), closed: false, sent: [], close() { this.closed = true; },
      postMessage(data, origin) { assert.equal(origin, METEOR_ORIGIN); this.sent.push(data); } }; popups.push(popup); return popup; },
  };
  const reply = (data = {}, event = {}) => {
    const popup = popups.at(-1);
    for (const listener of listeners) listener({ origin: METEOR_ORIGIN, source: popup,
      data: { uid: popup.url.searchParams.get('connectionUid'), status: 'closed_success', payload: { accountId: 'receiver.testnet' }, ...data }, ...event });
  };
  return { host, listeners, intervals, timers, storage, popups, reply, transport: createPopupTransport(host) };
}
for (const forgery of ['origin', 'source', 'uid', 'network', 'actionType']) test(`ignores a forged ${forgery} before accepting the matching popup`, async () => {
  const f = fixture(); let finished = false;
  const result = f.transport.request('login', async () => ({ methods: [] })).then(value => { finished = true; return value; });
  await flush();
  if (forgery === 'origin') f.reply({}, { origin: 'https://imposter.example' });
  else if (forgery === 'source') f.reply({}, { source: {} });
  else f.reply({ [forgery]: { uid: 'stale', network: 'mainnet', actionType: 'sign' }[forgery] });
  await flush(); assert.equal(finished, false);
  f.reply(); assert.equal((await result).accountId, 'receiver.testnet');
  assert.equal(f.listeners.size, 0); assert.equal(f.intervals.size, 0);
});
test('popup opens before preparation, drops page secrets and resumes only its own inputs', async () => {
  const f = fixture(); let prepare;
  const result = f.transport.request('sign', () => new Promise(resolve => { prepare = resolve; }));
  const popup = f.popups[0]; assert.equal(popup.url.pathname, '/connect/testnet/sign');
  assert.equal(popup.url.searchParams.get('source'), 'wpm');
  assert.equal(decodeURIComponent(popup.url.searchParams.get('pageUri')), 'http://localhost/wallet-lab.html');
  await flush(); f.reply(); assert.equal(f.listeners.size, 1); assert.equal(popup.sent.length, 0);
  prepare({ transactions: 'expected' }); await flush();
  f.reply({ status: 'connected' }); for (const fn of f.intervals.values()) fn();
  assert.equal(popup.sent.at(-1).inputs, undefined);
  f.reply({ status: 'attempting_reconnect' }); assert.deepEqual(popup.sent.at(-1).inputs, { transactions: 'expected' });
  f.reply(); await result; assert.equal(popup.sent.at(-1).status, 'closed_success');
});
for (const failure of ['closed', 'timeout', 'disconnect', 'prepare', 'closed_fail', 'closed_window']) test(`${failure} cleans up and leaves late replies inert`, async () => {
  const f = fixture(); let signal, prepare;
  const result = f.transport.request('sign', value => { signal = value; return new Promise((resolve, reject) => { prepare = { resolve, reject }; }); });
  const rejected = assert.rejects(result); await flush();
  if (failure === 'closed') { f.popups[0].closed = true; for (const fn of [...f.intervals.values()]) fn(); }
  else if (failure === 'timeout') [...f.timers.values()].find(t => t.ms === 120000).fn();
  else if (failure === 'disconnect') f.transport.cancel();
  else if (failure === 'prepare') prepare.reject(new Error('Network failed'));
  else { prepare.resolve({ transactions: 'expected' }); await flush(); f.reply({ status: failure }); }
  await rejected; prepare.resolve({ transactions: 'late' }); await flush(); f.reply();
  assert(signal.aborted); assert.equal(f.listeners.size, 0); assert.equal(f.intervals.size, 0); assert(f.popups[0].closed);
});
test('blocked popups and concurrent requests fail without starting another action', async () => {
  const f = fixture(); const result = f.transport.request('login', async () => ({ methods: [] }));
  const rejected = assert.rejects(result, /cancelled/);
  await assert.rejects(f.transport.request('sign', async () => ({})), /already open/); assert.equal(f.popups.length, 1);
  f.transport.cancel(); await rejected;
  f.host.open = () => null; await assert.rejects(f.transport.request('login', async () => ({})), /Allow popups/);
});
test('selection requests no key; disconnect forgets only its label and cancels stale login', async () => {
  const f = fixture(), wallet = createMeteorWallet(f.host); f.storage.set('existing-identity', 'preserved');
  const login = wallet.signIn(); await flush(); assert.deepEqual(f.popups[0].sent[0].inputs, { methods: [] }); f.reply();
  assert.deepEqual(await login, [{ accountId: 'receiver.testnet' }]);
  const stale = wallet.signIn(), rejected = assert.rejects(stale, /cancelled/); await flush();
  wallet.disconnect(); f.reply(); await rejected;
  assert.deepEqual(await wallet.getAccounts(), []); assert.equal(f.storage.get('existing-identity'), 'preserved');
});
test('malformed account selection is never stored', async () => {
  for (const accountId of ['receiver.near', 'x'.repeat(65) + '.testnet', undefined]) {
    const f = fixture(), wallet = createMeteorWallet(f.host), result = wallet.signIn(), rejected = assert.rejects(result, /Invalid account/);
    await flush(); f.reply({ payload: { accountId } }); await rejected; assert.equal(f.storage.size, 0);
  }
});
const transaction = { network: 'testnet', signerId: 'receiver.testnet', receiverId: 'reserve.testnet', actions: [{ type: 'FunctionCall', params: {
  methodName: 'deposit_offline', args: { owner: 'test-owner', amount: '1000000', source: 'test-source', signature: 'test-signature' }, gas: '50000000000000', deposit: '30000000000000000000000' } }] };
test('adapter refuses another account, network, method, fee or additional action before opening', () => {
  const f = fixture(), wallet = createMeteorWallet(f.host); f.storage.set(ACCOUNT_KEY, 'receiver.testnet');
  for (const edit of [t => { t.network = 'mainnet'; }, t => { t.signerId = 'other.testnet'; }, t => { t.actions.push(t.actions[0]); },
    t => { t.actions[0].params.methodName = 'transfer'; }, t => { t.actions[0].params.deposit = '999'; }, t => { t.actions[0].params.gas = '999'; }]) {
    const tx = structuredClone(transaction); edit(tx); assert.throws(() => wallet.signAndSendTransaction(tx), /Invalid refund/);
  }
  assert.equal(f.popups.length, 0);
});
test('RPC failure closes the popup without exposing a transaction', async () => {
  const f = fixture(), wallet = createMeteorWallet(f.host); f.storage.set(ACCOUNT_KEY, 'receiver.testnet');
  f.host.fetch = async () => ({ ok: false });
  await assert.rejects(wallet.signAndSendTransaction(transaction), /Network/);
  assert(f.popups[0].closed); assert.equal(f.popups[0].sent.length, 0); assert.equal(f.listeners.size, 0);
});
test('refund review is rechecked after awaited transaction preparation before any bytes reach the popup', async()=>{
  const f=fixture(),wallet=createMeteorWallet(f.host);f.storage.set(ACCOUNT_KEY,'receiver.testnet');
  let release,current=true,checks=0;const waiting=new Promise(r=>release=r),fetcher=f.host.fetch;
  f.host.fetch=async()=>{await waiting;return fetcher();};
  const pending=wallet.signAndSendTransaction(transaction,{beforeSign:async()=>{checks++;assert(current,'Lenz account changed');}}),rejected=assert.rejects(pending,/account changed/);
  await flush();assert.equal(f.popups[0].sent.length,0);current=false;release();await rejected;
  assert.equal(checks,1);assert.equal(f.popups[0].sent.length,0);assert(f.popups[0].closed);
});
test('a payer switch during the final review check cannot disclose a prepared transaction',async()=>{
  const f=fixture(),wallet=createMeteorWallet(f.host);f.storage.set(ACCOUNT_KEY,'receiver.testnet');
  await assert.rejects(wallet.signAndSendTransaction(transaction,{beforeSign:async()=>{f.storage.set(ACCOUNT_KEY,'other.testnet');}}),/selected wallet changed/);
  assert.equal(f.popups[0].sent.length,0);assert(f.popups[0].closed);
});
