import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source=await readFile(new URL('./name-resolution.mjs',import.meta.url),'utf8'),tests=await readFile(new URL('./name-resolution.test.mjs',import.meta.url),'utf8'),codec=await readFile(new URL('./engine-codec.mjs',import.meta.url),'utf8');
const variants=[
  ['ethereum-authority',"assert(await rpc(endpoint,'eth_chainId',[])==='0x1','ENS must resolve from Ethereum mainnet');","await rpc(endpoint,'eth_chainId',[]);"],
  ['aurora-record',"(BigInt(chainId)|0x80000000n).toString()","'60'"],
  ['near-suffix',"assert(name.endsWith(network==='mainnet'?'.near':'.testnet'),'Account suffix does not match the selected network');",''],
  ['near-block',"account.block_hash===header.hash && account.block_height===header.height","true"],
  ['canonical-abi',"assert(universal.encodeFunctionResult('resolve',decoded).toLowerCase()===encoded.toLowerCase(),'Noncanonical ENS result');",''],
  ['rpc-identity','reply.id===1','true'],
];
const run=cwd=>spawnSync(process.execPath,['--test','name-resolution.test.mjs'],{cwd,windowsHide:true,encoding:'utf8',timeout:20000});
const baseline=run(fileURLToPath(new URL('.',import.meta.url)));assert.equal(baseline.error,undefined);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
const results=[];await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
for(const [name,from,to]of variants){
  assert.equal(source.split(from).length,2);const directory=await mkdtemp(new URL('./.testnet/names-',import.meta.url));
  try{await writeFile(join(directory,'name-resolution.mjs'),source.replace(from,to));await writeFile(join(directory,'name-resolution.test.mjs'),tests);await writeFile(join(directory,'engine-codec.mjs'),codec);
    const r=run(directory);assert.equal(r.error,undefined);assert.equal(r.status,1,name+' survived');assert.match(r.stdout,/ERR_ASSERTION/);assert.doesNotMatch(r.stdout+r.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);results.push({name,detected:true});console.log('PASS removed guard detected: '+name);
  }finally{assert.equal(dirname(directory),fileURLToPath(new URL('./.testnet',import.meta.url)));await rm(directory,{recursive:true,force:true});}
}
const sha=value=>createHash('sha256').update(value).digest('hex');
await writeFile(new URL('./name-resolution-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),sourceSha256:sha(source),testSha256:sha(tests),scope:'Synthetic naming responses; no live ownership or financial execution.',results},null,2)+'\n');
