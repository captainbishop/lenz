import test from 'node:test';
import assert from 'node:assert/strict';
import {readLendingPosition,reviewLendingPosition} from './public/lending-position.js';
import {positionFixture,abi,wallet,aToken,variableToken,stableToken,provider,blockHash,zero} from './lending-position-fixture.mjs';
test('selected reserve shows exact supplied and variable debt at finalized block; mock stable debt stays unavailable',async()=>{
 const f=positionFixture(),value=await readLendingPosition(f.lease,f.row);
 assert.equal(value.account,wallet);assert.equal(value.supplied,'1250.5');assert.equal(value.variableDebt,'205');assert.equal(value.stableDebt,null);assert.equal(value.stableDebtStatus,'unsupported');assert.equal(value.collateral,true);
 assert.equal(value.aToken,aToken);assert.equal(value.variableDebtToken,variableToken);assert.equal(value.blockHash,blockHash);assert.equal(value.finality,'wallet-provider-finalized');assert.equal(value.executable,false);
 assert(f.calls.some(c=>c.method==='eth_getBlockByNumber'&&c.params[0]==='finalized'));assert(!f.calls.some(c=>/send|sign|switch/i.test(c.method)));
});
for(const network of ['base','arbitrum'])test('uses selected reviewed reserve on '+network,async()=>{const f=positionFixture(network),value=await readLendingPosition(f.lease,f.row);assert.equal(value.pool,f.row.address);assert.equal(value.asset.id,f.row.assets[0].id);});
for(const network of ['ethereum','base','arbitrum'])test('selected WETH uses the reviewed receipts and eighteen decimal amounts on '+network,async()=>{const f=positionFixture(network,0),value=await readLendingPosition(f.lease,f.row);assert.equal(value.supplied,'1250.5');assert.equal(value.variableDebt,'205');assert.equal(value.asset.symbol,'WETH');assert.equal(value.asset.decimals,18);});
test('real legacy stable debt requires receipt binding; unavailable marker stays unknown',async()=>{
 const f=positionFixture();f.state.stableMock=false;const value=await readLendingPosition(f.lease,f.row);assert.equal(value.stableDebt,'10');assert.equal(value.stableDebtToken,stableToken);
 f.state.hook=(m,p)=>{if(m==='eth_call'&&p[0].data.startsWith(abi.getFunction('getAddress').selector))throw Error('Marker unavailable');};const missing=await readLendingPosition(f.lease,f.row);assert.equal(missing.stableDebt,null);assert.equal(missing.stableDebtStatus,'unknown');
});
test('wrong pool, unsupported or renamed asset and different network fail before provider reads',async()=>{
 for(const mutate of [f=>f.row.address=provider,f=>f.row.assets=[{...f.row.assets[0],id:aToken}],f=>f.row.assets=[{...f.row.assets[0],symbol:'FAKE'}],f=>f.lease.identity.chainId='0x2105']){const f=positionFixture();mutate(f);await assert.rejects(readLendingPosition(f.lease,f.row));assert.equal(f.calls.length,0);}
});
test('receipt underlying, pool, decimals and noncanonical ABI data cannot become positions',async()=>{
 for(const [name,value]of [['UNDERLYING_ASSET_ADDRESS',[aToken]],['POOL',[provider]],['decimals',[18]],['getPool',[provider]],['ADDRESSES_PROVIDER',[zero]],['getReserveAddressById',[aToken]]]){const f=positionFixture();f.state.hook=(m,p)=>m==='eth_call'&&p[0].data.startsWith(abi.getFunction(name).selector)?abi.encodeFunctionResult(name,value):undefined;await assert.rejects(readLendingPosition(f.lease,f.row));}
 for(const result of ['0x','0x'+'ff'.repeat(32),'0x'+'00'.repeat(64)]){const f=positionFixture();f.state.hook=(m,p)=>m==='eth_call'&&p[0].data.startsWith(abi.getFunction('getReserveData').selector)?result:undefined;await assert.rejects(readLendingPosition(f.lease,f.row),/response/);}
});
test('missing balance is unavailable while a successful exact zero remains zero',async()=>{
 const f=positionFixture();f.state.hook=(m,p)=>m==='eth_call'&&p[0].data.startsWith(abi.getFunction('balanceOf').selector)?abi.encodeFunctionResult('balanceOf',[0n]):undefined;assert.equal((await readLendingPosition(f.lease,f.row)).supplied,'0');
 f.state.hook=(m,p)=>{if(m==='eth_call'&&p[0].data.startsWith(abi.getFunction('balanceOf').selector))throw Error('Balance unavailable');};await assert.rejects(readLendingPosition(f.lease,f.row),/Balance unavailable/);
});
test('a silent account change or stale lease during a late provider response invalidates the read',async()=>{
 for(const mode of ['silent','lease']){const f=positionFixture();let accounts=0;f.state.hook=(m,p)=>{if(mode==='silent'&&m==='eth_accounts'&&++accounts>1)return[provider];if(mode==='lease'&&m==='eth_call'&&p[0].data.startsWith(abi.getFunction('balanceOf').selector))f.state.changed=true;};await assert.rejects(readLendingPosition(f.lease,f.row),/changed/);}
});
test('stale, absent finalized data and a changed canonical block cannot appear current',async()=>{
 for(const mode of ['stale','missing','reorg']){const f=positionFixture();let blocks=0;f.state.hook=m=>{if(m==='eth_getBlockByNumber'){blocks++;return mode==='missing'?null:{number:'0x2a',hash:mode==='reorg'&&blocks>1?'0x'+'cd'.repeat(32):blockHash,timestamp:'0x'+(Math.floor(Date.now()/1000)-(mode==='stale'?3600:900)).toString(16)};}};await assert.rejects(readLendingPosition(f.lease,f.row),/block/i);}
});
test('review is bounded to observed supply or variable debt and never grants execution',async()=>{
 const f=positionFixture(),value=await readLendingPosition(f.lease,f.row),review=reviewLendingPosition(value,{action:'Repay',amount:'200.25'});assert.equal(review.units,'200250000');assert.equal(review.executable,false);assert.equal(review.eligibility,'unavailable');assert.equal(review.fees,null);
 for(const [action,amount]of [['Repay','205.000001'],['Withdraw','1250.500001'],['Withdraw','0'],['Repay','1.0000001'],['Repay','1e2']])assert.throws(()=>reviewLendingPosition(value,{action,amount}));
 assert.equal(reviewLendingPosition(value,{action:'Withdraw',amount:'1250.5'}).bound,'1250.5');
});
