import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
test('freshness catches hidden component drift, new files, staged differences and stale recordings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lenz-freshness-'));
  const run = (exe, args) => spawnSync(exe, args, { cwd: directory, windowsHide: true, encoding: 'utf8' });
  const put = async (file, value) => { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), value); };
  const hash = value => createHash('sha256').update(value).digest('hex');
  try {
    assert.equal(run('git', ['init', '-q']).status, 0);
    await put('.gitattributes', '* -text\n');
    await put('tooling/check-freshness.mjs', await readFile(new URL('./check-freshness.mjs', import.meta.url)));
    await put('research/development-freshness.md', 'Fixture review');
    await put('web/public/chat.js', 'fixture app'); await put('integrations/route.mjs', 'fixture route');
    await put('web/public/previews/chat.mp4', 'fixture video'); await put('web/public/previews/chat.webp', 'fixture poster');
    await put('web/evidence/frame.png', 'captured frame');
    await put('web/preview-recording.json', JSON.stringify({ sourceFiles: { 'web/public/chat.js': hash('fixture app') }, videos: [{ file: 'web/public/previews/chat.mp4', sha256: hash('fixture video'), poster: 'web/public/previews/chat.webp', posterSha256: hash('fixture poster') }] }));
    const gate = (...args) => run(process.execPath, ['tooling/check-freshness.mjs', ...args]);
    assert.equal(gate('--record').status, 0); assert.equal(gate().status, 0);
    assert.equal(run('git', ['add', '.']).status, 0); assert.equal(gate('--staged').status, 0);
    await put('integrations/route.mjs', 'changed route');
    const drift = gate(); assert.notEqual(drift.status, 0); assert.match(drift.stderr, /intents/);
    assert.equal(gate('--staged').status, 0, 'unstaged changes must not be mistaken for staged content');
    assert.equal(run('git', ['add', 'integrations/route.mjs']).status, 0);
    assert.notEqual(gate('--staged').status, 0, 'changed staged source requires a review');
    await put('integrations/route.mjs', 'fixture route');
    await put('aurora/new.sol', 'new fixture'); assert.notEqual(gate().status, 0, 'new component file is detected');
    await rm(join(directory, 'aurora/new.sol'));
    for(const file of ['carrier/Dockerfile','carrier/Dockerfile.dockerignore','carrier/compose.yaml','carrier/Caddyfile.example','carrier/.env.example']){
      await put(file,'deployment fixture');assert.notEqual(gate().status,0,'deployment changes require freshness review: '+file);await rm(join(directory,file));
    }
    await put('web/evidence/frame.png', 'altered frame');
    assert.notEqual(gate().status, 0, 'source image changes require review too');
    await put('web/evidence/frame.png', 'captured frame');
    await put('web/public/chat.js', 'changed app');
    const staleRecording = gate('--record'); assert.notEqual(staleRecording.status, 0); assert.match(staleRecording.stderr, /Recorded app source changed/);
  } finally {
    const resolved = await realpath(directory), parent = await realpath(tmpdir());
    assert.equal(dirname(resolved), parent); assert(resolved.includes('lenz-freshness-'));
    await rm(resolved, { recursive: true });
  }
});
