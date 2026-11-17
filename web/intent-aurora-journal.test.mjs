import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,unlink,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openAuroraPrivateJournal} from './intent-aurora-sponsor-live.mjs';

async function fixture(t){
 const stateDir=await mkdtemp(join(tmpdir(),'lenz-private-journal-')),fileName='funding-state.json';let journal;
 t.after(async()=>{await journal?.close();await rm(stateDir,{recursive:true,force:true});});
 return {stateDir,fileName,file:join(stateDir,fileName),marker:join(stateDir,fileName+'.initialized'),directoryMarker:join(stateDir,'.initialized-journals.json'),async open(initial=()=>({version:1,grants:[]})){journal=await openAuroraPrivateJournal({stateDir,fileName,initial});return journal;}};
}

test('opening a new private journal persists its initial state and per-file marker before use',async t=>{
 const f=await fixture(t),journal=await f.open();assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{version:1,grants:[]});assert((await stat(f.marker)).isFile());assert.deepEqual(JSON.parse(await readFile(f.directoryMarker,'utf8')),{version:1,files:['funding-state.json']});assert.deepEqual(await journal.read(),{version:1,grants:[]});
});

test('a missing established journal rejects reads, writes and restart instead of resetting grants',async t=>{
 const f=await fixture(t),journal=await f.open();await journal.write({version:1,grants:[{id:'original'}]});await unlink(f.file);
 await assert.rejects(journal.read(),/established.*missing/);await assert.rejects(journal.write({version:1,grants:[]}),/established.*missing/);await journal.close();await assert.rejects(f.open(),/established.*missing/);await assert.rejects(stat(f.file),{code:'ENOENT'});
});

test('a missing or changed marker during use fails closed without rewriting the retained journal',async t=>{
 const f=await fixture(t),journal=await f.open(),raw=await readFile(f.file);await unlink(f.marker);
 await assert.rejects(journal.read(),/initialization marker is missing/);await assert.rejects(journal.write({grants:['replacement']}),/initialization marker is missing/);assert.deepEqual(await readFile(f.file),raw);
 await writeFile(f.marker,'another journal marker\n');await assert.rejects(journal.read(),/marker changed/);await assert.rejects(journal.write({grants:[]}),/marker changed/);assert.deepEqual(await readFile(f.file),raw);
});

test('losing an established per-file marker rejects restart and preserves the original grants',async t=>{
 const f=await fixture(t),journal=await f.open();await journal.write({version:1,grants:[{id:'original',amount:'1000000'}],pending:{id:'held-budget'}});const raw=await readFile(f.file);await unlink(f.marker);await journal.close();
 await assert.rejects(f.open(),/initialization marker.*missing/);assert.deepEqual(await readFile(f.file),raw);await assert.rejects(stat(f.marker),{code:'ENOENT'});
});

test('losing the directory initialization marker rejects current operations and restart without resetting budget',async t=>{
 const f=await fixture(t),journal=await f.open();await journal.write({version:1,grants:['retained'],pending:{reservedGas:'1200000000000000'}});const raw=await readFile(f.file);await unlink(f.directoryMarker);
 await assert.rejects(journal.read(),/initialization marker is missing/);await assert.rejects(journal.write({version:1,grants:[],pending:null}),/initialization marker is missing/);await journal.close();await assert.rejects(f.open(),/directory initialization marker is missing/);assert.deepEqual(await readFile(f.file),raw);await assert.rejects(stat(f.directoryMarker),{code:'ENOENT'});
});

test('an invalid, oversized or mismatched directory marker cannot replace retained history',async t=>{
 const f=await fixture(t),journal=await f.open(),raw=await readFile(f.file);await writeFile(f.directoryMarker,'{}');await assert.rejects(journal.read(),/directory initialization marker changed/);await assert.rejects(journal.write({}),/directory initialization marker changed/);
 await writeFile(f.directoryMarker,' '.repeat(2_000_001));await assert.rejects(journal.read(),/directory initialization marker is invalid/);await journal.close();await assert.rejects(f.open(),/directory initialization marker is invalid/);
 await writeFile(f.directoryMarker,JSON.stringify({version:1,files:['swap-state.json']}));await assert.rejects(f.open(),/directory initialization marker is missing or changed/);assert.deepEqual(await readFile(f.file),raw);
});

test('an untouched valid legacy journal is adopted under lock without changing its bytes',async t=>{
 const f=await fixture(t),raw=' { "version": 1, "grants": [ { "id": "retained" } ] }\r\n';await writeFile(f.file,raw);
 const journal=await f.open(()=>{throw Error('A legacy journal must never initialize again.');});assert.equal(await readFile(f.file,'utf8'),raw);assert.deepEqual(await journal.read(),{version:1,grants:[{id:'retained'}]});assert((await stat(f.marker)).isFile());await journal.close();const reopened=await f.open();assert.deepEqual(await reopened.read(),{version:1,grants:[{id:'retained'}]});assert.equal(await readFile(f.file,'utf8'),raw);
});

test('adopting a second legacy journal retains the directory registrations and original journal bytes',async t=>{
 const f=await fixture(t),journal=await f.open(),first=await readFile(f.file);await journal.close();const second=join(f.stateDir,'swap-state.json'),raw=' {"version":1,"pending":{"id":"original-swap"}} \n';await writeFile(second,raw);
 const swap=await openAuroraPrivateJournal({stateDir:f.stateDir,fileName:'swap-state.json',initial:()=>{throw Error('Do not replace original swaps.');}});t.after(()=>swap.close());assert.deepEqual(await swap.read(),{version:1,pending:{id:'original-swap'}});assert.equal(await readFile(second,'utf8'),raw);assert.deepEqual(await readFile(f.file),first);assert.deepEqual(JSON.parse(await readFile(f.directoryMarker,'utf8')),{version:1,files:['funding-state.json','swap-state.json']});await swap.close();const reopened=await f.open();assert.deepEqual(await reopened.read(),{version:1,grants:[]});
});

test('malformed and oversized legacy journals reject adoption and release the process lock',async t=>{
 const f=await fixture(t);await writeFile(f.file,'{');await assert.rejects(f.open(),SyntaxError);await assert.rejects(stat(f.marker),{code:'ENOENT'});await assert.rejects(f.open(),SyntaxError);
 await writeFile(f.file,'x'.repeat(2_000_001));await assert.rejects(f.open(),/retained private journal is invalid/);await assert.rejects(stat(f.marker),{code:'ENOENT'});assert.equal((await stat(f.file)).size,2_000_001);
});

test('writes count UTF-8 bytes including the newline and retain valid state on size failure',async t=>{
 const f=await fixture(t),journal=await f.open(),raw=await readFile(f.file);await assert.rejects(journal.write({text:'💚'.repeat(500_001)}),/too large/);assert.deepEqual(await readFile(f.file),raw);assert.deepEqual(await journal.read(),{version:1,grants:[]});
});

test('the directory lock admits one process opener and closed journals cannot mutate state',async t=>{
 const f=await fixture(t),journal=await f.open();await assert.rejects(openAuroraPrivateJournal({stateDir:f.stateDir,fileName:'swap-state.json',initial:()=>({})}),{code:'EEXIST'});await journal.close();await assert.rejects(journal.read(),/journal is closed/);await assert.rejects(journal.write({}),/journal is closed/);const reopened=await f.open();assert.deepEqual(await reopened.read(),{version:1,grants:[]});
});

test('a journal directory or retained file resolving inside the repository is rejected',async t=>{
 const f=await fixture(t),repository=fileURLToPath(new URL('../',import.meta.url)),inside=fileURLToPath(new URL('./public/near-config.json',import.meta.url));await symlink(repository,join(f.stateDir,'repo'),'junction');
 await assert.rejects(openAuroraPrivateJournal({stateDir:join(f.stateDir,'repo'),fileName:f.fileName,initial:()=>({})}),/directory entered the product repository/);
 await symlink(inside,f.file,'file');await assert.rejects(f.open(),/retained private journal is invalid/);await assert.rejects(stat(f.marker),{code:'ENOENT'});
});
