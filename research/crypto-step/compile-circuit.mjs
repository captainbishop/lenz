import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// O0 fits the measured PLONK setup. Keep all artifacts from one compiler run.
export function compileCircuit(source, output, sanity) {
  mkdirSync(output, { recursive: true });
  // On this Windows/WASI combination, runs targeting an existing circuit
  // output directory stalled. Fresh directories completed; promote afterward.
  const staging = mkdtempSync(join(output, '.compile-'));
  const flags = sanity === undefined ? [] : ['--sanity_check', String(sanity)];
  const run = spawnSync(process.execPath, ['compile.mjs', source, '--r1cs', '--sym', '--wasm', '--O0', ...flags, '-o', staging], { stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error('Circuit compilation failed');
  const stem = basename(source, '.circom');
  mkdirSync(join(output, `${stem}_js`), { recursive: true });
  const wasmPath = join(output, `${stem}_js`, `${stem}.wasm`);
  const generatedWasm = join(staging, `${stem}_js`, `${stem}.wasm`);
  const buffer = readFileSync(generatedWasm);
  if (!WebAssembly.validate(buffer)) throw new Error('Invalid compiled WebAssembly');
  writeFileSync(wasmPath, buffer);
  for (const extension of ['r1cs', 'sym']) {
    const generated = join(staging, `${stem}.${extension}`);
    copyFileSync(generated, join(output, `${stem}.${extension}`));
    unlinkSync(generated);
  }
  for (const file of [`${stem}.wasm`, 'witness_calculator.js', 'generate_witness.js']) unlinkSync(join(staging, `${stem}_js`, file));
  rmdirSync(join(staging, `${stem}_js`));
  rmdirSync(staging);
  return { wasm: wasmPath, r1cs: join(output, `${stem}.r1cs`) };
}
