const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const results = [];
for (const mutant of ['conflict', 'persistence']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'reservation-browser.test.cjs')], {
    env: { ...process.env, RESERVATION_MUTANT: mutant }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 1, `${mutant}: mutant survived or failed to run`);
  assert.match(result.stderr, /2 !== 1/, `${mutant}: unexpected failure\n${result.stderr}`);
  results.push({ mutant, detected: true, reason: 'Both conflicting signatures escaped; expected one.' });
  console.log(`DETECTED ${mutant}`);
}
writeFileSync(path.join(__dirname, 'reservation-mutation-results.json'), JSON.stringify(results, null, 2) + '\n');
