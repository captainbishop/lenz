import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {previewWithMarkets}=await import(process.env.LENZ_MATCH_MODULE?pathToFileURL(process.env.LENZ_MATCH_MODULE):new URL('./public/defi-market-match.js',import.meta.url));
const report=JSON.parse(await readFile(new URL('../integrations/market-discovery-live.json',import.meta.url))),now=Date.now();
const snapshots=()=>report.results.map(r=>({...structuredClone(r.observation),observedAt:now,expiresAt:now+60000}));
const strip=a=>({chainId:a.chainId,kind:a.kind,id:a.id,decimals:a.decimals});
function objective(){const [weth,usdc]=snapshots()[0].rows[0].assets;return {id:'market-match-test',source:{asset:strip(usdc),amount:'1000000'},destination:{marketId:'uniswap',chainId:'eip155:8453',action:'swap',outputAsset:strip(weth)},recipient:{chainId:'eip155:8453',address:'0x'+'33'.repeat(20)},limits:{deadline:now+300000,minReceive:'1',maxFees:[{asset:strip(usdc),amount:'1000'}]},privacy:'private',returnTo:null};}
test('observed Uniswap assets narrow route candidates without creating execution authority',()=>{const plan=previewWithMarkets(objective(),snapshots(),{now});assert.equal(plan.discovery.candidates.length,1);assert.equal(plan.executable,false);assert.equal(plan.discovery.candidates[0].executable,false);assert.equal(plan.objective.privacy,'private');assert(plan.blockers.length>0);});
test('network sources stay distinct and cannot duplicate or substitute for Base',()=>{
 const data=snapshots();assert.equal(data.length,7);
 const plan=previewWithMarkets(objective(),data,{now});assert.equal(plan.discovery.candidates[0].chainId,'eip155:8453');
 assert.equal(previewWithMarkets(objective(),data.filter(s=>s.chainId!=='eip155:8453'),{now}).discovery.candidates.length,0);
 assert.throws(()=>previewWithMarkets(objective(),[data[0],data[0]],{now}),/Duplicate/);
 assert.throws(()=>previewWithMarkets(objective(),[...data,data[0]],{now}),/Too many/);
});
test('token name, wrong contract or precision cannot substitute for the route asset',()=>{for(const field of ['id','decimals']){const o=objective();o.destination.outputAsset[field]=field==='id'?'0x'+'44'.repeat(20):17;assert.equal(previewWithMarkets(o,snapshots(),{now}).discovery.candidates.length,0);}});
test('Aave borrowing matches the received asset and requires its borrowing flag',()=>{
 const o=objective(),data=snapshots(),reserves=data.find(s=>s.provider==='aave').rows;
 const weth=reserves.find(r=>r.assets[0].symbol==='WETH'),usdc=reserves.find(r=>r.assets[0].symbol==='USDC');
 o.source.asset=strip(weth.assets[0]);o.destination={marketId:'aave',chainId:'eip155:8453',action:'borrow',positionId:'unverified-position',outputAsset:strip(usdc.assets[0])};
 assert.deepEqual(previewWithMarkets(o,data,{now}).discovery.candidates.map(r=>r.id),[usdc.id]);
 usdc.borrowingEnabled=false;assert.equal(previewWithMarkets(o,data,{now}).discovery.candidates.length,0);
});
test('expired snapshots keep refresh blockers and cross-chain funding stays unverified',()=>{const data=snapshots();data.forEach(s=>{s.observedAt=now-120000;s.expiresAt=now-60000;});assert(previewWithMarkets(objective(),data,{now}).discovery.requirements.some(x=>x.includes('refreshing')));const o=objective();o.source.asset={chainId:'near:mainnet',kind:'nep141',id:'fixture.near',decimals:6};assert(previewWithMarkets(o,snapshots(),{now}).discovery.requirements.some(x=>x.includes('funding asset')));});
test('HyperCore matching requires exact instrument and respects the observed leverage ceiling',()=>{const o=objective();o.source={asset:{chainId:'hypercore:mainnet',kind:'venue',id:'USDC',decimals:6},amount:'1000000'};o.destination={marketId:'hyperliquid',chainId:'hypercore:mainnet',action:'place-order',order:{instrument:'ETH',side:'buy',size:'1',limitPrice:'2000',maxLeverage:2,reduceOnly:false}};o.recipient.chainId='hypercore:mainnet';o.limits.minReceive='0';o.limits.maxFees=[{asset:o.source.asset,amount:'1000'}];assert.equal(previewWithMarkets(o,snapshots(),{now}).discovery.candidates.length,1);o.destination.order.instrument='ETH-PERP';assert.equal(previewWithMarkets(o,snapshots(),{now}).discovery.candidates.length,0);o.destination.order.instrument='ETH';o.destination.order.maxLeverage=50;assert.equal(previewWithMarkets(o,snapshots(),{now}).discovery.candidates.length,0);});
