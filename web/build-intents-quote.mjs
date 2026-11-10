import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url),{build}=require('./near-connector/node_modules/esbuild');
const directory=resolve(import.meta.dirname,'../integrations/quote-verifier');
const sdk=resolve(directory,'node_modules/@defuse-protocol/one-click-sdk-typescript');
const pkg=JSON.parse(await readFile(resolve(sdk,'package.json'),'utf8'));
if(pkg.version!=='0.1.26')throw Error('Review the quote verifier before changing its version.');
// Isolate the SDK's verifier without its HTTP client and browser FormData shim.
const source=await readFile(resolve(sdk,'dist/index.mjs'),'utf8'),start=source.indexOf('// src/quote-signature.ts'),end=source.indexOf('\nexport {',start);
if(start<0||end<0)throw Error('The pinned SDK quote verifier layout changed.');
const result=await build({stdin:{contents:source.slice(start,end)+'\nexport {verifyQuoteSignature};',resolveDir:directory},bundle:true,format:'esm',platform:'browser',target:'es2022',define:{self:'globalThis'},minify:true,legalComments:'eof',metafile:true,write:false});
const licenses=new Map();
licenses.set(pkg.name,{version:pkg.version,license:await readFile(resolve(sdk,'LICENSE'),'utf8')});
for(const input of Object.keys(result.metafile.inputs)){
 if(!input.includes('node_modules'))continue;
 let folder=dirname(resolve(input));
 for(;;){
  try{const pkg=JSON.parse(await readFile(resolve(folder,'package.json'),'utf8'));if(pkg.name){
   let license;for(const name of ['LICENSE','LICENSE.txt','LICENSE.md','UNLICENSE'])try{license=await readFile(resolve(folder,name),'utf8');break;}catch{}
   if(!license&&pkg.license==='Public Domain')license=`${pkg.name} is Public Domain according to its package.json. Author: ${pkg.author?.name??pkg.author??'unspecified'}.`;
   if(!license)throw Error('Missing license for '+pkg.name);
   licenses.set(pkg.name,{version:pkg.version,license});break;
  }}catch(error){if(error.message.startsWith('Missing license'))throw error;}
  const parent=dirname(folder);if(parent===folder)throw Error('Missing package for '+input);folder=parent;
 }
}
await writeFile(resolve(import.meta.dirname,'public/intents-vendor/quote.js'),result.outputFiles[0].contents);
await writeFile(resolve(import.meta.dirname,'public/intents-vendor/quote-LICENSES.txt'),[...licenses].map(([name,p])=>`${name} ${p.version}\n${p.license}`).join('\n\n'));
console.log('Built offline quote verifier: '+result.outputFiles[0].contents.length+' bytes; '+licenses.size+' dependency notices.');
