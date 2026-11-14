import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const require=createRequire(import.meta.url),{build,version}=require('./near-connector/node_modules/esbuild'),root=resolve(import.meta.dirname,'..');
const result=await build({stdin:{contents:"export { Transaction } from 'ethers/transaction';",resolveDir:resolve(root,'aurora'),sourcefile:'aurora-account-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false});
const inputs={};for(const input of Object.keys(result.metafile.inputs).filter(path=>!path.replaceAll('\\','/').endsWith('aurora-account-entry.js'))){const name=relative(root,resolve(input)).replaceAll('\\','/');inputs[name]=createHash('sha256').update(await readFile(input)).digest('hex');}
await writeFile(resolve(root,'web/public/evm-vendor/aurora-transaction.js'),result.outputFiles[0].contents);
await writeFile(resolve(root,'web/public/evm-vendor/AURORA-ACCOUNT-NOTICE.txt'),'Transaction encoding and decoding from the pinned ethers 6.17.0 stack (MIT). No provider, wallet or mnemonic is exported. Signing uses the existing adjacent offline-budget.js SigningKey export. See ethers-LICENSE.txt, noble-hashes-LICENSE.txt and noble-curves-LICENSE.txt.\n');
await writeFile(resolve(root,'web/aurora-account-build.json'),JSON.stringify({esbuild:version,inputs,sha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex')},null,2)+'\n');
console.log('Built Aurora transaction codec: '+result.outputFiles[0].contents.length+' bytes.');
