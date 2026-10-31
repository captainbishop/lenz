import test from 'node:test';
import assert from 'node:assert/strict';
import { proveInWorker } from './public/proof-worker.js';

let worker;
globalThis.Worker = class {
  constructor() { worker = this; this.inputs = []; this.terminated = false; }
  postMessage(input) { this.inputs.push(input); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
};

test('wait for readiness, send once, and do not resolve on a progress message', async () => {
  const input = { secret: 'public-test-fixture' }, stages = [];
  let resolved = false;
  const result = proveInWorker(input, stage => stages.push(stage), 1000).then(value => { resolved = true; return value; });
  assert.deepEqual(worker.inputs, []);
  worker.emit({ ready: true }); worker.emit({ ready: true });
  assert.deepEqual(worker.inputs, [input]);
  worker.emit({ stage: 'Calculating witness…' });
  await Promise.resolve();
  assert.equal(resolved, false); assert.equal(worker.terminated, false);
  assert.deepEqual(stages, ['Calculating witness…']);
  worker.emit({ edge: { id: 'test-edge' } });
  assert.deepEqual(await result, { id: 'test-edge' });
  assert.equal(worker.terminated, true);
});

test('reject worker-reported proof failure and terminate', async () => {
  const result = proveInWorker({}, undefined, 1000);
  worker.emit({ error: 'Invalid witness' });
  await assert.rejects(result, /Invalid witness/);
  assert.equal(worker.terminated, true);
});

test('reject startup errors and terminate', async () => {
  const result = proveInWorker({}, undefined, 1000);
  worker.onerror({ message: 'Missing module' });
  await assert.rejects(result, /Missing module/);
  assert.equal(worker.terminated, true);
});

test('reject malformed final responses', async () => {
  const result = proveInWorker({}, undefined, 1000);
  worker.emit({ unrelated: true });
  await assert.rejects(result, /invalid response/);
  assert.equal(worker.terminated, true);
});

test('reject unreadable messages', async () => {
  const result = proveInWorker({}, undefined, 1000);
  worker.onmessageerror();
  await assert.rejects(result, /could not be read/);
  assert.equal(worker.terminated, true);
});

test('timeout cannot leave a proving worker running', async () => {
  const result = proveInWorker({}, undefined, 20);
  await assert.rejects(result, /timed out/);
  assert.equal(worker.terminated, true);
});
