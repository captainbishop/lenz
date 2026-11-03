// Build only address/checksum validation from the existing pinned Ethereum stack.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const require=createRequire(import.meta.url),{build,version}=require('./near-connector/node_modules/esbuild');
const root=resolve(import.meta.dirname,'..'),out=resolve(import.meta.dirname,'public/evm-vendor');
await mkdir(out,{recursive:true});
const result=await build({stdin:{contents:"export { getAddress } from 'ethers/address';",resolveDir:resolve(root,'aurora'),sourcefile:'address-entry.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false});
const inputs={};for(const input of Object.keys(result.metafile.inputs).filter(p=>!p.replaceAll('\\','/').endsWith('address-entry.js'))){const name=relative(root,resolve(input)).replaceAll('\\','/');inputs[name]=createHash('sha256').update(await readFile(input)).digest('hex');}
await writeFile(resolve(out,'address.js'),result.outputFiles[0].contents);
for(const [source,target]of [['ethers/LICENSE.md','ethers-LICENSE.txt'],['ethers/node_modules/@noble/hashes/LICENSE','noble-hashes-LICENSE.txt']])await writeFile(resolve(out,target),await readFile(resolve(root,'aurora/node_modules',source)));
await writeFile(resolve(out,'NOTICE.txt'),'Address/checksum validation from ethers 6.17.0 (MIT), including @noble/hashes 1.3.2 (MIT). See the adjacent license files. No signing, provider, wallet or mnemonic code is exported.\n');
await writeFile(resolve(root,'web/evm-address-build.json'),JSON.stringify({esbuild:version,inputs,sha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex')},null,2)+'\n');
console.log('Built address validation: '+result.outputFiles[0].contents.length+' bytes.');
