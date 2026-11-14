import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET as d } from './public/intent-lending-config.js';
import { createLendingReader } from './intent-lending-read.mjs';

const address = byte => '0x' + byte.repeat(20), hash = byte => '0x' + byte.repeat(32);
const block = { number: '0x100', hash: hash('ab'), timestamp: '0x6ad68000' };
const owner = address('aa'), account = address('bb'), factory = address('cc');
const aUsdc = address('61'), stableLink = address('62'), variableLink = address('63'), stableUsdc = address('64');
const privacyPool = address('d1'), supplyFactory = address('d2'), verifier = address('d3'), hasher = address('d4');
const routeType = '(address pool,address link,address usdc,address aLink,address variableDebt,uint256 chainId,bytes32 poolCodeHash,bytes32 linkCodeHash,bytes32 usdcCodeHash,bytes32 aLinkCodeHash,bytes32 variableDebtCodeHash)';
// Independent documented protocol ABI, not the reader's internal decoder.
const abi = new Interface([
  'function getPool() view returns(address)', 'function getPriceOracle() view returns(address)', 'function ADDRESSES_PROVIDER() view returns(address)',
  'function BASE_CURRENCY_UNIT() view returns(uint256)', 'function getAssetPrice(address) view returns(uint256)',
  'function getReserveData(address) view returns((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
  'function getReserveConfigurationData(address) view returns(uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)',
  'function getReserveTokensAddresses(address) view returns(address,address,address)', 'function getReserveCaps(address) view returns(uint256,uint256)', 'function getPaused(address) view returns(bool)',
  'function getReserveNormalizedIncome(address) view returns(uint256)', 'function getReserveNormalizedVariableDebt(address) view returns(uint256)',
  'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)', 'function scaledBalanceOf(address) view returns(uint256)',
  'function scaledTotalSupply() view returns(uint256)', 'function totalSupply() view returns(uint256)', 'function POOL() view returns(address)', 'function UNDERLYING_ASSET_ADDRESS() view returns(address)',
  'function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)',
  `function getRoute() view returns(${routeType})`, 'function owner() view returns(address)', 'function nonce() view returns(uint256)', 'function accountAddress(address) view returns(address)',
  'function token() view returns(address)', 'function denomination() view returns(uint256)', 'function levels() view returns(uint32)', 'function verifier() view returns(address)', 'function hasher() view returns(address)',
  'function privacyPool() view returns(address)', 'function inputToken() view returns(address)', 'function aavePool() view returns(address)', 'function aToken() view returns(address)', 'function chainId() view returns(uint256)',
  ...['privacyPoolCodeHash', 'inputCodeHash', 'aavePoolCodeHash', 'aTokenCodeHash', 'verifierCodeHash', 'hasherCodeHash'].map(name => `function ${name}() view returns(bytes32)`),
]);

function configuration({ decimals, ltv, threshold, supplyCap, borrowCap }) {
  // Bit ranges are from Aave DataTypes.ReserveConfigurationMap.
  return BigInt(ltv) | BigInt(threshold) << 16n | 10500n << 32n | BigInt(decimals) << 48n |
    1n << 56n | 1n << 58n | 1000n << 64n | BigInt(borrowCap) << 80n | BigInt(supplyCap) << 116n;
}

function fixture({ operational = false, privateRoute = false, historical = false } = {}) {
  const calls = [], changes = new Map();
  const names = ['pool', 'provider', 'dataProvider', 'oracle', 'faucet', 'link', 'usdc', 'aLink', 'variableDebt'];
  const codes = Object.fromEntries(names.map((name, index) => [d[name], '0x6000' + index.toString(16).padStart(2, '0')]));
  for (const target of [aUsdc, stableLink, variableLink, stableUsdc, factory, account]) codes[target] = '0x600099';
  const implementations = { pool: address('71'), aLink: address('72'), variableDebt: address('73') };
  for (const target of Object.values(implementations)) codes[target] = '0x600088';
  const codeHashes = Object.fromEntries(names.map(name => [name, keccak256(codes[d[name]])]));
  if (operational) codeHashes.lendingFactory = keccak256(codes[factory]);
  if (privateRoute) for (const [name, target] of Object.entries({ privacyPool, supplyFactory, verifier, hasher })) { codes[target] = '0x600077'; codeHashes[name] = keccak256(codes[target]); }
  const implementationPins = Object.fromEntries(Object.entries(implementations).map(([name, target]) => [name, { address: target, codeHash: keccak256(codes[target]) }]));
  const deployment = { codeHashes, implementationPins, ...(operational ? { lendingFactory: factory } : {}), ...(privateRoute ? { privacyPool, supplyFactory, verifier, hasher } : {}) };
  const route = [d.pool, d.link, d.usdc, d.aLink, d.variableDebt, 11155111n, ...['pool', 'link', 'usdc', 'aLink', 'variableDebt'].map(name => codeHashes[name])];
  const reserves = {
    [d.link]: [configuration({ decimals: 18, ltv: 7000, threshold: 7500, supplyCap: 6, borrowCap: 0 }), 2000000000000000000000000000n, 10000000000000000000000000n, 1200000000000000000000000000n, 40000000000000000000000000n, 0n, 1792000000n, 1n, d.aLink, stableLink, variableLink, address('65'), 500000000000000000n, 0n, 0n],
    [d.usdc]: [configuration({ decimals: 6, ltv: 8000, threshold: 8500, supplyCap: 0, borrowCap: 50 }), 1000000000000000000000000000n, 20000000000000000000000000n, 1200000000000000000000000000n, 50000000000000000000000000n, 0n, 1792000000n, 2n, aUsdc, stableUsdc, d.variableDebt, address('65'), 0n, 0n, 0n],
  };
  const state = { deployed: true, reorg: false, chain: d.chainHex };
  function result(to, call) {
    const values = call.args, name = call.name, asset = values.length ? values[0]?.toLowerCase?.() : undefined;
    const configured = changes.get(`${to}.${name}`);
    if (configured !== undefined) return typeof configured === 'function' ? configured(values) : configured;
    if (name === 'getPool') return [d.pool];
    if (name === 'getPriceOracle') return [d.oracle];
    if (name === 'ADDRESSES_PROVIDER') return [d.provider];
    if (name === 'BASE_CURRENCY_UNIT') return [100000000n];
    if (name === 'getAssetPrice') return [asset === d.link ? 3000000000n : 100000000n];
    if (name === 'getReserveData') return [reserves[asset]];
    if (name === 'getReserveConfigurationData') return [asset === d.link ? 18n : 6n, asset === d.link ? 7000n : 8000n, asset === d.link ? 7500n : 8500n, 10500n, 1000n, true, true, false, true, false];
    if (name === 'getReserveTokensAddresses') return reserves[asset].slice(8, 11);
    if (name === 'getReserveCaps') return [asset === d.link ? 0n : 50n, asset === d.link ? 6n : 0n];
    if (name === 'getPaused') return [false];
    if (name === 'getReserveNormalizedIncome') return [reserves[asset][1]];
    if (name === 'getReserveNormalizedVariableDebt') return [reserves[asset][3]];
    if (name === 'decimals') return [to === d.link || to === d.aLink || to === variableLink || to === stableLink ? 18n : 6n];
    if (name === 'POOL') return [d.pool];
    if (name === 'UNDERLYING_ASSET_ADDRESS') return [to === d.aLink || to === variableLink || to === stableLink ? d.link : d.usdc];
    if (name === 'scaledTotalSupply') return [to === d.aLink ? 2000000000000000000n : 100000000n];
    if (name === 'totalSupply') return [to === d.aLink ? 4000000000000000000n : to === d.variableDebt ? 20000000n : to === stableUsdc ? 5000000n : 0n];
    if (name === 'balanceOf') {
      if (to === d.link) return [asset === d.aLink ? 4000000000000000000n : 33n];
      if (to === d.usdc) return [asset === aUsdc ? 400000000n : 7000000n];
      if (to === d.aLink) return [1000000000000000000n];
      if (to === d.variableDebt) return [5000000n];
    }
    if (name === 'scaledBalanceOf') return [to === d.aLink ? 500000000000000000n : 4166667n];
    if (name === 'getUserAccountData') return [3000000000n, 500000000n, 1600000000n, 7500n, 7000n, 4500000000000000000n];
    if (name === 'getRoute') return [route];
    if (name === 'owner') return [owner];
    if (name === 'nonce') return [7n];
    if (name === 'accountAddress') return [account];
    if (name === 'token' || name === 'inputToken') return [d.link];
    if (name === 'denomination') return [1000000000000000000n];
    if (name === 'levels') return [20n];
    if (name === 'verifier') return [verifier];
    if (name === 'hasher') return [hasher];
    if (name === 'privacyPool') return [privacyPool];
    if (name === 'aavePool') return [d.pool];
    if (name === 'aToken') return [d.aLink];
    if (name === 'chainId') return [11155111n];
    if (name.endsWith('CodeHash')) return [codeHashes[{ privacyPoolCodeHash: 'privacyPool', inputCodeHash: 'link', aavePoolCodeHash: 'pool', aTokenCodeHash: 'aLink', verifierCodeHash: 'verifier', hasherCodeHash: 'hasher' }[name]]];
    throw Error(`Unexpected fixture contract call ${to}.${name}`);
  }
  async function fetchImpl(url, options) {
    assert.equal(url, d.rpc);
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body); calls.push(request);
    const { method, params } = request;
    let value;
    if (method === 'eth_chainId') value = state.chain;
    else if (method === 'eth_getBlockByNumber') value = { ...block, ...(params[0] !== 'finalized' && state.reorg ? { hash: hash('ac') } : {}) };
    else {
      const ref = params[method === 'eth_getStorageAt' ? 2 : 1];
      const expectedRef=historical&&['eth_getCode','eth_getStorageAt'].includes(method)?block.number:{blockHash:block.hash,requireCanonical:true};
      assert.deepEqual(ref, expectedRef, 'Every state read must use the same checked canonical block');
      const to = (method === 'eth_call' ? params[0].to : params[0]).toLowerCase();
      if (method === 'eth_getCode') value = to === account && !state.deployed ? '0x' : codes[to];
      else if (method === 'eth_getStorageAt') {
        const name = names.find(name => d[name] === to), target = implementations[name];
        value = target ? '0x' + '00'.repeat(12) + target.slice(2) : hash('00');
      } else if (method === 'eth_call') {
        const call = abi.parseTransaction({ data: params[0].data });
        value = abi.encodeFunctionResult(call.name, result(to, call));
      } else throw Error(`Unexpected mutating/unsupported RPC ${method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: value }), { headers: { 'content-type': 'application/json' } });
  }
  return { fetchImpl, deployment, calls, changes, state, codes, route, reserves, implementations, reader: () => createLendingReader({ fetchImpl, deployment, now: () => 1792001000000 }) };
}

test('one finalized canonical snapshot reports exact reserve units and the selected actual position', async () => {
  const f = fixture(), snapshot = await f.reader().snapshot({ account });
  assert.equal(snapshot.chainId, 'eip155:11155111');
  assert.deepEqual(snapshot.block, { number: '256', hash: block.hash, timestamp: '1792442368', finality: 'finalized', requireCanonical: true });
  assert.equal(snapshot.reserves.LINK.supplyCapTokens, '6');
  assert.equal(snapshot.reserves.LINK.supplyHeadroomBaseUnits, '1000000000000000000');
  assert.equal(snapshot.reserves.LINK.oneNoteSupplyPossible, true);
  assert.equal(snapshot.reserves.USDC.availableLiquidityBaseUnits, '400000000');
  assert.equal(snapshot.reserves.USDC.variableBorrowRateRay, '50000000000000000000000000');
  assert.equal(snapshot.account.position.aLinkScaled, '500000000000000000');
  assert.equal(snapshot.account.position.aLinkBalanceBaseUnits, '1000000000000000000');
  assert.equal(snapshot.account.position.variableDebtBaseUnits, '5000000');
  assert.equal(snapshot.account.position.freeUsdcBaseUnits, '7000000');
  assert.equal(snapshot.account.position.accountData.healthFactorWad, '4500000000000000000');
  assert.equal(snapshot.execute, false);
  assert(f.calls.every(call => !/^eth_send|^eth_sign/.test(call.method)));
});

test('an explicit latest observation is never labelled finalized',async()=>{
  const f=fixture(),snapshot=await f.reader().snapshot({account},{blockTag:'latest'});
  assert.equal(snapshot.block.finality,'latest');assert.equal(f.calls.find(call=>call.method==='eth_getBlockByNumber').params[0],'latest');
  await assert.rejects(f.reader().snapshot({account},{blockTag:'pending'}),/observation tag/);
});

test('an original receipt position is read at its exact canonical hash below the finalized head',async()=>{
  const f=fixture({historical:true}),head={number:'0x101',hash:hash('ac'),timestamp:'0x6ad68001'},calls=[];
  const reader=createLendingReader({deployment:f.deployment,now:()=>1792001000000,fetchImpl:async(url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    if(request.method==='eth_getBlockByNumber'&&['finalized','0x101'].includes(request.params[0]))return Response.json({jsonrpc:'2.0',id:request.id,result:head});
    return f.fetchImpl(url,options);
  }});
  const snapshot=await reader.snapshot({account},{blockRef:{number:'0x100',hash:block.hash}});
  assert.deepEqual(snapshot.block,{number:'256',hash:block.hash,timestamp:'1792442368',finality:'finalized',requireCanonical:true});
  assert.equal(snapshot.account.position.variableDebtBaseUnits,'5000000');
  assert.deepEqual(calls.filter(call=>call.method==='eth_getBlockByNumber').map(call=>call.params[0]),['finalized','0x100','0x100','0x101']);
  assert(calls.filter(call=>call.method==='eth_call').every(call=>call.params[1].blockHash===block.hash&&call.params[1].requireCanonical===true));
  assert(calls.filter(call=>['eth_getCode','eth_getStorageAt'].includes(call.method)).every(call=>call.params[call.method==='eth_getStorageAt'?2:1]==='0x100'));
});

test('receipt-block reads reject future receipts and changed receipt or finalized-head hashes',async()=>{
  for(const problem of ['future','receipt-hash','receipt-reorg','head-reorg']){
    const f=fixture({historical:true}),head={number:problem==='future'?'0xff':'0x101',hash:hash('ac'),timestamp:'0x6ad68001'};let receiptReads=0;
    const reader=createLendingReader({deployment:f.deployment,fetchImpl:async(url,options)=>{
      const request=JSON.parse(options.body);
      if(request.method==='eth_getBlockByNumber'){
        if(request.params[0]==='finalized')return Response.json({jsonrpc:'2.0',id:request.id,result:head});
        if(request.params[0]==='0x101')return Response.json({jsonrpc:'2.0',id:request.id,result:{...head,hash:problem==='head-reorg'?hash('ad'):head.hash}});
        receiptReads++;
        if(problem==='receipt-hash'||problem==='receipt-reorg'&&receiptReads>1)return Response.json({jsonrpc:'2.0',id:request.id,result:{...block,hash:hash('ad')}});
      }
      return f.fetchImpl(url,options);
    }});
    await assert.rejects(reader.snapshot({account},{blockRef:{number:'0x100',hash:block.hash}}),/not finalized|not canonical|no longer canonical/);
  }
});

test('receipt-block selection rejects malformed or nonfinalized references before any network read',async()=>{
  for(const options of [{blockRef:{number:'0x0100',hash:block.hash}},{blockRef:{number:'0x100',hash:'0x1234'}},{blockRef:{number:'0x100',hash:block.hash,rpc:'https://other.example'}},{blockTag:'latest',blockRef:{number:'0x100',hash:block.hash}}]){
    const f=fixture();await assert.rejects(f.reader().snapshot({account},options),/exact finalized/);assert.equal(f.calls.length,0);
  }
});

test('the recoverable owner receives a factory-bound observation of the exact deployed account', async () => {
  const f = fixture({ operational: true });
  const observed = await f.reader().observeAccount({ ownerAddress: owner, factory, account, chainId: d.chain });
  assert.deepEqual(Object.keys(observed).sort(), ['account', 'accountCodeHash', 'blockHash', 'blockNumber', 'chainId', 'deployed', 'factory', 'nonce', 'ownerAddress', 'route'].sort());
  assert.equal(observed.ownerAddress, owner);
  assert.equal(observed.account, account);
  assert.equal(observed.deployed, true);
  assert.equal(observed.nonce, '7');
  assert.equal(observed.accountCodeHash, keccak256(f.codes[account]));
  assert.equal(observed.route.factory, factory);
  assert.equal(observed.route.chainId, 'eip155:11155111');
  assert.equal(observed.route.poolCodeHash, f.deployment.codeHashes.pool);
  assert.equal(observed.blockHash, block.hash);
});

test('a complete deployment verifies the original LINK denomination and immutable Supply bindings', async () => {
  const f = fixture({ operational: true, privateRoute: true }), snapshot = await f.reader().snapshot({ owner });
  assert.equal(snapshot.routeVerified, true);
  assert.equal(snapshot.deploymentStatus, 'verified');
  assert.equal(snapshot.trust.executionPinsVerified, true);
  assert.equal(snapshot.account.status, 'verified');
  assert.equal(snapshot.account.address, account);
  assert.equal(snapshot.execute, false);
  f.changes.set(`${privacyPool}.denomination`, [1000000n]);
  await assert.rejects(f.reader().snapshot({ owner }), /denomination|proof route/i);
});

test('an unknown position stays unknown and an undeployed factory account uses actual queried balances', async () => {
  const f = fixture(), unknown = await f.reader().snapshot();
  assert.equal(unknown.account.status, 'unknown'); assert.equal(unknown.account.position, null); assert.equal(unknown.account.nonce, null);
  const g = fixture({ operational: true }); g.state.deployed = false;
  const value = await g.reader().snapshot({ owner });
  assert.equal(value.account.status, 'undeployed'); assert.equal(value.account.nonce, '0'); assert.equal(value.account.codeHash, null);
  assert.equal(value.account.position.freeUsdcBaseUnits, '7000000');
});

test('a pre-aborted observation makes no network request', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(Error('fixture cancelled'));
  await assert.rejects(f.reader().snapshot({}, { signal: controller.signal }), /cancelled/);
  assert.equal(f.calls.length, 0);
});

test('an observed additional proxy needs its own implementation pin before the route or owner is verified', async () => {
  const f = fixture({ operational: true, privateRoute: true });
  f.implementations.link = address('74'); f.codes[address('74')] = '0x600055';
  const unpinned = await f.reader().snapshot({ owner });
  assert.equal(unpinned.implementations.link.pinned, false);
  assert.equal(unpinned.trust.implementationPinsVerified, false);
  assert.equal(unpinned.routeVerified, false);
  await assert.rejects(f.reader().observeAccount({ ownerAddress: owner, factory, account, chainId: d.chain }), /not pinned/);
  f.deployment.implementationPins.link = { address: address('74'), codeHash: keccak256('0x600055') };
  const pinned = await f.reader().snapshot({ owner });
  assert.equal(pinned.trust.implementationPinsVerified, true);
  assert.equal(pinned.routeVerified, true);
});

test('wrong chains, unavailable finality and a changed canonical hash cannot produce a position', async () => {
  const wrongChain = fixture(); wrongChain.state.chain = '0x1';
  await assert.rejects(wrongChain.reader().snapshot({ account }), /another chain/);
  assert.equal(wrongChain.calls.length, 1);
  const reorg = fixture(); reorg.state.reorg = true;
  await assert.rejects(reorg.reader().snapshot({ account }), /no longer canonical/);
  const missing = fixture();
  const reader = createLendingReader({ deployment: missing.deployment, fetchImpl: async (url, options) => {
    const response = await missing.fetchImpl(url, options), body = await response.json();
    if (JSON.parse(options.body).method === 'eth_getBlockByNumber') body.result = null;
    return Response.json(body);
  } });
  await assert.rejects(reader.snapshot({ account }), /finalized lending block/);
});

test('selection rejects RPC, chain and route substitutions before contacting the network', async () => {
  const f = fixture();
  for (const input of [{ rpc: 'https://other.invalid' }, { chainId: 'eip155:1' }, { account, owner: '0x' + '00'.repeat(20) }, { account: null }, [], null]) {
    await assert.rejects(f.reader().snapshot(input), /Choose/);
  }
  assert.equal(f.calls.length, 0);
  for (const deployment of [{ rpc: 'https://other.invalid' }, { pool: account }, { privacyPool }, { codeHashes: { pool: '0xab' } }]) {
    assert.throws(() => createLendingReader({ deployment, fetchImpl: f.fetchImpl }), /configured|complete|Invalid/);
  }
});

test('changed, missing or replaced runtime and proxy implementations reject pinned observations', async () => {
  for (const alter of [
    f => { f.codes[d.link] = '0x600001'; },
    f => { f.codes[d.pool] = '0x'; },
    f => { f.codes[address('71')] = '0x600099'; },
    f => { f.implementations.pool = address('72'); },
    f => { delete f.implementations.pool; },
  ]) {
    const f = fixture(); alter(f);
    await assert.rejects(f.reader().snapshot({ account }), /changed|verifiable|unresolved/);
  }
});

test('conflicting Aave assets, receipt ownership, denominations and reserve data reject the snapshot', async () => {
  for (const alter of [
    f => f.changes.set(`${d.provider}.getPool`, [account]),
    f => f.changes.set(`${d.dataProvider}.getReserveTokensAddresses`, [account, stableLink, variableLink]),
    f => { f.reserves[d.link][8] = account; },
    f => { f.reserves[d.usdc][10] = account; },
    f => f.changes.set(`${d.link}.decimals`, [6n]),
    f => f.changes.set(`${d.aLink}.UNDERLYING_ASSET_ADDRESS`, [d.usdc]),
    f => f.changes.set(`${d.variableDebt}.POOL`, [account]),
    f => f.changes.set(`${d.dataProvider}.getPaused`, [true]),
    f => f.changes.set(`${d.dataProvider}.getReserveCaps`, [1n, 2n]),
    f => f.changes.set(`${d.pool}.getReserveNormalizedIncome`, [1n]),
    f => f.changes.set(`${d.oracle}.getAssetPrice`, [0n]),
    f => { f.reserves[d.link][6] = BigInt(block.timestamp) + 1n; },
  ]) {
    const f = fixture(); alter(f);
    await assert.rejects(f.reader().snapshot({ account }), /changed|disagree|conflicts|invalid/);
  }
});

test('Supply proof dependencies and the durable lending owner cannot be substituted', async () => {
  for (const [target, method, value] of [
    [privacyPool, 'verifier', account], [supplyFactory, 'hasher', account],
    [privacyPool, 'levels', 19n], [supplyFactory, 'chainId', 1n],
    [supplyFactory, 'inputCodeHash', hash('ee')], [account, 'owner', address('dd')],
    [factory, 'accountAddress', address('dd')],
  ]) {
    const f = fixture({ operational: true, privateRoute: true }); f.changes.set(`${target}.${method}`, [value]);
    await assert.rejects(f.reader().observeAccount({ ownerAddress: owner, factory, account, chainId: d.chain }), /changed|another|proof route/);
  }
  const changedRoute = fixture({ operational: true }); changedRoute.route[7] = hash('ee');
  await assert.rejects(changedRoute.reader().observeAccount({ ownerAddress: owner, factory, account, chainId: d.chain }), /original code pins/);
  const unpinned = fixture({ operational: true }); delete unpinned.deployment.codeHashes.lendingFactory;
  await assert.rejects(unpinned.reader().observeAccount({ ownerAddress: owner, factory, account, chainId: d.chain }), /not pinned/);
  assert.equal(unpinned.calls.length, 0);
});

test('malformed JSON-RPC envelopes and noncanonical contract results are rejected', async () => {
  for (const alter of [
    body => ({ ...body, id: body.id + 1 }), body => ({ ...body, jsonrpc: '1.0' }),
    body => ({ ...body, error: { code: -32000, message: 'untrusted provider text' } }),
    body => ({ jsonrpc: '2.0', id: body.id }), () => [],
  ]) {
    const f = fixture(), reader = createLendingReader({ fetchImpl: async (url, options) => Response.json(alter(await (await f.fetchImpl(url, options)).json())) });
    await assert.rejects(reader.snapshot(), /could not be verified/);
  }
  for (const suffix of ['00', '00'.repeat(32)]) {
    const f = fixture(), reader = createLendingReader({ deployment: f.deployment, fetchImpl: async (url, options) => {
      const body = await (await f.fetchImpl(url, options)).json();
      if (JSON.parse(options.body).method === 'eth_call') body.result += suffix;
      return Response.json(body);
    } });
    await assert.rejects(reader.snapshot(), /contract result cannot be verified/);
  }
});

test('oversized, invalid UTF-8 and redirected RPC replies never become lending evidence', async () => {
  const replies = [
    [() => new Response('x'.repeat(1024 * 1024 + 1)), /exceeds the read limit/],
    [() => new Response(Uint8Array.of(0xc3, 0x28)), /cannot be decoded/],
    [() => { const response = new Response('{}'); Object.defineProperty(response, 'redirected', { value: true }); return response; }, /unavailable/],
  ];
  for (const [reply, error] of replies) await assert.rejects(createLendingReader({ fetchImpl: async () => reply() }).snapshot(), error);
});

test('cancellation stops a pending RPC fetch or body read without publishing a partial snapshot', async () => {
  for (const stage of ['fetch', 'body']) {
    const controller = new AbortController(); let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const reader = createLendingReader({ fetchImpl: async () => {
      if (stage === 'fetch') { entered(); return new Promise(() => {}); }
      return new Response(new ReadableStream({ pull() { entered(); return new Promise(() => {}); } }));
    } });
    const pending = reader.snapshot({}, { signal: controller.signal });
    await ready; controller.abort(Error('fixture cancelled while reading'));
    await assert.rejects(pending, /cancelled while reading/);
  }
});
