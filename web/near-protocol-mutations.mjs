import {mkdtemp,mkdir,writeFile,cp,rm,realpath,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve,sep} from 'node:path';
const base=fileURLToPath(new URL('.',import.meta.url));
const cases=[
  ['signature',"assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signer, unhex(spend.signature), bytes(terms)), 'Transfer signature rejected');",'void signer;'],
  ['conflict',"assert(!consumed.has(input.id) || consumed.get(input.id) === id, 'Conflicting offline transfers were found.');",''],
  ['recipient',"assert(payload.path.at(-1).recipient === compressed(identity.profile.signingPublic), 'This payment is for another person.');",''],
  ['sender',"assert(isolatedNotes.get(payload.path.at(-1).input).owner === compressed(contact.signingPublic), 'The sender does not own this payment.');",''],
  ['conflict-descendants',' && !blocked.has(note.id)',''],
];
const results=[];
for(const[name,find,replacement]of cases){
  const temp=await mkdtemp(join(base,'.near-mutation-'));
  try{
    await mkdir(join(temp,'public'));
    await cp(join(base,'near-protocol.test.mjs'),join(temp,'near-protocol.test.mjs'));
    for(const file of['near-protocol.js','peer-crypto.js','profile-display.js'])await cp(join(base,'public',file),join(temp,'public',file));
    const target=join(temp,'public','near-protocol.js'),source=await readFile(target,'utf8');if(!source.includes(find))throw new Error('Mutation target missing: '+name);
    await writeFile(target,source.replace(find,replacement));
    const run=spawnSync(process.execPath,['--test','near-protocol.test.mjs'],{cwd:temp,encoding:'utf8',timeout:30000});
    const detected=run.status!==0&&/fail [1-9]/.test(run.stdout);results.push({guard:name,detected});console.log(`${detected?'DETECTED':'SURVIVED'} ${name}`);
  }finally{
    const real=await realpath(temp),expectedRoot=await realpath(base);
    if(!real.startsWith(expectedRoot+sep)||resolve(real)!==resolve(temp))throw new Error('Unexpected temporary directory; refusing cleanup');
    await rm(real,{recursive:true});
  }
}
await writeFile(join(base,'near-protocol-mutation-results.json'),JSON.stringify({detected:results.filter(r=>r.detected).length,total:results.length,results},null,2)+'\n');
if(results.some(r=>!r.detected))process.exitCode=1;
