import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileSource} from '../aurora/compiler.mjs';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './public/intent-aurora-config.js';
const source=await readFile(new URL('../aurora/contracts/PrivateIntent.sol',import.meta.url),'utf8');
if(createHash('sha256').update(source).digest('hex')!==deployment.sourceSha256)throw Error('The deployed private intent source changed.');
const compiled=compileSource('PrivateIntent.sol',source,'PrivateIntentVault');
await writeFile(new URL('./public/intent-aurora-vault-code.js',import.meta.url),'// Built from the pinned PrivateIntent.sol with aurora/compiler.mjs.\nexport const AURORA_VAULT_CREATION_CODE='+JSON.stringify('0x'+compiled.evm.bytecode.object)+';\n');
