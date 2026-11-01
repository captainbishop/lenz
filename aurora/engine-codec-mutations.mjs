import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const source=await readFile(new URL('./engine-codec.mjs',import.meta.url),'utf8');
const tests=await readFile(new URL('./engine-codec.test.mjs',import.meta.url),'utf8');
const variants=[['revert-is-not-success','succeeded:tag===0','succeeded:tag<=1'],['result-version',"assert(reader.byte()===7,'Unsupported Engine SubmitResult version.');",'reader.byte();'],['trailing-bytes',"assert(this.offset===this.bytes.length,'Trailing Engine response bytes.');",''],['vector-bound',"assert(n<=max,'Engine vector limit exceeded.');",'']];
const results=[];
await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
for(const [name,from,to]of variants){
  const directory=await mkdtemp(new URL('./.testnet/codec-',import.meta.url));
  try{
    assert(source.includes(from));await writeFile(join(directory,'engine-codec.mjs'),source.replace(from,to));await writeFile(join(directory,'engine-codec.test.mjs'),tests);
    const result=spawnSync(process.execPath,['--test','engine-codec.test.mjs'],{cwd:directory,windowsHide:true,encoding:'utf8',timeout:20000});
    assert.equal(result.error,undefined);assert.equal(result.status,1,`${name} survived`);assert.match(result.stdout,/fail [1-9]/);
    results.push({name,detected:true});console.log('PASS removed guard detected: '+name);
  }finally{assert.equal(dirname(directory),fileURLToPath(new URL('./.testnet',import.meta.url)));await rm(directory,{recursive:true,force:true});}
}
await writeFile(new URL('./engine-codec-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
