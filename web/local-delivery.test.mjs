import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalDelivery } from './local-delivery.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lenz-local-delivery-'));
  const publicRoot = path.join(directory, 'public');
  await mkdir(publicRoot);
  await writeFile(path.join(publicRoot, 'index.html'), '<h1>Lenz local app</h1>');
  await writeFile(path.join(publicRoot, 'app.js'), 'export const local = true;');
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith('lenz-local-delivery-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, publicRoot };
}

async function request(origin, route, { method = 'GET', host = new URL(origin).host, ca, servername } = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request({ hostname: '127.0.0.1', port: url.port, path: route, method, ca, servername, headers: { Host: host } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the selected public app without changing bytes after startup', async t => {
  const { publicRoot } = await fixture(t);
  const delivery = await createLocalDelivery({ publicRoot, origin: 'http://127.0.0.1:0' });
  t.after(() => delivery.close());
  await delivery.listen();
  await writeFile(path.join(publicRoot, 'index.html'), '<h1>Changed after startup</h1>');
  await writeFile(path.join(publicRoot, 'later.json'), '{"unexpected":true}');
  const response = await fetch(delivery.origin);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>Lenz local app</h1>');
  assert.equal((await fetch(delivery.origin + '/later.json')).status, 404);
  assert.equal(delivery.manifest.find(row => row.path === '/index.html').bytes, 23);
});

test('restricts delivery to its exact origin, public paths and read-only requests', async t => {
  const { directory, publicRoot } = await fixture(t);
  await writeFile(path.join(directory, 'operator-secret.txt'), 'not-public');
  await writeFile(path.join(publicRoot, '.private.json'), '{"secret":true}');
  const delivery = await createLocalDelivery({ publicRoot, origin: 'http://127.0.0.1:0' });
  t.after(() => delivery.close());
  await delivery.listen();
  assert.equal((await request(delivery.origin, '/', { host: 'unrelated.example' })).status, 403);
  for (const route of ['/../operator-secret.txt', '/%2e%2e/operator-secret.txt', '/%00', '/%5cindex.html', '//unrelated.example/index.html', 'http://unrelated.example/index.html']) {
    assert.equal((await request(delivery.origin, route)).status, 400, route);
  }
  assert.equal((await request(delivery.origin, '/.private.json')).status, 404);
  const post = await request(delivery.origin, '/index.html', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  const api = await request(delivery.origin, '/api/defi/rhea/execute');
  assert.equal(api.status, 503);
  assert.deepEqual(JSON.parse(api.body), { error: 'Local delivery serves app files only. Connected services are unavailable here.' });
  const head = await request(delivery.origin, '/app.js?revision=1', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /^text\/javascript/);
  assert.equal(head.headers['x-content-type-options'], 'nosniff');
  assert.match(head.headers['content-security-policy'], /connect-src 'self'(?:;|$)/);
  assert(!head.headers['content-security-policy'].includes('chaindefuser'));
});

test('requires HTTPS for local-network delivery and rejects malformed origins', async t => {
  const { publicRoot } = await fixture(t);
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'http://lenz.example:8443' }), /HTTPS is required/);
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'http://localhost:8443', bindAddress: '0.0.0.0' }), /HTTPS is required/);
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'https://lenz.example:8443' }), /certificate and private key/);
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'http://localhost:8443/private' }), /without credentials, a path or query/);
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'ftp://localhost:8443' }), /HTTP or HTTPS/);
});

test('rejects linked public directories instead of serving files beyond the package', async t => {
  const { directory, publicRoot } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.json'), '{"secret":true}');
  await symlink(outside, path.join(publicRoot, 'linked'), 'junction');
  await assert.rejects(createLocalDelivery({ publicRoot, origin: 'http://127.0.0.1:0' }), /contains a link/);
});

test('serves HTTPS with matching supplied TLS files and rejects mismatched or public keys', async t => {
  const { directory, publicRoot } = await fixture(t);
  const certificateFile = path.join(directory, 'test-cert.pem'), privateKeyFile = path.join(directory, 'test-key.pem');
  const openssl = process.env.LENZ_TEST_OPENSSL || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  await promisify(execFile)(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKeyFile, '-out', certificateFile, '-days', '1', '-subj', '/CN=local-delivery-test', '-addext', 'subjectAltName=DNS:lenz.test'], { windowsHide: true });
  const options = { publicRoot, origin: 'https://lenz.test:0', certificateFile, privateKeyFile };
  const delivery = await createLocalDelivery(options);
  t.after(() => delivery.close());
  await delivery.listen();
  // The generated certificate is trusted only by this isolated Node test client.
  const response = await request(delivery.origin, '/', { ca: await readFile(certificateFile), servername: 'lenz.test' });
  assert.equal(response.status, 200);
  assert.equal(response.body, '<h1>Lenz local app</h1>');
  await assert.rejects(createLocalDelivery({ ...options, origin: 'https://different.test:0' }), /does not cover/);
  const badKey = path.join(directory, 'different-key.pem');
  await writeFile(badKey, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(createLocalDelivery({ ...options, privateKeyFile: badKey }), /does not match/);
  const publicCertificate = path.join(publicRoot, 'certificate.pem');
  await copyFile(certificateFile, publicCertificate);
  await assert.rejects(createLocalDelivery({ ...options, certificateFile: publicCertificate }), /outside the public directory/);
});
