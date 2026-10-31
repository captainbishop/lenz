// Targeted guard checks; not a full mutation-testing tool or security audit.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const filenames = [
  'transfer-model.mjs', 'transfer-model.test.mjs', 'transition-relation.mjs', 'transition-relation.test.mjs',
  'witness-map.mjs', 'witness-delivery.mjs', 'witness-fixture.mjs', 'witness-delivery.test.mjs',
];
const sources = new Map(filenames.map(name => [name, readFileSync(join(directory, name), 'utf8')]));
const monetaryMutants = [
  ['ownership', "requireRule(input.owner === tx.authorizedBy, 'unauthorized');", '// ownership guard removed'],
  ['conservation', "requireRule(sum(tx.outputs) === input.amount, 'value-not-conserved');", '// conservation guard removed'],
  ['double-spend', "if (this.spent.has(tx.input)) return { status: 'rejected-conflict', retry: false };", '// spent-input guard removed'],
  ['transcript binding', "requireRule(tx.id === transcriptId(tx), 'transcript-id-mismatch');", '// transcript guard removed'],
];
const relationMutants = [
  ['current state', "rule(statement.priorRoot === stateDigest(ledger), 'stale-state');", '// current-root check removed'],
  ['package binding', "rule(statement.packageCommitment === checked.statement.packageCommitment, 'wrong-package');", '// package binding removed'],
  ['next state', "rule(statement.nextRoot === checked.statement.nextRoot, 'wrong-next-state');", '// next-root check removed'],
  ['complete dependencies', "rule(outcome.status === 'finalized', `invalid-dependency:${outcome.status}`);", '// dependency check removed'],
  ['atomic staging', 'const staged = cloneLedger(ledger);', 'const staged = ledger;'],
];
const mutants = [
  ...monetaryMutants.map(m => ['transfer-model.mjs', ...m]),
  ...relationMutants.map(m => ['transition-relation.mjs', ...m]),
  ['witness-delivery.mjs', 'snapshot root authentication', "rule(tree.root === request.root, 'snapshot-root-mismatch');", '// snapshot root check removed'],
  ['witness-delivery.mjs', 'recomputed snapshot contents', "rule(staged.root === trustedCheckpoint.root, 'snapshot-content-mismatch');", '// contents check removed'],
  ['witness-delivery.mjs', 'step proof verification', "rule(verifyStep(edge, capsule.domain) === true, 'invalid-step-proof');", '// proof check removed'],
  ['witness-delivery.mjs', 'ancestor winner binding', "rule(winner === edge.id, 'conflicting-ancestor');", '// winner check removed'],
  ['witness-delivery.mjs', 'input existence', "rule(query(noteKey(tree.domain, edge.input)) === noteValue(tree.domain, edge.input), 'missing-input-provenance');", '// input check removed'],
];

const temporary = mkdtempSync(join(directory, '.transfer-mutation-'));
try {
  for (const [filename, name, before, after] of mutants) {
    for (const [file, original] of sources) writeFileSync(join(temporary, file), original);
    const source = sources.get(filename);
    assert.equal(source.split(before).length, 2, `Expected exactly one ${name} guard`);
    writeFileSync(join(temporary, filename), source.replace(before, after));
    const testPaths = filenames.filter(file => file.endsWith('.test.mjs')).map(file => join(temporary, file));
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testPaths], { encoding: 'utf8' });
    assert.ifError(run.error);
    assert.equal(run.status, 1, `${name} mutant must fail with test exit code 1`);
    assert.match(run.stdout, /failureType: 'testCodeFailure'/, `${name} must fail an actual test`);
    assert.match(run.stdout, /code: 'ERR_ASSERTION'/, `${name} must trip an assertion, not only crash`);
    console.log(`Killed mutant: ${name}`);
  }
} finally {
  // Delete only these generated files, then their empty unique folder.
  for (const file of filenames) {
    const path = join(temporary, file);
    if (existsSync(path)) unlinkSync(path);
  }
  rmdirSync(temporary);
}
