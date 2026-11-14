import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { openAuroraPrivateJournal } from './intent-aurora-sponsor-live.mjs';
import { createLendingService, emptyLendingJournal } from './intent-lending-service.mjs';
import { createLendingSupplyService, emptyLendingSupplyJournal } from './intent-lending-supply.mjs';
import { createLendingSetupService } from './intent-lending-setup.mjs';
import { createLendingFundingService, emptyLendingFundingJournal } from './intent-lending-funding.mjs';
import { createLendingRepaymentFundingService } from './intent-lending-repayment-funding.mjs';

const namespaces = ['orders', 'supply', 'setup', 'funding', 'repayment'];
const check = (value, message) => { if (!value) throw Error(message); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
export const emptyLendingRuntimeJournal = () => ({
  version: 2, orders: emptyLendingJournal(), supply: emptyLendingSupplyJournal(),
  setup: { version: 1, requests: {}, pending: null }, funding: emptyLendingFundingJournal(), repayment: { version: 1, requests: {}, pending: null }, sponsorFence: null,
});

function validate(state) {
  check(plain(state) && Object.keys(state).sort().join() === 'funding,orders,repayment,setup,sponsorFence,supply,version' && state.version === 2 && JSON.stringify(state).length <= 1_999_900, 'The shared lending journal is invalid.');
  const fence = state.sponsorFence;
  check(fence === null || plain(fence) && Object.keys(fence).sort().join() === 'id,namespace' && namespaces.includes(fence.namespace) && validId(fence.id), 'The retained lending sponsor fence is invalid.');
  for (const namespace of namespaces) {
    const value = state[namespace];
    check(plain(value) && value.version === 1 && plain(value.requests) && Object.hasOwn(value, 'pending'), 'The retained lending namespace is invalid.');
    const pending = typeof value.pending === 'string' ? value.pending : value.pending?.id;
    check(value.pending === null || validId(pending) && fence?.namespace === namespace && fence.id === pending, 'The unresolved lending request lost its shared sponsor fence.');
  }
  return state;
}

export async function openLendingCoordinator({ stateDir, journal } = {}) {
  const retained = journal ?? await openAuroraPrivateJournal({ stateDir, fileName: 'lending-state.json', initial: emptyLendingRuntimeJournal });
  try {
    const state = await retained.read();
    if (plain(state) && state.version === 1 && Object.keys(state).sort().join() === 'funding,orders,setup,sponsorFence,supply,version') {
      const upgraded = validate({ ...structuredClone(state), version: 2, repayment: { version: 1, requests: {}, pending: null } });
      await retained.write(upgraded);
      check(isDeepStrictEqual(await retained.read(), upgraded), 'The original loan and funding journal upgrade was not durably saved.');
    } else validate(state);
  } catch (error) { await retained.close(); throw error; }
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve(), closed = false, closing;
  function serialize(work) {
    if (context.getStore()?.active) return Promise.resolve().then(work);
    if (closed) return Promise.reject(Error('The lending runtime is closed.'));
    const task = queue.then(() => {
      const token = { active: true };
      return context.run(token, async () => { try { return await work(); } finally { token.active = false; } });
    });
    queue = task.catch(() => {});
    return task;
  }
  async function read() { return validate(await retained.read()); }
  async function persist(state) {
    validate(state);
    await retained.write(structuredClone(state));
    check(isDeepStrictEqual(await read(), state), 'The shared lending state was not durably saved.');
  }
  const scopes = Object.fromEntries(namespaces.map(namespace => {
    const matches = (fence, id) => fence?.namespace === namespace && fence.id === id;
    const sponsorFence = Object.freeze({
      assertAvailable: id => serialize(async () => {
        check(id === undefined || validId(id), 'Invalid original lending request.');
        const fence = (await read()).sponsorFence;
        check(fence === null || id !== undefined && matches(fence, id), 'Check the original pending sponsor transaction.');
      }),
      reserve: id => serialize(async () => {
        check(validId(id), 'Invalid original lending request.');
        const state = await read();
        check(state.sponsorFence === null || matches(state.sponsorFence, id), 'Check the original pending sponsor transaction.');
        if (state.sponsorFence === null) { state.sponsorFence = { namespace, id }; await persist(state); }
      }),
      release: id => serialize(async () => {
        check(validId(id), 'Invalid original lending request.');
        const state = await read();
        if (state.sponsorFence === null) return;
        if (!matches(state.sponsorFence, id)) return;
        check(state[namespace].pending === null, 'The original lending transaction is still pending.');
        state.sponsorFence = null; await persist(state);
      }),
    });
    return [namespace, Object.freeze({ serialize, sponsorFence, journal: Object.freeze({
      read: () => serialize(async () => structuredClone((await read())[namespace])),
      write: value => serialize(async () => { const state = await read(); state[namespace] = structuredClone(value); await persist(state); }),
    }) })];
  }));
  return Object.freeze({
    serialize,
    scope(namespace) { check(namespaces.includes(namespace), 'Unknown lending journal namespace.'); return scopes[namespace]; },
    close() { if (!closing) { closed = true; closing = queue.then(() => retained.close()); } return closing; },
  });
}

export async function openLendingRuntime({ stateDir, journal, supplyRpc, fundingRpc, setupFactory = createLendingSetupService, ...options } = {}) {
  const coordinator = await openLendingCoordinator({ stateDir, journal });
  try {
    const wrap = service => Object.freeze(Object.fromEntries(Object.entries(service).map(([name, method]) => [name, (...args) => coordinator.serialize(() => { args[1]?.signal?.throwIfAborted(); return method(...args); })])));
    const orders = wrap(createLendingService({ ...options, ...coordinator.scope('orders') }));
    const supply = wrap(createLendingSupplyService({ ...options, rpc: supplyRpc ?? { ...options.rpc, simulate: options.rpc?.simulateSupply }, ...coordinator.scope('supply') }));
    const funding = wrap(createLendingFundingService({ ...options, rpc: fundingRpc ?? { ...options.rpc, simulate: options.rpc?.simulateFunding }, ...coordinator.scope('funding') }));
    const repayment = typeof options.rpc?.repaymentSnapshot === 'function' ? wrap(createLendingRepaymentFundingService({ ...options, ...coordinator.scope('repayment') })) : wrap({ configuration: async () => ({ available: false, execute: false }), submit: async () => { throw Error('Repay test funds are unavailable.'); }, reconcile: async () => { throw Error('Repay test funds are unavailable.'); }, resume: async () => { throw Error('Repay test funds are unavailable.'); } });
    const setup = setupFactory ? wrap(setupFactory({ ...options, ...coordinator.scope('setup') })) : null;
    const aliases = (prefix, service) => Object.fromEntries(Object.entries(service).map(([name, method]) => [prefix + name[0].toUpperCase() + name.slice(1), method]));
    return Object.freeze({ ...orders, supply, funding, repayment, ...aliases('supply', supply), ...aliases('funding', funding), ...aliases('repaymentFunding', repayment), ...(setup ? { setup: setup.setup, setupStatus: setup.reconcile } : {}), close: coordinator.close });
  } catch (error) { await coordinator.close(); throw error; }
}
