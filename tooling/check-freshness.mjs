// Content drift gate, not a claim that tests or live integrations are correct.
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), staged = args.includes('--staged'), record = args.includes('--record');
assert(args.length <= 1 && args.every(x => ['--staged', '--record'].includes(x)), 'Use --staged or --record');
const manifest = 'research/development-freshness.json';
const git = (...arguments_) => {
  const result = spawnSync('git', arguments_, { windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
};
const groups = [
  ['web', /^web\//], ['near', /^contracts\/(?!adapter\/)/], ['rhea', /^contracts\/adapter\//],
  ['intents', /^integrations\//], ['aurora', /^aurora\//], ['zcash', /^zcash\//],
  ['research-and-proofs', /^(?:research\/|crypto-step\/|experiments\/|model\/|models\/|README\.md$|TASKS\.md$)/],
  ['development-checks', /^tooling\/(?:check-|hooks\/)/],
  ['other-components', /./],
];
const textFile = /(?:\.(?:[cm]?js|rs|sol|circom|swift|kt|html|css|json|toml|lock|md|ps1|ya?ml|mp4|webp|png|jpe?g)|Dockerfile(?:\.dockerignore)?|Caddyfile\.example|\.env\.(?:example|sample)|tooling\/hooks\/[^/]+)$/;
const files = [...new Set(git('ls-files', '-z', ...(staged ? ['--cached'] : ['--cached', '--others', '--exclude-standard'])).toString().split('\0').filter(Boolean))]
  .filter(name => name !== manifest && textFile.test(name) && groups.some(([,pattern]) => pattern.test(name))).sort();
const bytes = new Map();
if (staged) {
  // One Git process reads exact staged blobs, including filenames with spaces.
  const result = spawnSync('git', ['cat-file', '--batch'], { input: files.map(name => ':' + name).join('\n') + '\n', windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  let offset = 0;
  for (const file of files) {
    const end = result.stdout.indexOf(10, offset), header = result.stdout.subarray(offset, end).toString();
    assert(/^[0-9a-f]+ blob \d+$/.test(header), 'Missing staged file: ' + file);
    const size = Number(header.split(' ')[2]); offset = end + 1;
    bytes.set(file, result.stdout.subarray(offset, offset + size)); offset += size + 1;
  }
} else {
  for (const file of files) { try { bytes.set(file, await readFile(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const current = Object.fromEntries([...bytes].map(([file, buffer]) => [file, hash(buffer)]));
if (record) {
  await writeFile(manifest, JSON.stringify({ reviewedAt: new Date().toISOString(), review: 'research/development-freshness.md', files: current }, null, 2) + '\n');
  console.log(`Recorded ${bytes.size} reviewed inputs; this command does not verify their claims.`);
} else {
  const expected = JSON.parse(staged ? git('show', ':' + manifest) : await readFile(manifest));
  const changed = [...new Set([...Object.keys(expected.files), ...Object.keys(current)])].filter(file => expected.files[file] !== current[file]);
  if (changed.length) {
    console.error('Freshness review required for: ' + [...new Set(changed.map(file => groups.find(([,pattern]) => pattern.test(file))?.[0]))].join(', '));
    console.error(changed.join('\n'));
    throw Error('Review affected code, claims, evidence and caches; update research/development-freshness.md, then run --record.');
  }
  console.log(`Freshness record matches ${bytes.size} ${staged ? 'staged' : 'working-tree'} inputs across ${groups.length} areas.`);
}
const provenance = JSON.parse(bytes.get('web/preview-recording.json'));
for (const [file, expected] of Object.entries(provenance.sourceFiles)) {
  assert.equal(current[file], expected, `Recorded app source changed: ${file}. Review and refresh the affected videos.`);
}
for (const video of provenance.videos) {
  assert.equal(current[video.file], video.sha256, `Video changed: ${video.file}. Record and verify it.`);
  assert.equal(current[video.poster], video.posterSha256, `Poster changed: ${video.poster}. Record and verify it.`);
}
console.log('Recorded app source, video and poster hashes match.');
