// Verify saved capture provenance without replaying financial actions.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url), read = file => readFile(new URL(file,root));
const sha = b => createHash('sha256').update(b).digest('hex');
const ev = JSON.parse(await read('web/preview-flow-results.json'));
assert(ev.complete); assert.equal(ev.finalTransaction.finality,'FINAL');
assert.deepEqual(ev.api,['/api/testnet/settle']);
assert.equal(ev.receipts.length,2); const [first,onward]=ev.receipts;
assert.equal(first.outputs[0].id,first.id+':0'); assert.equal(onward.input,first.outputs[0].id);
assert.equal(first.outputs[0].amount,'1000000'); assert.equal(onward.outputs[0].amount,'1000000');
assert.equal(first.outputs[1].amount,'3000000'); assert.equal(onward.outputs.length,1);
assert.equal(first.block_height,onward.block_height);
for(const [file,hash] of Object.entries(ev.sourceFiles))assert.equal(sha(await read(file)),hash,'Replayed UI source changed: '+file);
for(const set of [ev.captures,ev.originalCaptures])for(const variants of Object.values(set))for(const shot of Object.values(variants))assert.equal(sha(await read(shot.file)),shot.sha256,'Capture changed: '+shot.file);
for(const variants of Object.values(ev.captures))assert.notEqual(variants.light.sha256,variants.dark.sha256);
console.log('Verified saved two-transfer receipt chain, one settlement call, current presentation sources and all original/replayed frame hashes. No network or financial action.');
