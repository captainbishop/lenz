import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLendingSupplyNotes,mergeLendingSupplyNotes,lendingSupplyNoteDeployment} from './public/intent-lending-notes.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';

const address=d=>'0x'+d.repeat(40),hash=d=>'0x'+d.repeat(64);
const deployment={...LENDING_TESTNET,lendingFactory:address('1'),privacyPool:address('2'),supplyFactory:address('3'),verifier:address('4'),hasher:address('5'),codeHashes:Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'].map(key=>[key,hash('9')]))};
const snapshot={owner:'a'.repeat(64),ownerAddress:address('8'),account:address('6'),route:{chainId:deployment.chain,factory:deployment.lendingFactory,...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key=>[[key,deployment[key]],[key+'CodeHash',deployment.codeHashes[key]]]))}};
const note={version:1,nullifier:'1',secret:'2',commitment:hash('1'),nullifierHash:hash('2')};
test('original private notes remain bound to one lending route and merge without losing authority',()=>{
 const saved=checkLendingSupplyNotes({type:'lenz/lending-supply-notes/v1',deployment:lendingSupplyNoteDeployment(deployment),records:[{note,createdAt:1000000,spendAuthority:null}]},snapshot);
 assert.deepEqual(mergeLendingSupplyNotes(saved,saved,snapshot),saved);
 assert.throws(()=>mergeLendingSupplyNotes(saved,{...saved,records:[{...saved.records[0],note:{...note,secret:'3'}}]},snapshot),/conflict/);
 assert.throws(()=>checkLendingSupplyNotes({...saved,records:[...saved.records,...saved.records]},snapshot),/conflict/);
 assert.throws(()=>checkLendingSupplyNotes({...saved,deployment:{...saved.deployment,lendingFactory:address('9')}},snapshot),/route/);
});
