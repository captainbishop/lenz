import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateZcashPath,openConfiguredNativeZcash} from './intent-zcash-native.mjs';
test('native custody paths inside the repository are refused before opening tools',async()=>{
 await assert.rejects(()=>privateZcashPath(fileURLToPath(new URL('../zcash/',import.meta.url))));
 await assert.rejects(()=>openConfiguredNativeZcash({configuration:{version:1,network:'testnet',custody:'local-native',walletRoot:process.cwd()}}));
 const directory=await mkdtemp(join(tmpdir(),'lenz-native-path-'));try{await mkdir(join(directory,'a'));assert.equal(await privateZcashPath(directory),directory);}finally{await rm(directory,{recursive:true,force:true});}
});
