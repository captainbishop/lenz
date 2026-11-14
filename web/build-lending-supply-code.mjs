import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileSource } from '../aurora/compiler.mjs';
const source = await readFile(new URL('../aurora/contracts/PrivateSupply.sol', import.meta.url), 'utf8');
if (createHash('sha256').update(source).digest('hex') !== '740c776225b21e9f6b56d91a84ba8b3225aca2300cccab8b1f01278b55081d83') throw Error('The reviewed private Supply source changed.');
const compiled = compileSource('PrivateSupply.sol', source, 'PrivateSupplyVault');
await writeFile(new URL('./public/intent-lending-supply-code.js', import.meta.url), '// Built from the reviewed PrivateSupply.sol with aurora/compiler.mjs.\nexport const PRIVATE_SUPPLY_VAULT_CREATION_CODE=' + JSON.stringify('0x' + compiled.evm.bytecode.object) + ';\n');
