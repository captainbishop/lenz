import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url), hash = data => createHash('sha256').update(data).digest('hex');
const read = path => readFile(new URL(path, root));
const recording = JSON.parse(await read('web/preview-recording.json'));
assert.equal(recording.videos.length, 6); assert.equal(recording.apiRequests, 0); assert.deepEqual(recording.errors, []);
for (const [path, expected] of Object.entries(recording.sourceFiles)) assert.equal(hash(await read(path)), expected, 'Recording is stale: ' + path);
let bytes = 0;
for (const video of recording.videos) {
  assert(video.seconds >= 12 && video.seconds <= 24 && video.width === 1200 && video.height === 1320 && video.fps === 30 && video.changingFrames > 90);
  assert(video.states.length >= 3); assert.equal(new Set(video.sceneHashes).size, video.states.length, 'Repeated product scenes');
  const data = await read(video.file); bytes += data.length;
  assert.equal(data.subarray(4, 8).toString(), 'ftyp', 'MP4 header required');
  assert.equal(hash(data), video.sha256, 'Video differs: ' + video.file);
  assert.equal(hash(await read(video.poster)), video.posterSha256, 'Poster differs: ' + video.poster);
}
assert.equal(new Set(recording.videos.map(v => v.view + '-' + v.theme)).size, 6);
const revision = createHash('sha256').update(JSON.stringify(recording));
for (const file of ['web/public/index.html','web/public/home.css','web/public/home.js','web/public/home-interactive.js','web/public/home-videos.js','web/public/media-range.js','web/security-policy.mjs']) revision.update(await read(file));
const marker = '// Preview recording revision: ' + revision.digest('hex');
const worker = (await read('web/public/sw.js')).toString();
const nextWorker = marker + '\n' + worker.replace(/^\/\/ Preview (?:source|recording) revision:[^\n]*\r?\n/, '');
if (process.argv.includes('--update-cache')) await writeFile(new URL('web/public/sw.js', root), nextWorker);
else assert.ok(worker === nextWorker, 'Homepage cache revision differs; run with --update-cache after review.');
console.log(`Verified six light/dark app videos (${(bytes / 1e6).toFixed(2)} MB) against ${Object.keys(recording.sourceFiles).length} recorded source files and the homepage cache revision.`);
