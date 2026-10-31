import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {externalizeProofWorker} from './build-proof-worker.mjs';

const source = await readFile(new URL('../research/crypto-step/node_modules/ffjavascript/build/browser.esm.js', import.meta.url), 'utf8');

test('externalized worker retains the pinned implementation byte for byte', () => {
  const result = externalizeProofWorker(source);
  const embedded = source.match(/const threadSource = stringToBase64\("\(" \+ ("function thread\(self\)[^\n]+") \+ "\)\(self\)"\);/);
  assert(embedded, 'Pinned worker must be present');
  assert.equal(result.worker, '(' + JSON.parse(embedded[1]) + ')(self);\n');
  assert.doesNotThrow(() => new vm.Script(result.worker));
  assert(result.source.includes("new URL('./ffjavascript-worker.js', import.meta.url)"));
  assert(!result.source.includes('data:application/javascript;base64,'));
  const declarationEnd = source.indexOf('\n', source.indexOf('const workerSource =', embedded.index));
  const originalDeclaration = source.slice(embedded.index, declarationEnd);
  assert.equal(result.source.replace("const workerSource = new URL('./ffjavascript-worker.js', import.meta.url);", () => originalDeclaration), source);
});

test('missing, duplicate or changed worker layouts stop the build', () => {
  for (const changed of ['', source + '\n' + source, source.replace('const threadSource = stringToBase64(', 'const threadSource = changedEncoder(')]) {
    assert.throws(() => externalizeProofWorker(changed), /layout changed/);
  }
});

test('checked-in browser assets match the transformation of the pinned dependency', async () => {
  const expected = externalizeProofWorker(source);
  assert.equal(await readFile(new URL('./public/vendor/ffjavascript.js', import.meta.url), 'utf8'), expected.source);
  assert.equal(await readFile(new URL('./public/vendor/ffjavascript-worker.js', import.meta.url), 'utf8'), expected.worker);
});
