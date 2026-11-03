import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletSession, nativeAmount } from './public/evm-wallet.js';
const address = '0x' + '12'.repeat(20), other = '0x' + '34'.repeat(20);
function fixture() {
  const handlers = new Map(), calls = [];
  const p = { address, chain: '0x1', balance: '0xde0b6b3a7640001', block: '0x2a', hook: null,
    on(event, fn) { handlers.set(event, fn); }, removeListener(event, fn) { if (handlers.get(event) === fn) handlers.delete(event); },
    emit(event) { handlers.get(event)?.(); },
    async request(value) { calls.push(value); if (p.hook) { const result = await p.hook(value); if (result !== undefined) return result; }
      return ({ eth_requestAccounts: [p.address], eth_accounts: [p.address], eth_chainId: p.chain, eth_blockNumber: p.block, eth_getBalance: p.balance })[value.method]; },
  };
  return { p, handlers, calls };
}
test('connection reads exact native amount and network-bound receive URI without signing', async () => {
  const { p, calls } = fixture(), session = createWalletSession();
  assert.equal(calls.length, 0);
  const result = await session.connect(p);
  assert.equal(result.amount, '1.000000000000000001');
  assert.equal(result.receiveUri, `ethereum:${address}@1`);
  assert.deepEqual(calls.map(c => c.method), ['eth_requestAccounts', 'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_chainId', 'eth_accounts']);
  assert.deepEqual(calls[3].params, [address, '0x2a']);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.network));
});
test('all supported networks retain their actual chain identities', async () => {
  for (const [chain, id] of [['0x1', '1'], ['0xa4b1', '42161'], ['0x2105', '8453']]) {
    const { p } = fixture(); p.chain = chain;
    assert.equal((await createWalletSession().connect(p)).receiveUri, `ethereum:${address}@${id}`);
  }
});
test('refresh rechecks accounts without requesting permissions again', async () => {
  const { p, calls } = fixture(), session = createWalletSession(); await session.connect(p);
  p.balance = '0x0'; assert.equal((await session.refresh()).amount, '0');
  assert.equal(calls.filter(c => c.method === 'eth_requestAccounts').length, 1);
});
test('unsupported chains, empty/zero/invalid accounts and malformed quantities fail closed', async () => {
  for (const change of [p => p.chain = '0x89', p => p.chain = '1', p => p.address = '0x'+'00'.repeat(20), p => p.address = 'alice', p => p.block = '0x00', p => p.balance = '-1', p => p.balance = '0x'+'f'.repeat(65), p => p.hook = ({method}) => method === 'eth_requestAccounts' ? [] : undefined]) {
    const { p, handlers } = fixture(); change(p); const session = createWalletSession();
    await assert.rejects(session.connect(p)); assert.equal(session.snapshot, null); assert.equal(handlers.size, 0);
  }
  assert.throws(() => nativeAmount('1')); assert.throws(() => nativeAmount('0x01'));
});
test('provider events clear the account and remove listeners without automatic reconnection', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
    const { p, calls, handlers } = fixture(), session = createWalletSession(); await session.connect(p);
    const count = calls.length; p.emit(event);
    assert.equal(session.snapshot, null); assert.equal(handlers.size, 0); assert.equal(calls.length, count);
  }
});
test('silent account or network changes during a balance read reject the result', async () => {
  for (const change of [p => p.address = other, p => p.chain = '0x2105']) {
    const { p } = fixture(); p.hook = ({method}) => { if (method === 'eth_getBalance') change(p); };
    const session = createWalletSession(); await assert.rejects(session.connect(p), /changed/); assert.equal(session.snapshot, null);
  }
});
test('disconnect while permission is pending rejects late replies', async () => {
  const { p, calls } = fixture(); let resolve, started;
  const ready = new Promise(r => started = r);
  p.hook = ({method}) => method === 'eth_requestAccounts' ? new Promise(r => { resolve = r; started(); }) : undefined;
  const session = createWalletSession(), pending = session.connect(p); await ready;
  session.disconnect(); resolve([address]); await assert.rejects(pending, /changed/);
  assert.equal(session.snapshot, null); assert.equal(calls.length, 1);
});
test('late result from an old provider cannot overwrite a new session', async () => {
  const old = fixture(), next = fixture(); next.p.address = other;
  let resolve, started; const ready = new Promise(r => started = r);
  old.p.hook = ({method}) => method === 'eth_getBalance' ? new Promise(r => { resolve = r; started(); }) : undefined;
  const session = createWalletSession(), pending = session.connect(old.p); await ready; session.disconnect();
  await session.connect(next.p); resolve('0x0'); await assert.rejects(pending, /changed/);
  assert.equal(session.snapshot.address, other);
});
test('wallet rejection and timeout leave no active session or listeners', async () => {
  for (const hang of [false, true]) {
    const { p, handlers } = fixture(); p.hook = () => hang ? new Promise(() => {}) : Promise.reject(Object.assign(Error('Declined'), {code:4001}));
    const session = createWalletSession({timeoutMs:20}); await assert.rejects(session.connect(p));
    assert.equal(session.snapshot, null); assert.equal(session.pending, false); assert.equal(handlers.size, 0);
  }
});
test('a second connection cannot create overlapping permission requests', async () => {
  const { p, calls } = fixture(); let resolve, started; const ready = new Promise(r => started = r);
  p.hook = ({method}) => method === 'eth_requestAccounts' ? new Promise(r => { resolve = r; started(); }) : undefined;
  const session = createWalletSession(), pending = session.connect(p); await ready;
  await assert.rejects(session.connect(p), /already open/); assert.equal(calls.length, 1);
  resolve([address]); await pending;
});
test('providers without change notifications are rejected before any request', async () => {
  const { p, calls } = fixture(); delete p.removeListener;
  await assert.rejects(createWalletSession().connect(p), /notifications/); assert.equal(calls.length, 0);
});
test('captured session rejects stale dispatch and preserves a reply from an already dispatched transaction', async () => {
  const {p}=fixture(),session=createWalletSession();await session.connect(p);const old=session.capture();
  assert.throws(()=>old.request('personal_sign',[]),/Unsupported/);await session.refresh();assert.throws(()=>old.sendTransaction({}),/changed/);
  const current=session.capture();let resolve,started;const ready=new Promise(r=>started=r);
  p.hook=({method})=>method==='eth_sendTransaction'?new Promise(r=>{resolve=r;started();}):undefined;
  const pending=current.sendTransaction({from:'0x'+'12'.repeat(20)});await ready;session.disconnect();resolve('0x'+'ab'.repeat(32));
  assert.equal(await pending,'0x'+'ab'.repeat(32));assert.equal(session.snapshot,null);assert.throws(()=>current.sendTransaction({}),/changed/);
});
