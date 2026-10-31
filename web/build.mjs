import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { context, DOMAIN, closeCurve } from '../research/crypto-step/step.mjs';
import { externalizeProofWorker } from './build-proof-worker.mjs';
const base = '../research/crypto-step/';
mkdirSync('public/vendor', { recursive: true });
mkdirSync('public/assets', { recursive: true });
const metadata = JSON.parse(readFileSync(base + 'build/build-metadata.json', 'utf8'));
for (const [file, hash] of Object.entries(metadata.hashes)) {
  if (createHash('sha256').update(readFileSync(base + file)).digest('hex') !== hash) throw new Error(`Stale proof artifact: ${file}`);
}
const modules = [
  ['node_modules/ffjavascript/build/browser.esm.js', 'ffjavascript.js'],
  ['node_modules/snarkjs/build/browser.esm.js', 'snarkjs.js'],
  ['node_modules/circomlibjs/src/poseidon_wasm.js', 'poseidon.js'],
  ['node_modules/circomlibjs/src/poseidon_constants_opt.js', 'poseidon_constants_opt.js'],
];
for (const [source, target] of modules) writeFileSync(`public/vendor/${target}`, readFileSync(base + source, 'utf8').replaceAll('from "ffjavascript"', 'from "./ffjavascript.js"').replaceAll("from 'ffjavascript'", "from './ffjavascript.js'"));
const proofWorker = externalizeProofWorker(readFileSync('public/vendor/ffjavascript.js', 'utf8'));
writeFileSync('public/vendor/ffjavascript.js', proofWorker.source);
writeFileSync('public/vendor/ffjavascript-worker.js', proofWorker.worker);
for (const [source, target] of [['build/step_js/step.wasm', 'step.wasm'], ['build/step.zkey', 'step.zkey']]) copyFileSync(base + source, 'public/assets/' + target);
copyFileSync('../research/mobile-handover/crypto-web.mjs', 'public/capsule.js');
const config = { domain: DOMAIN, context: context().toString(), verificationKey: JSON.parse(readFileSync(base + 'build/verification-key.json', 'utf8')), circuitHash: metadata.hashes['step.circom'] };
writeFileSync('public/config.js', `export default ${JSON.stringify(config)};\n`);
for (const dependency of ['snarkjs', 'circomlibjs', 'ffjavascript']) {
  for (const name of ['COPYING', 'LICENSE', 'LICENSE.txt']) {
    try { copyFileSync(base + `node_modules/${dependency}/${name}`, `public/vendor/${dependency}-LICENSE.txt`); break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
await closeCurve();
console.log('Browser assets prepared from the verified local TEST-ONLY circuit.');
