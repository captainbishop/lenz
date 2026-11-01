import { mkdir, writeFile } from 'node:fs/promises';
import { compileContract } from '../compiler.mjs';

// Always compile from source with the pinned local compiler; no download or cache.
const directory = new URL('../artifacts/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [file, contract] of [['ToolchainProbe.sol', 'ToolchainProbe'], ['PaymentStepVerifier.sol', 'PlonkVerifier']]) {
  const result = await compileContract(file, contract);
  await writeFile(new URL(`${contract}.json`, directory), JSON.stringify(result, null, 2) + '\n');
  console.log(`Compiled ${contract} for paris.`);
}
