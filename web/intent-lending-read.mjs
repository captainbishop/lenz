import { Interface, keccak256, toUtf8Bytes, toBeHex } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';

const check = (condition, message) => { if (!condition) throw Error(message); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) && value.length <= 66;
const protocolKeys = ['pool', 'provider', 'dataProvider', 'oracle', 'faucet', 'link', 'usdc', 'aLink', 'variableDebt'];
const deploymentKeys = ['lendingFactory', 'privacyPool', 'supplyFactory', 'verifier', 'hasher'];
const proxyKeys = ['pool', 'aLink', 'variableDebt'];
const implementationSlot = toBeHex(BigInt(keccak256(toUtf8Bytes('eip1967.proxy.implementation'))) - 1n, 32);
const ray = 10n ** 27n;
const routeType = '(address pool,address link,address usdc,address aLink,address variableDebt,uint256 chainId,bytes32 poolCodeHash,bytes32 linkCodeHash,bytes32 usdcCodeHash,bytes32 aLinkCodeHash,bytes32 variableDebtCodeHash)';
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

function configuration(overlay) {
  check(plain(overlay) && Object.keys(overlay).every(key => [...deploymentKeys, 'codeHashes', 'implementationPins'].includes(key)), 'Only fixed-route deployment pins may be configured.');
  const config = structuredClone(LENDING_TESTNET);
  for (const key of deploymentKeys) {
    if (Object.hasOwn(overlay, key)) { check(overlay[key] === null || address(overlay[key]), 'Invalid lending deployment address.'); config[key] = overlay[key]?.toLowerCase() ?? null; }
  }
  config.codeHashes = { ...config.codeHashes, ...overlay.codeHashes };
  config.implementationPins = { ...config.implementationPins, ...structuredClone(overlay.implementationPins ?? {}) };
  check(Object.keys(config.codeHashes).every(key => [...protocolKeys, ...deploymentKeys].includes(key) && hash(config.codeHashes[key])), 'Invalid lending code pin.');
  check(Object.entries(config.implementationPins).every(([key, pin]) => protocolKeys.includes(key) && plain(pin) && Object.keys(pin).length === 2 && address(pin.address) && hash(pin.codeHash)), 'Invalid lending implementation pin.');
  const proofCount = ['privacyPool', 'supplyFactory', 'verifier', 'hasher'].filter(key => config[key]).length;
  check(proofCount === 0 || proofCount === 4, 'Configure the complete original Supply proof route.');
  return config;
}

function selection(input) {
  check(plain(input) && Object.keys(input).every(key => ['account', 'owner'].includes(key)), 'Choose only a lending account and its recoverable owner.');
  for (const value of Object.values(input)) check(address(value), 'Choose a valid lending account.');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.toLowerCase()]));
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createLendingReader({ fetchImpl = fetch, deployment = {}, now = Date.now } = {}) {
  const d = configuration(deployment);
  let sequence = 0;
  async function rpc(method, params, signal) {
    signal.throwIfAborted();
    const id = ++sequence;
    const response = await abortable(fetchImpl(d.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), redirect: 'error', signal }), signal);
    check(response.ok && !response.redirected && response.body, 'The Sepolia lending network is unavailable.');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength; check(size <= 1024 * 1024, 'The lending RPC response exceeds the read limit.'); chunks.push(value);
      }
    } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw Error('The lending RPC response cannot be decoded.'); }
    check(plain(body) && body.jsonrpc === '2.0' && body.id === id && !Object.hasOwn(body, 'error') && Object.hasOwn(body, 'result'), 'The lending RPC evidence could not be verified.');
    return body.result;
  }

  async function snapshot(input = {}, options = {}) {
    const selected = selection(input), deadline = AbortSignal.timeout(60000);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const blockTag = options.blockTag ?? 'finalized';
    check(['finalized', 'latest'].includes(blockTag), 'Choose a canonical lending observation tag.');
    const blockRef = options.blockRef;
    check(blockRef === undefined || plain(blockRef) && Object.keys(blockRef).sort().join() === 'hash,number' && quantity(blockRef.number) && hash(blockRef.hash) && blockTag === 'finalized', 'Choose an exact finalized lending receipt block.');
    check(await rpc('eth_chainId', [], signal) === d.chainHex, 'The lending RPC returned another chain.');
    let block = await rpc('eth_getBlockByNumber', [blockTag, false], signal);
    check(plain(block) && quantity(block.number) && hash(block.hash) && quantity(block.timestamp), 'A finalized lending block is unavailable.');
    const finalizedHead = block;
    if (blockRef) {
      check(BigInt(blockRef.number) <= BigInt(finalizedHead.number), 'The original lending receipt is not finalized.');
      block = await rpc('eth_getBlockByNumber', [blockRef.number, false], signal);
      check(plain(block) && block.number === blockRef.number && block.hash === blockRef.hash && quantity(block.timestamp) && BigInt(block.timestamp) <= BigInt(finalizedHead.timestamp), 'The original lending receipt block is not canonical.');
    }
    const ref = { blockHash: block.hash, requireCanonical: true };
    // Historical code/storage APIs use numbers; the receipt and finalized hashes bracket every read.
    const codeRef = blockRef ? block.number : ref;
    const codes = {}, implementations = {};
    async function code(target, key) {
      const value = await rpc('eth_getCode', [target, codeRef], signal);
      check(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value), 'A lending contract has no verifiable code.');
      const codeHash = keccak256(value), pinned = Boolean(key && d.codeHashes[key]);
      if (pinned) check(codeHash === d.codeHashes[key], 'A pinned lending contract changed.');
      return { address: target, codeHash, bytes: (value.length - 2) / 2, pinned };
    }
    async function read(target, name, ...values) {
      const result = await rpc('eth_call', [{ to: target, data: abi.encodeFunctionData(name, values) }, ref], signal);
      check(typeof result === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(result) && result.length <= 32768, 'The lending contract result is invalid.');
      try {
        const decoded = abi.decodeFunctionResult(name, result);
        check(abi.encodeFunctionResult(name, decoded).toLowerCase() === result.toLowerCase(), 'Noncanonical lending contract result.');
        return decoded;
      } catch { throw Error('The lending contract result cannot be verified.'); }
    }
    const one = async (target, name, ...values) => (await read(target, name, ...values))[0];
    const targets = Object.fromEntries([...protocolKeys, ...deploymentKeys].filter(key => d[key]).map(key => [key, d[key]]));
    await Promise.all(Object.entries(targets).map(async ([key, target]) => { codes[key] = await code(target, key); }));
    await Promise.all(protocolKeys.map(async key => {
      const slot = await rpc('eth_getStorageAt', [d[key], implementationSlot, codeRef], signal);
      check(hash(slot) && /^0x0{24}/.test(slot), 'The lending implementation slot is invalid.');
      const implementation = '0x' + slot.slice(-40), pin = d.implementationPins[key];
      if (/^0x0{40}$/.test(implementation)) {
        check(!pin && !proxyKeys.includes(key), 'The lending protocol implementation is unresolved.');
        implementations[key] = null;
      } else {
        const observed = await code(implementation);
        if (pin) check(implementation === pin.address.toLowerCase() && observed.codeHash === pin.codeHash, 'A pinned lending implementation changed.');
        implementations[key] = { ...observed, pinned: Boolean(pin), resolution: 'eip1967-slot' };
      }
    }));
    const bindings = [[d.provider, 'getPool', d.pool], [d.provider, 'getPriceOracle', d.oracle], [d.pool, 'ADDRESSES_PROVIDER', d.provider], [d.dataProvider, 'ADDRESSES_PROVIDER', d.provider]];
    await Promise.all(bindings.map(async ([target, getter, expected]) => { check((await one(target, getter)).toLowerCase() === expected, 'The fixed Aave lending route changed.'); }));
    const baseCurrencyUnit = await one(d.oracle, 'BASE_CURRENCY_UNIT');
    check(baseCurrencyUnit > 0n, 'The Aave oracle denomination is unavailable.');
    let proofRoute = null;
    if (d.privacyPool) {
      const bindings = [[d.privacyPool, 'token', d.link], [d.privacyPool, 'verifier', d.verifier], [d.privacyPool, 'hasher', d.hasher],
        [d.supplyFactory, 'privacyPool', d.privacyPool], [d.supplyFactory, 'inputToken', d.link], [d.supplyFactory, 'aavePool', d.pool], [d.supplyFactory, 'aToken', d.aLink], [d.supplyFactory, 'verifier', d.verifier], [d.supplyFactory, 'hasher', d.hasher]];
      await Promise.all(bindings.map(async ([target, getter, expected]) => { check((await one(target, getter)).toLowerCase() === expected, 'The original Supply proof route changed.'); }));
      const [amount, levels, factoryAmount, chain] = await Promise.all([one(d.privacyPool, 'denomination'), one(d.privacyPool, 'levels'), one(d.supplyFactory, 'denomination'), one(d.supplyFactory, 'chainId')]);
      check(amount === BigInt(d.denomination) && amount === 10n ** BigInt(d.linkDecimals) && factoryAmount === amount && levels === 20n && chain === BigInt(d.chainId), 'The original Supply proof route denomination or chain changed.');
      await Promise.all(Object.entries({ privacyPoolCodeHash: 'privacyPool', inputCodeHash: 'link', aavePoolCodeHash: 'pool', aTokenCodeHash: 'aLink', verifierCodeHash: 'verifier', hasherCodeHash: 'hasher' }).map(async ([getter, key]) => {
        check(await one(d.supplyFactory, getter) === codes[key].codeHash, 'The Supply factory original code pins changed.');
      }));
      proofRoute = { privacyPool: d.privacyPool, supplyFactory: d.supplyFactory, verifier: d.verifier, hasher: d.hasher, inputToken: d.link, denominationBaseUnits: amount.toString(), levels: 20, bindingsVerified: true };
    }

    async function reserve(asset, decimals, expectedReceipt, expectedDebt) {
      const [tuple, config, tokens, caps, paused, normalizedIncome, normalizedDebt, tokenDecimals, price] = await Promise.all([
        one(d.pool, 'getReserveData', asset), read(d.dataProvider, 'getReserveConfigurationData', asset), read(d.dataProvider, 'getReserveTokensAddresses', asset), read(d.dataProvider, 'getReserveCaps', asset),
        one(d.dataProvider, 'getPaused', asset), one(d.pool, 'getReserveNormalizedIncome', asset), one(d.pool, 'getReserveNormalizedVariableDebt', asset), one(asset, 'decimals'), one(d.oracle, 'getAssetPrice', asset),
      ]);
      const [bits, liquidityIndex, liquidityRate, variableIndex, variableRate, stableRate, lastUpdated, , receipt, stableDebt, variableDebt, , treasury, unbacked] = tuple;
      for (const target of [receipt, stableDebt, variableDebt]) check(address(target), 'Aave reserve token identities are unavailable.');
      const receiptAddress = receipt.toLowerCase(), stableAddress = stableDebt.toLowerCase(), variableAddress = variableDebt.toLowerCase();
      check(tokens[0].toLowerCase() === receiptAddress && tokens[1].toLowerCase() === stableAddress && tokens[2].toLowerCase() === variableAddress, 'Aave reserve providers disagree.');
      check(!expectedReceipt || receiptAddress === expectedReceipt, 'The LINK receipt reserve changed.');
      check(!expectedDebt || variableAddress === expectedDebt, 'The USDC debt reserve changed.');
      const range = (shift, width) => bits >> BigInt(shift) & (1n << BigInt(width)) - 1n;
      const active = Boolean(range(56, 1)), frozen = Boolean(range(57, 1)), borrowingEnabled = Boolean(range(58, 1)), stableBorrowingEnabled = Boolean(range(59, 1));
      const collateralEnabled = range(16, 16) > 0n;
      check(tokenDecimals === BigInt(decimals) && config[0] === tokenDecimals && range(48, 8) === tokenDecimals, 'The lending asset denomination changed.');
      check(config[1] === range(0, 16) && config[2] === range(16, 16) && config[3] === range(32, 16) && config[4] === range(64, 16) && config[5] === collateralEnabled && config[6] === borrowingEnabled && config[7] === stableBorrowingEnabled && config[8] === active && config[9] === frozen && paused === Boolean(range(60, 1)) && caps[0] === range(80, 36) && caps[1] === range(116, 36), 'Aave reserve configuration evidence conflicts.');
      check(liquidityIndex >= ray && variableIndex >= ray && normalizedIncome >= liquidityIndex && normalizedDebt >= variableIndex && lastUpdated <= BigInt(block.timestamp) && price > 0n, 'Aave reserve indices or price are invalid.');
      const [scaledSupply, totalSupply, variableTotal, stableTotal, liquidity] = await Promise.all([
        one(receiptAddress, 'scaledTotalSupply'), one(receiptAddress, 'totalSupply'), one(variableAddress, 'totalSupply'), one(stableAddress, 'totalSupply'), one(asset, 'balanceOf', receiptAddress),
      ]);
      await Promise.all([receiptAddress, variableAddress].map(async target => {
        const [pool, underlying] = await Promise.all([one(target, 'POOL'), one(target, 'UNDERLYING_ASSET_ADDRESS')]);
        check(pool.toLowerCase() === d.pool && underlying.toLowerCase() === asset, 'An Aave receipt or debt token identity changed.');
      }));
      const cap = caps[1] * 10n ** BigInt(decimals), exposure = ((scaledSupply + treasury) * normalizedIncome + ray / 2n) / ray;
      const headroom = cap === 0n ? null : cap > exposure ? cap - exposure : 0n;
      return { asset, decimals, aToken: receiptAddress, stableDebtToken: stableAddress, variableDebtToken: variableAddress,
        ltvBps: config[1].toString(), liquidationThresholdBps: config[2].toString(), liquidationBonusBps: config[3].toString(), reserveFactorBps: config[4].toString(),
        active, frozen, paused, collateralEnabled, borrowingEnabled, stableBorrowingEnabled,
        supplyCapTokens: caps[1].toString(), borrowCapTokens: caps[0].toString(), supplyHeadroomBaseUnits: headroom?.toString() ?? null,
        supplyExposureBaseUnits: exposure.toString(), aTokenTotalSupplyBaseUnits: totalSupply.toString(), aTokenScaledTotalSupply: scaledSupply.toString(), accruedToTreasuryScaled: treasury.toString(), unbackedBaseUnits: unbacked.toString(),
        totalVariableDebtBaseUnits: variableTotal.toString(), totalStableDebtBaseUnits: stableTotal.toString(), availableLiquidityBaseUnits: liquidity.toString(),
        liquidityIndexRay: liquidityIndex.toString(), normalizedIncomeRay: normalizedIncome.toString(), variableBorrowIndexRay: variableIndex.toString(), normalizedVariableDebtRay: normalizedDebt.toString(),
        liquidityRateRay: liquidityRate.toString(), variableBorrowRateRay: variableRate.toString(), stableBorrowRateRay: stableRate.toString(), lastUpdatedSeconds: lastUpdated.toString(), oraclePriceBase: price.toString(),
        oneNoteSupplyPossible: asset === d.link && active && !frozen && !paused && collateralEnabled && (headroom === null || headroom >= BigInt(d.denomination)) };
    }
    const [linkReserve, usdcReserve] = await Promise.all([reserve(d.link, d.linkDecimals, d.aLink), reserve(d.usdc, d.usdcDecimals, undefined, d.variableDebt)]);
    const accountState = { status: 'unknown', address: null, owner: selected.owner ?? null, nonce: null, codeHash: null, route: null, position: null };
    if (selected.account) { accountState.address = selected.account; accountState.status = 'external'; }
    if (d.lendingFactory) {
      async function accountRoute(target) {
        const values = await one(target, 'getRoute');
        const keys = ['pool', 'link', 'usdc', 'aLink', 'variableDebt'];
        check(values[5] === BigInt(d.chainId), 'The lending account route uses another chain.');
        const route = { chainId: d.chain, factory: d.lendingFactory };
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index];
          check(values[index].toLowerCase() === d[key] && values[index + 6] === codes[key].codeHash, 'The lending account route or original code pins changed.');
          route[key] = d[key]; route[key + 'CodeHash'] = values[index + 6];
        }
        return route;
      }
      const factoryRoute = await accountRoute(d.lendingFactory);
      if (selected.owner) {
        const predicted = (await one(d.lendingFactory, 'accountAddress', selected.owner)).toLowerCase();
        check(address(predicted) && (!selected.account || selected.account === predicted), 'The recoverable owner has another lending account.');
        accountState.address = predicted; accountState.route = factoryRoute;
      }
      if (accountState.address) {
        const accountCode = await rpc('eth_getCode', [accountState.address, codeRef], signal);
        check(typeof accountCode === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(accountCode), 'The lending account code is invalid.');
        if (accountCode === '0x') {
          accountState.status = 'undeployed';
          accountState.nonce = selected.owner ? '0' : null;
        } else {
          const [actualOwner, nonce, route] = await Promise.all([one(accountState.address, 'owner'), one(accountState.address, 'nonce'), accountRoute(accountState.address)]);
          check(address(actualOwner) && (!selected.owner || actualOwner.toLowerCase() === selected.owner), 'The deployed lending account owner changed.');
          check((await one(d.lendingFactory, 'accountAddress', actualOwner)).toLowerCase() === accountState.address, 'The deployed account is outside its fixed factory.');
          accountState.owner = actualOwner.toLowerCase(); accountState.nonce = nonce.toString(); accountState.route = route;
          accountState.status = 'verified'; accountState.codeHash = keccak256(accountCode);
        }
      }
    }
    if (accountState.address) {
      const [freeLink, freeUsdc, collateral, scaledCollateral, debt, scaledDebt, data] = await Promise.all([
        one(d.link, 'balanceOf', accountState.address), one(d.usdc, 'balanceOf', accountState.address), one(d.aLink, 'balanceOf', accountState.address), one(d.aLink, 'scaledBalanceOf', accountState.address),
        one(d.variableDebt, 'balanceOf', accountState.address), one(d.variableDebt, 'scaledBalanceOf', accountState.address), read(d.pool, 'getUserAccountData', accountState.address),
      ]);
      accountState.position = { freeLinkBaseUnits: freeLink.toString(), freeUsdcBaseUnits: freeUsdc.toString(), aLinkBalanceBaseUnits: collateral.toString(), aLinkScaled: scaledCollateral.toString(), variableDebtBaseUnits: debt.toString(), variableDebtScaled: scaledDebt.toString(),
        accountData: Object.fromEntries(['totalCollateralBase', 'totalDebtBase', 'availableBorrowsBase', 'currentLiquidationThresholdBps', 'ltvBps', 'healthFactorWad'].map((name, index) => [name, data[index].toString()])) };
    }
    const canonical = await rpc('eth_getBlockByNumber', [block.number, false], signal);
    check(plain(canonical) && canonical.hash === block.hash && canonical.number === block.number && canonical.timestamp === block.timestamp, 'The finalized lending snapshot is no longer canonical.');
    if (blockRef) {
      const head = await rpc('eth_getBlockByNumber', [finalizedHead.number, false], signal);
      check(plain(head) && head.hash === finalizedHead.hash && head.number === finalizedHead.number && head.timestamp === finalizedHead.timestamp, 'The finalized lending head is no longer canonical.');
    }
    const codePinsVerified = Object.entries(targets).every(([key]) => codes[key].pinned);
    const implementationPinsVerified = proxyKeys.every(key => implementations[key]?.pinned) && Object.values(implementations).every(value => value === null || value.pinned);
    const configured = Boolean(d.lendingFactory && proofRoute);
    const executionPinsVerified = configured && codePinsVerified && implementationPinsVerified;
    return { chainId: d.chain, chainHex: d.chainHex, network: d.network, observedAt: now(), block: { number: BigInt(block.number).toString(), hash: block.hash, timestamp: BigInt(block.timestamp).toString(), finality: blockTag, requireCanonical: true },
      codes, implementations, denominationBaseUnits: d.denomination, oracleBaseCurrencyUnit: baseCurrencyUnit.toString(), reserves: { LINK: linkReserve, USDC: usdcReserve }, account: accountState, proofRoute,
      routeVerified: executionPinsVerified, execute: false, trust: { rpcEvidence: true, protocolGovernanceMutable: true, codePinsVerified, implementationPinsVerified, executionPinsVerified, pinProvenance: 'configured-deployment-pins' },
      deploymentStatus: executionPinsVerified ? 'verified' : Object.values(d).some((value, index) => deploymentKeys.includes(Object.keys(d)[index]) && value) ? 'partial' : 'unconfigured' };
  }
  async function observeAccount(input, options = {}) {
    check(plain(input) && Object.keys(input).every(key => ['ownerAddress', 'factory', 'account', 'chainId'].includes(key)) && address(input.ownerAddress) && input.factory === d.lendingFactory && input.chainId === d.chain && (input.account == null || address(input.account)), 'Choose the fixed Sepolia lending factory and recoverable owner.');
    check(d.lendingFactory && d.codeHashes.lendingFactory, 'The canonical lending account factory is not pinned.');
    const snapshotValue = await snapshot({ owner: input.ownerAddress, ...(input.account ? { account: input.account } : {}) }, options);
    check(snapshotValue.trust.codePinsVerified && snapshotValue.trust.implementationPinsVerified, 'The lending account execution dependencies are not pinned.');
    const observed = snapshotValue.account;
    return { chainId: d.chain, ownerAddress: observed.owner, factory: d.lendingFactory, account: observed.address, deployed: observed.status === 'verified', nonce: observed.nonce, route: observed.route,
      blockNumber: snapshotValue.block.number, blockHash: snapshotValue.block.hash, accountCodeHash: observed.codeHash };
  }
  return Object.freeze({ snapshot, observeAccount });
}

export function readLendingSnapshot(input = {}, options = {}) { return createLendingReader().snapshot(input, options); }
