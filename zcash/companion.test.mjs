import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companionSnapshot, readNativeWallet } from './companion.mjs';
const address = JSON.parse(await readFile(new URL('./address-a-results.json', import.meta.url))).orchardAddress;
const balance = {total:123456789,ironwood_spendable:100000000,orchard_spendable:0,sapling_spendable:10000000,transparent_spendable:1,chain_tip_height:4542631};
function fixture(change = () => {}) {
  const calls = [];
  const run = async (action,wallet) => {
    calls.push([action,wallet]); const r = {action,wallet,network:'test',ok:true,balance:{...balance},info:{chain_name:'test',chain_tip_height:4542640},orchardAddress:address,privateMetadata:'must not escape'};
    change(r); return r;
  };
  return {run,calls};
}
test('local snapshot reads native balance/address without sync; exact integer amounts and no private metadata',async()=>{
  const {run,calls}=fixture(),r=await companionSnapshot('a',false,run);
  assert.deepEqual(calls,[['balance','a'],['address','a']]);assert.equal(r.refreshed,false);assert.equal(r.serverHeight,null);
  assert.equal(r.amounts.total,'123456789');assert.equal(r.amounts.spendable,'110000001');assert.equal(r.amounts.pending,'13456788');assert.equal(r.address,address);assert.equal(r.canSend,false);assert(!JSON.stringify(r).includes('must not escape'));
});
test('network update checks test chain before sync and reads the wallet afterward',async()=>{
  const {run,calls}=fixture(),r=await companionSnapshot('b',true,run);
  assert.deepEqual(calls,[['info','b'],['sync','b'],['balance','b'],['address','b']]);assert.equal(r.refreshed,true);assert.equal(r.serverHeight,4542640);
});
test('wrong network stops before synchronization, and failed sync cannot return a fresh balance',async()=>{
  const f=fixture(r=>{r.info.chain_name='main';});await assert.rejects(companionSnapshot('a',true,f.run),/not on testnet/);assert.equal(f.calls.length,1);
  const g=fixture(r=>{if(r.action==='sync')r.ok=false;});await assert.rejects(companionSnapshot('a',true,g.run));assert.equal(g.calls.length,2);
});
test('unknown actions/wallet paths cannot launch a native process',async()=>{
  for(const name of ['../a','mainnet','c','a;whoami'])await assert.rejects(companionSnapshot(name,false,()=>assert.fail('must not run')));
  for(const action of ['send','init','export-seed','transactions','balance --convert USD'])await assert.rejects(readNativeWallet(action,'a'),/Unsupported/);
});
test('malformed, unsafe and inconsistent amounts or address reject the complete snapshot',async()=>{
  for(const change of [r=>r.balance.total=-1,r=>r.balance.total=1.5,r=>r.balance.total=Number.MAX_SAFE_INTEGER+1,r=>r.balance.total=0,r=>delete r.balance.ironwood_spendable,r=>r.balance.chain_tip_height=0,r=>r.orchardAddress='u1mainnet',r=>r.orchardAddress=address+'\nprivate',r=>r.wallet='b',r=>r.network='main']) {
    await assert.rejects(companionSnapshot('a',false,fixture(change).run));
  }
});
test('zero balances are returned only after successful native reads',async()=>{
  const f=fixture(r=>{for(const field of Object.keys(balance))if(field!=='chain_tip_height')r.balance[field]=0;});assert.equal((await companionSnapshot('a',false,f.run)).amounts.total,'0');
  await assert.rejects(companionSnapshot('a',false,async()=>{throw Error('wallet unavailable');}),/unavailable/);
});
