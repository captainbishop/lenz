// Offline-only recovery primitives from the existing pinned EVM dependencies.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const require=createRequire(import.meta.url),{build,version}=require('./near-connector/node_modules/esbuild');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'web/public/evm-vendor');
await mkdir(out,{recursive:true});
const result=await build({stdin:{contents:"export { Mnemonic } from 'ethers'; export { p256 } from './node_modules/ethers/node_modules/@noble/curves/esm/p256.js';",resolveDir:resolve(root,'aurora'),sourcefile:'identity-recovery-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false});
const inputs={};
for(const input of Object.keys(result.metafile.inputs).filter(p=>!p.replaceAll('\\','/').endsWith('identity-recovery-entry.js'))){inputs[relative(root,resolve(input)).replaceAll('\\','/')]=createHash('sha256').update(await readFile(input)).digest('hex');}
await writeFile(resolve(out,'identity-recovery.js'),result.outputFiles[0].contents);
await writeFile(resolve(out,'IDENTITY-RECOVERY-NOTICE.txt'),'BIP-39 English encoding from ethers 6.17.0 and P-256 from @noble/curves 1.2.0; MIT licensed with @noble/hashes 1.3.2. See adjacent licenses and web/identity-recovery-build.json for source hashes. No wallet provider or network connection.\n');
await writeFile(resolve(root,'web/identity-recovery-build.json'),JSON.stringify({esbuild:version,inputs,sha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex')},null,2)+'\n');
console.log('Built recovery primitives: '+result.outputFiles[0].contents.length+' bytes.');
