import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openNearIntentRelay,reconcileNearIntentTransaction} from '../../web/intent-near-relay.mjs';

const repo=fileURLToPath(new URL('../..',import.meta.url));
const child=resolve(repo,'..private'),outside=resolve(repo,'../lenz-private-test-input');
test('relay refuses repository children named like parent traversal before reading or writing secrets',async()=>{
 await assert.rejects(openNearIntentRelay({stateDir:child,deployerKeyFile:outside,deploymentStateFile:outside}),/outside/);
 await assert.rejects(reconcileNearIntentTransaction({stateDir:child}),/outside/);
});
test('relay refuses private key and deployment inputs inside the repository',async()=>{
 for(const files of [{deployerKeyFile:child,deploymentStateFile:outside},{deployerKeyFile:outside,deploymentStateFile:child}])await assert.rejects(openNearIntentRelay({stateDir:outside,...files}),/outside/);
});
test('faucet and deployment commands reject private repository children without creating files or sending requests',()=>{
 const commands=[
  ['faucet.mjs','--status','--state-dir',child],
  ['fund.mjs','--plan','--source-dir',child,'--target-dir',outside,'--state-dir',outside],
  ['rehearsal.mjs','--plan','--wasm',outside,'--token-wasm',outside,'--deployer-key',outside,'--state-dir',child,'--prefix','guard'],
  ['rehearsal.mjs','--plan','--wasm',outside,'--token-wasm',outside,'--deployer-key',child,'--state-dir',outside,'--prefix','guard']
 ];
 for(const [file,...args] of commands){const result=spawnSync(process.execPath,[resolve(repo,'contracts/intents-testnet',file),...args],{encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);assert.match(result.stderr,/outside/);}
});
