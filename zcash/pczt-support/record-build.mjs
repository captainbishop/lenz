import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const path = s => fileURLToPath(new URL(s, root));
const sha = async s => createHash('sha256').update(await readFile(path(s))).digest('hex');
const lock = JSON.parse(await readFile(path('zcash/source-lock.json')));
assert.equal(await sha('tooling/zcash-devtool/target/release/zcash-devtool.exe'), lock.windowsExeSha256);
assert.equal(await sha('tooling/zcash-devtool/Cargo.lock'), lock.cargoLockSha256);
const git = args => {
  const child = spawnSync('git', ['-C', path('tooling/zcash-devtool'), ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
};
assert.equal(git(['rev-parse', 'HEAD']).trim(), lock.revision);
const patch = git(['diff', '--', 'Cargo.toml', 'src/commands/pczt/sign.rs', 'src/commands/pczt/create.rs']);
assert(patch.includes('sign_ironwood') && patch.includes('bounded_expiry'), 'Record both the native signature and bounded unsigned preparation changes');
await writeFile(path('zcash/pczt-support/ironwood-test-signer.patch'), patch);
const result = {
  checkedAt: new Date().toISOString(), sourceRevision: lock.revision,
  librustzcashRevision: lock.librustzcashRevision, cargoLockSha256: lock.cargoLockSha256,
  originalWindowsExeSha256: lock.windowsExeSha256,
  windowsExeSha256: await sha('tooling/zcash-devtool/target/release/lenz-zcash-pczt.exe'),
  patchSha256: await sha('zcash/pczt-support/ironwood-test-signer.patch'),
  signerSourceSha256: await sha('tooling/zcash-devtool/src/commands/pczt/sign.rs'),
  expiryWindowVersion: 1,
  createSourceSha256: await sha('tooling/zcash-devtool/src/commands/pczt/create.rs'),
  manifestSha256: await sha('tooling/zcash-devtool/Cargo.toml'),
  rust: lock.rust,
  command: 'cargo +1.99.1 build --manifest-path tooling/zcash-devtool/Cargo.toml --bin lenz-zcash-pczt --release --locked --offline',
  scope: 'Experimental bounded testnet PCZT signer and explicit 40 through 120 block expiry for new unsigned preparations. Original bridge executable unchanged. No production safety claim.',
};
await writeFile(path('zcash/pczt-support/build.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
