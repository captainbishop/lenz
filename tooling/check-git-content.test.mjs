import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('./check-git-content.mjs', import.meta.url));
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'lenz-publication-'));
  assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
  assert(cwd.startsWith(join(tmpdir(), 'lenz-publication-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'Publication test');
  git('config', 'user.email', 'test@example.invalid');
  async function put(path, value) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), value);
  }
  const scan = (...args) => {
    const r = spawnSync(process.execPath, [scanner, ...args], { cwd, encoding: 'utf8', windowsHide: true });
    assert([0, 1].includes(r.status), r.stderr);
    return { status: r.status, report: JSON.parse(r.stdout) };
  };
  return { git, put, scan };
}

test('rejects force-staged assistant packages and installation records', async t => {
  const { git, put, scan } = await fixture(t);
  const paths = ['tooling/stack-plugins/plugins/near-builder/skills/near-build/SKILL.md',
    'nested/AGENTS.md', '.agents/plugins/marketplace.json', 'nested/plugin.json',
    'research/security/skill-installation.json', 'research/security/sources/report.html', '.repo-audit/report.json'];
  await put('.gitignore', paths.join('\n'));
  for (const path of paths) await put(path, 'local development material\n');
  git('add', '-f', '--', ...paths);
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert.deepEqual(new Set(r.report.findings.map(x => x.file)), new Set(paths));
});

test('checks staged bytes even after the working file is made harmless', async t => {
  const { git, put, scan } = await fixture(t);
  const token = 'ghp_' + 'a'.repeat(36);
  await put('app.js', `const fixture = '${token}';\n`);
  git('add', 'app.js');
  await put('app.js', 'export const harmless = true;\n');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert(r.report.findings.some(x => x.rule === 'GitHub token'));
  assert(!JSON.stringify(r.report).includes(token));
  assert.equal(scan().status, 0);
});

test('checks committed bytes independently of the index and working tree', async t => {
  const { git, put, scan } = await fixture(t);
  await put('local/SKILL.md', 'local instructions');
  git('add', '.'); git('commit', '-qm', 'fixture');
  git('rm', '--cached', 'local/SKILL.md');
  assert.equal(scan('--staged').status, 0);
  const r = scan('--tree', 'HEAD');
  assert.equal(r.status, 1);
  assert.equal(r.report.findings[0].file, 'local/SKILL.md');
});

test('preserves binary byte counts and allows attributed product dependencies', async t => {
  const { git, put, scan } = await fixture(t);
  const files = { 'asset.bin': Buffer.from([0, 255, 254, 128, 10]),
    'web/public/qr-vendor/LICENSE.txt': Buffer.from('Third-party notice\n'),
    'contracts/fixtures/payment.json': Buffer.from('{"fixture":true}\n') };
  for (const [path, bytes] of Object.entries(files)) await put(path, bytes);
  git('add', '.'); git('commit', '-qm', 'fixture');
  for (const args of [['--staged'], ['--tree', 'HEAD']]) {
    const r = scan(...args);
    assert.equal(r.status, 0);
    assert.equal(r.report.bytes, Object.values(files).reduce((sum, b) => sum + b.length, 0));
  }
});

test('distinguishes public NEAR signatures from secret-key fields', async t => {
  const { git, put, scan } = await fixture(t);
  const encoded = 'ed25519:' + '2'.repeat(88);
  await put('receipt.json', JSON.stringify({ signature: encoded }));
  git('add', '.');
  assert.equal(scan('--staged').status, 0);
  await put('wallet.json', JSON.stringify({ secret_key: encoded }));
  git('add', '.');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert(r.report.findings.some(x => x.file === 'wallet.json' && x.rule === 'NEAR secret key'));
});

test('rejects shared conversations, saved directions and machine paths in exact staged bytes', async t => {
  const { git, put, scan } = await fixture(t);
  const conversation = 'https://' + 'claude.ai/' + 'share/' + 'example-conversation';
  const note = ['The user', 'asked for this in a previous prompt.'].join(' ');
  const direction = ['Apply the', 'humanizer skill to conversational updates.'].join(' ');
  const localPath = ['C:', 'Users', 'Example', 'Documents', 'project'].join('\\');
  await put('docs/reference.md', conversation + '\n' + note + '\n' + direction);
  await put('result.json', JSON.stringify({ location: localPath }));
  await put('fixture.wasm', Buffer.concat([Buffer.from([0, 97, 115, 109]), Buffer.from(localPath)]));
  git('add', '.');
  await put('docs/reference.md', 'Public product documentation.');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  for (const rule of ['shared conversation link', 'conversation working note', 'assistant direction', 'local machine path']) {
    assert(r.report.findings.some(x => x.rule === rule), rule);
  }
  assert(r.report.findings.some(x => x.file === 'fixture.wasm' && x.rule === 'local machine path'));
  assert(!JSON.stringify(r.report).includes(conversation));
  assert(!JSON.stringify(r.report).includes(localPath));
});

test('allows product users, cryptographic handoff fields and publication policy', async t => {
  const { git, put, scan } = await fixture(t);
  await put('docs/product.md', 'The user interface shows pending payments. Protect the user\'s signing keys.\n');
  await put('protocol.js', 'export const handoff = "example";\n');
  await put('CONTRIBUTING.md', 'Keep working notes and assistant instructions out of Git.\n');
  git('add', '.');
  assert.equal(scan('--staged').status, 0);
});

test('rejects workspace names left behind by partial path redaction', async t => {
  const { git, put, scan } = await fixture(t);
  const location = ['file:///', '<user-home>', 'Documents', 'private-project', 'test.mjs'].join('/');
  await put('results.json', JSON.stringify({ location }));
  git('add', '.');
  const result = scan('--staged');
  assert.equal(result.status, 1);
  assert(result.report.findings.some(x => x.rule === 'local machine path'));
  assert(!JSON.stringify(result.report).includes('private-project'));
});

test('scans credentials embedded in binary content', async t => {
  const { git, put, scan } = await fixture(t);
  const token = 'ghp_' + 'b'.repeat(36);
  await put('fixture.bin', Buffer.concat([Buffer.from([0, 255, 254]), Buffer.from(token)]));
  git('add', '.');
  const result = scan('--staged');
  assert.equal(result.status, 1);
  assert(result.report.findings.some(x => x.rule === 'GitHub token'));
  assert(!JSON.stringify(result.report).includes(token));
});

test('rejects saved prompt fields in ordinary product documents', async t => {
  const { git, put, scan } = await fixture(t);
  const field = ['style', 'prompt', 'full'].join('_');
  await put('brand/guide.md', `${field}: >\n  Generate a product identity.\n`);
  git('add', '.');
  await put('brand/guide.md', '# Product identity\nUse the supplied logo.\n');
  const result = scan('--staged');
  assert.equal(result.status, 1);
  assert(result.report.findings.some(x => x.rule === 'saved prompt field'));
  assert.equal(scan().status, 0);
});

test('push hook blocks forbidden history even when the final tree is clean', async t => {
  const { git, put } = await fixture(t);
  await put('local/SKILL.md', 'local instructions');
  git('add', '.'); git('commit', '-qm', 'unwanted fixture');
  git('rm', 'local/SKILL.md');
  await put('tooling/check-git-content.mjs', await import('node:fs/promises').then(fs => fs.readFile(scanner)));
  await put('tooling/hooks/pre-push', await import('node:fs/promises').then(fs => fs.readFile(new URL('./hooks/pre-push', import.meta.url))));
  git('add', '.'); git('commit', '-qm', 'clean final tree');
  git('init', '--bare', '-q', 'remote.git');
  git('config', 'core.hooksPath', 'tooling/hooks');
  const cwd = git('rev-parse', '--show-toplevel');
  const result = spawnSync('git', ['push', './remote.git', 'HEAD:refs/heads/main'], { cwd, encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert((result.stdout + result.stderr).includes('local assistant tooling'), result.stdout + result.stderr);
  assert.equal(git('--git-dir=remote.git', 'for-each-ref'), '');
});
