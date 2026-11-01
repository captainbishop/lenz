import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const files=['carrier/network.test.mjs','carrier/server.mjs','carrier/store.mjs','web/public/carrier-protocol.js','web/public/peer-crypto.js','web/public/profile-display.js'];
const mutants=[
  ['packet-signature','web/public/carrier-protocol.js',"  assert(await verifyValue(e.sender.signingPublic, [p.type,p.id,p.from,p.to,p.iv,p.ciphertext], p.signature), 'Packet signature rejected.');"],
  ['mailbox-authentication','web/public/carrier-protocol.js',"  assert(await verifyValue(q.recipient.signingPublic, inboxTerms(q), q.signature), 'Mailbox signature rejected.');"],
  ['storage-capacity','carrier/store.mjs',"      if(total.n>=l.maxMessages || total.bytes+size>l.maxBytes || sender>=l.perSender || recipient>=l.perRecipient)throw Error('Carrier storage quota reached.');"],
];
const results=[];
for(const [name,file,guard]of mutants){
  const directory=await mkdtemp(join(tmpdir(),'lenz-carrier-mutation-'));
  try{
    for(const file of files){await mkdir(dirname(join(directory,file)),{recursive:true});await copyFile(file,join(directory,file));}
    const source=await readFile(join(directory,file),'utf8');assert(source.includes(guard),'Mutation guard missing');await writeFile(join(directory,file),source.replace(guard,''));
    const run=spawnSync(process.execPath,['--test','carrier/network.test.mjs'],{cwd:directory,windowsHide:true,timeout:25000,encoding:'utf8'});
    assert.equal(run.error,undefined);assert.equal(run.status,1,`${name} survived`);assert.match(run.stdout,/fail [1-9]/);
    results.push({name,detected:true});console.log('PASS removed guard detected: '+name);
  }finally{assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
}
await writeFile('carrier/mutation-results.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
