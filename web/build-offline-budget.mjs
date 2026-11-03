// Small browser-only EIP-712/signature bundle from the existing pinned EVM stack.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const require=createRequire(import.meta.url),{build,version}=require('./near-connector/node_modules/esbuild');
const root=resolve(import.meta.dirname,'..'),out=resolve(import.meta.dirname,'public/evm-vendor');await mkdir(out,{recursive:true});
const result=await build({stdin:{contents:"export { SigningKey, computeAddress, recoverAddress, TypedDataEncoder, keccak256 } from 'ethers';",resolveDir:resolve(root,'aurora'),sourcefile:'offline-budget-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false});
const inputs={};for(const input of Object.keys(result.metafile.inputs).filter(p=>!p.replaceAll('\\','/').endsWith('offline-budget-entry.js'))){const name=relative(root,resolve(input)).replaceAll('\\','/');inputs[name]=createHash('sha256').update(await readFile(input)).digest('hex');}
await writeFile(resolve(out,'offline-budget.js'),result.outputFiles[0].contents);
const curves='aurora/node_modules/ethers/node_modules/@noble/curves';
await writeFile(resolve(out,'noble-curves-LICENSE.txt'),await readFile(resolve(root,curves,'LICENSE')));
await writeFile(resolve(out,'OFFLINE-BUDGET-NOTICE.txt'),'EIP-712 hashing and secp256k1 signatures from ethers 6.17.0 (MIT), including @noble/curves and @noble/hashes (MIT). See adjacent licenses and web/offline-budget-build.json for pinned source hashes. This bundle has no provider or network connection.\n');
await writeFile(resolve(root,'web/offline-budget-build.json'),JSON.stringify({esbuild:version,inputs,sha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex')},null,2)+'\n');
console.log('Built offline budget signatures: '+result.outputFiles[0].contents.length+' bytes.');
