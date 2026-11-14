import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {Interface, Wallet, TypedDataEncoder} from 'ethers';
import {createAddressFromString, hexToBytes} from '@ethereumjs/util';
import {createBlock} from '@ethereumjs/block';
import {compileSource} from './compiler.mjs';
import {createLocalEvm} from './local-evm.mjs';

const source = await readFile(process.env.LENZ_LENDING_ACCOUNT_SOURCE || new URL('./contracts/LendingAccount.sol', import.meta.url), 'utf8');
// The external Aave fixture moves real local tokens and models indexed receipts.
// It is not a live protocol deployment or a proof of Aave governance behavior.
const fixtureSource = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract LendingTokenFixture {
 mapping(address => uint256) public balanceOf;
 mapping(address => mapping(address => uint256)) public allowance;
 uint256 public shortfall;
 uint256 public extraDebit;
 bool public ignoreClear;
 address public callbackTarget;
 bytes public callbackData;
 bool public callbackSucceeded;
 function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
 function configure(uint256 amount, bool ignoresClear) external { shortfall = amount; ignoreClear = ignoresClear; }
 function setExtraDebit(uint256 amount) external { extraDebit = amount; }
 function attack(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
 function approve(address spender, uint256 amount) external returns (bool) { if (amount != 0 || !ignoreClear) allowance[msg.sender][spender] = amount; return true; }
 function transfer(address to, uint256 amount) external returns (bool) {
  balanceOf[msg.sender] -= amount + extraDebit; balanceOf[to] += amount - shortfall;
  if (callbackTarget != address(0)) { address target = callbackTarget; callbackTarget = address(0); (callbackSucceeded,) = target.call(callbackData); }
  return true;
 }
 function transferFrom(address from, address to, uint256 amount) external returns (bool) { allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount - shortfall; return true; }
}
contract LendingReceiptFixture {
 address public POOL;
 address public UNDERLYING_ASSET_ADDRESS;
 uint256 public index = 1200000000000000000000000000;
 bool public allowZeroScaled;
 mapping(address => uint256) public scaledBalanceOf;
 constructor(address token) { UNDERLYING_ASSET_ADDRESS = token; }
 function setPool(address value) external { POOL = value; }
 function setUnderlying(address value) external { UNDERLYING_ASSET_ADDRESS = value; }
 function setIndex(uint256 value) external { index = value; }
 function setAllowZeroScaled(bool value) external { allowZeroScaled = value; }
 function balanceOf(address owner) external view returns (uint256) { return (scaledBalanceOf[owner] * index + 5e26) / 1e27; }
 function mint(address owner, uint256 amount) external { require(msg.sender == POOL); uint256 scaled = (amount * 1e27 + index / 2) / index; require(scaled > 0 || allowZeroScaled); scaledBalanceOf[owner] += scaled; }
 function burn(address owner, uint256 amount) external { require(msg.sender == POOL); uint256 scaled = (amount * 1e27 + index / 2) / index; require(scaled > 0 || allowZeroScaled); scaledBalanceOf[owner] -= scaled; }
 function release(address to, uint256 amount) external { require(msg.sender == POOL); LendingTokenFixture(UNDERLYING_ASSET_ADDRESS).transfer(to, amount); }
}
contract LendingPoolFixture {
 struct ReserveData { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }
 LendingTokenFixture public immutable link;
 LendingTokenFixture public immutable usdc;
 LendingReceiptFixture public immutable aLink;
 LendingReceiptFixture public immutable debt;
 uint128 public rate = 30000000000000000000000000;
 uint256 public projectedDebtIndex;
 uint256 public debtExcess;
 uint256 public collateralExcess;
 address public callbackTarget;
 bytes public callbackData;
 bool public callbackSucceeded;
 constructor(address l, address u, address a, address d) { link = LendingTokenFixture(l); usdc = LendingTokenFixture(u); aLink = LendingReceiptFixture(a); debt = LendingReceiptFixture(d); }
 function getReserveData(address asset) external view returns (ReserveData memory value) { require(asset == address(link) || asset == address(usdc)); value.currentVariableBorrowRate = rate; if (asset == address(link)) { value.aTokenAddress = address(aLink); value.liquidityIndex = uint128(aLink.index()); } else { value.variableDebtTokenAddress = address(debt); value.variableBorrowIndex = uint128(debt.index()); } }
 function getReserveNormalizedIncome(address asset) external view returns (uint256) { require(asset == address(link)); return aLink.index(); }
 function getReserveNormalizedVariableDebt(address asset) external view returns (uint256) { require(asset == address(usdc)); return projectedDebtIndex == 0 ? debt.index() : projectedDebtIndex; }
 function setRate(uint128 value) external { rate = value; }
 function setProjectedDebtIndex(uint256 value) external { projectedDebtIndex = value; }
 function setDebtExcess(uint256 value) external { debtExcess = value; }
 function setCollateralExcess(uint256 value) external { collateralExcess = value; }
 function attack(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
 function supply(address asset, uint256 amount, address owner, uint16 referral) external { require(asset == address(link) && referral == 0); link.transferFrom(msg.sender, address(aLink), amount); aLink.mint(owner, amount); }
 function borrow(address asset, uint256 amount, uint256 mode, uint16 referral, address owner) external {
  require(asset == address(usdc) && mode == 2 && referral == 0 && owner == msg.sender);
  debt.mint(owner, amount + debtExcess);
  projectedDebtIndex = 0;
  if (callbackTarget != address(0)) { (callbackSucceeded,) = callbackTarget.call(callbackData); }
  usdc.transfer(msg.sender, amount);
 }
 function repay(address asset, uint256 amount, uint256 mode, address owner) external returns (uint256 paid) {
  require(asset == address(usdc) && mode == 2 && owner == msg.sender);
  uint256 owed = debt.balanceOf(owner); paid = amount < owed ? amount : owed;
  usdc.transferFrom(msg.sender, address(this), paid); debt.burn(owner, paid);
 }
 function withdraw(address asset, uint256 amount, address recipient) external returns (uint256) {
  require(asset == address(link)); aLink.burn(msg.sender, amount + collateralExcess); aLink.release(recipient, amount); return amount;
 }
 function getUserAccountData(address owner) external view returns (uint256 collateral, uint256 borrowed, uint256 available, uint256 threshold, uint256 ltv, uint256 health) {
  collateral = aLink.balanceOf(owner) * 30e8 / 1e18; borrowed = debt.balanceOf(owner) * 100; threshold = 7500; ltv = 7000;
  uint256 power = collateral * 70 / 100; available = borrowed < power ? power - borrowed : 0;
  health = borrowed == 0 ? type(uint256).max : collateral * 75 / 100 * 1e18 / borrowed;
 }
}`;
const artifacts = Object.fromEntries(['LendingAccount', 'LendingAccountFactory'].map(name => [name, compileSource('LendingAccount.sol', source, name)]));
for (const name of ['LendingTokenFixture', 'LendingReceiptFixture', 'LendingPoolFixture']) artifacts[name] = compileSource('LendingAccountFixtures.sol', fixtureSource, name);
const orderTypes = {Order:[{name:'action',type:'uint8'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'amount',type:'uint256'},{name:'recipient',type:'address'},{name:'minResult',type:'uint256'},{name:'maxDebt',type:'uint256'},{name:'minHealthFactor',type:'uint256'},{name:'maxBorrowRateRay',type:'uint256'}]};
const cancelTypes = {Cancel:[{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
const transferTypes = {Transfer:[{name:'asset',type:'uint8'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'amount',type:'uint256'},{name:'recipient',type:'address'}]};

async function fixture({incomeIndex,debtIndex}={}) {
 const evm = await createLocalEvm(), owner = Wallet.createRandom();
 function contract(name, address) {
  const iface = new Interface(artifacts[name].abi), target = createAddressFromString(address.toString());
  return {address:target.toString(),iface,
   send:(method,values=[])=>evm.send(iface.encodeFunctionData(method,values),target),
   read:async(method,values=[])=>iface.decodeFunctionResult(method,await evm.call(iface.encodeFunctionData(method,values),target))};
 }
 async function deploy(name,args=[]) {
  const iface = new Interface(artifacts[name].abi), result = await evm.send('0x'+artifacts[name].evm.bytecode.object+iface.encodeDeploy(args).slice(2));
  return contract(name,result.createdAddress);
 }
 const link = await deploy('LendingTokenFixture'), usdc = await deploy('LendingTokenFixture');
 const aLink = await deploy('LendingReceiptFixture',[link.address]), debt = await deploy('LendingReceiptFixture',[usdc.address]);
 if (incomeIndex) await aLink.send('setIndex',[incomeIndex]);
 if (debtIndex) await debt.send('setIndex',[debtIndex]);
 const pool = await deploy('LendingPoolFixture',[link.address,usdc.address,aLink.address,debt.address]);
 await aLink.send('setPool',[pool.address]); await debt.send('setPool',[pool.address]);
 const factory = await deploy('LendingAccountFactory',[pool.address,link.address,usdc.address,aLink.address,debt.address,31337n]);
 const predicted = (await factory.read('accountAddress',[owner.address]))[0];
 await factory.send('deploy',[owner.address]);
 const account = contract('LendingAccount',predicted), domain = {name:'LenzLendingAccount',version:'1',chainId:31337,verifyingContract:account.address};
 const order = (changes={})=>({action:0,nonce:0n,deadline:1000n,amount:5000000n,recipient:account.address,minResult:5000000n,maxDebt:5000001n,minHealthFactor:4n*10n**18n,maxBorrowRateRay:4n*10n**25n,...changes});
 const sign = (value,signer=owner,scope=domain)=>signer.signTypedData(scope,orderTypes,value);
 const atTime = async (method,args,timestamp)=> {
  const result = await evm.vm.evm.runCall({caller:evm.sender,to:createAddressFromString(account.address),data:hexToBytes(account.iface.encodeFunctionData(method,args)),gasLimit:10000000n,
   block:createBlock({header:{timestamp,gasLimit:30000000n}},{common:evm.vm.common})});
  assert(!result.execResult.exceptionError,result.execResult.exceptionError?.error); return result;
 };
 await usdc.send('mint',[pool.address,100000000000n]);
 await link.send('mint',[evm.sender.toString(),1000000000000000000n]);
 await link.send('approve',[pool.address,1000000000000000000n]);
 await pool.send('supply',[link.address,1000000000000000000n,account.address,0]);
 return {evm,owner,link,usdc,aLink,debt,pool,factory,account,domain,order,sign,atTime,deploy,contract};
}

test('a relayed owner permission borrows exact test USDC into the same collateral account once',async()=>{
 const f = await fixture(), order = f.order(), signature = await f.sign(order);
 assert.equal((await f.account.read('orderDigest',[order]))[0],TypedDataEncoder.hash(f.domain,orderTypes,order));
 await f.account.send('execute',[order,signature]);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],5000000n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000000n);
 assert.equal((await f.account.read('nonce'))[0],1n);
 assert.equal((await f.debt.read('balanceOf',[f.owner.address]))[0],0n);
 await assert.rejects(f.account.send('execute',[order,signature]),/revert/);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],5000000n);
});

test('a separately signed repayment spends only the capped account USDC and clears debt and allowance',async()=>{
 const f = await fixture(), borrow = f.order();
 await f.account.send('execute',[borrow,await f.sign(borrow)]);
 const repay = f.order({action:1,nonce:1n,amount:5000000n,minResult:5000000n,maxDebt:0n,minHealthFactor:0n,maxBorrowRateRay:0n});
 await f.account.send('execute',[repay,await f.sign(repay)]);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.usdc.read('allowance',[f.account.address,f.pool.address]))[0],0n);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 assert.equal((await f.account.read('nonce'))[0],2n);
});

test('the same owner withdraws actual LINK collateral after repayment while unsafe withdrawal reverts',async()=>{
 const f = await fixture(), borrow = f.order();
 await f.account.send('execute',[borrow,await f.sign(borrow)]);
 const withdrawal = f.order({action:2,nonce:1n,amount:1000000000000000000n,recipient:f.owner.address,minResult:1000000000000000000n,maxDebt:5000001n,minHealthFactor:2n*10n**18n,maxBorrowRateRay:0n});
 await assert.rejects(f.account.send('execute',[withdrawal,await f.sign(withdrawal)]),/revert/);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 assert.equal((await f.account.read('nonce'))[0],1n);
 const repay = f.order({action:1,nonce:1n,minResult:5000000n,maxDebt:0n,minHealthFactor:0n,maxBorrowRateRay:0n});
 await f.account.send('execute',[repay,await f.sign(repay)]);
 const exit = {...withdrawal,nonce:2n,maxDebt:0n};
 await f.account.send('execute',[exit,await f.sign(exit)]);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],1000000000000000000n);
 assert.equal((await f.link.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.account.read('nonce'))[0],3n);
});

test('an explicit owner cancellation invalidates the old permission without touching collateral or debt',async()=>{
 const f = await fixture(), old = f.order(), original = await f.sign(old);
 const cancellation = {nonce:0n,deadline:1000n}, signature = await f.owner.signTypedData(f.domain,cancelTypes,cancellation);
 await f.account.send('cancel',[cancellation.nonce,cancellation.deadline,signature]);
 assert.equal((await f.account.read('nonce'))[0],1n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 await assert.rejects(f.account.send('execute',[old,original]),/revert/);
 const next = f.order({nonce:1n});
 await f.account.send('execute',[next,await f.sign(next)]);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000000n);
});

test('changed terms, a wrong owner, another chain or account and noncanonical signatures cannot consume the account nonce',async()=>{
 const f = await fixture(), order = f.order(), signature = await f.sign(order);
 const mutations = {action:1,nonce:1n,deadline:999n,amount:4000000n,recipient:f.owner.address,minResult:4000000n,maxDebt:6000000n,minHealthFactor:3n*10n**18n,maxBorrowRateRay:5n*10n**25n};
 for (const [field,value] of Object.entries(mutations)) {
  const changed = {...order,[field]:value};
  assert.notEqual((await f.account.read('orderDigest',[changed]))[0],(await f.account.read('orderDigest',[order]))[0]);
  await assert.rejects(f.account.send('execute',[changed,signature]),/revert/);
 }
 for (const bad of [await f.sign(order,Wallet.createRandom()),await f.sign(order,f.owner,{...f.domain,chainId:11155111}),await f.sign(order,f.owner,{...f.domain,verifyingContract:f.factory.address}),signature.slice(0,-2),'0x'+'00'.repeat(65)]) {
  await assert.rejects(f.account.send('execute',[order,bad]),/revert/);
 }
 const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
 const s = BigInt('0x'+signature.slice(66,130)), v = Number.parseInt(signature.slice(130),16);
 const twin = signature.slice(0,66)+(n-s).toString(16).padStart(64,'0')+(v===27?'1c':'1b');
 await assert.rejects(f.account.send('execute',[order,twin]),/revert/);
 assert.equal((await f.account.read('nonce'))[0],0n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
 await f.account.send('execute',[order,signature]);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],5000000n);
});

test('the signed expiry and cancellation expiry hold at the exact deadline',async()=>{
 const f = await fixture(), order = f.order();
 await assert.rejects(f.atTime('execute',[order,await f.sign(order)],1000n),/revert/);
 const cancellation = {nonce:0n,deadline:1000n}, signature = await f.owner.signTypedData(f.domain,cancelTypes,cancellation);
 await assert.rejects(f.atTime('cancel',[0n,1000n,signature],1000n),/revert/);
 assert.equal((await f.account.read('nonce'))[0],0n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
 await f.account.send('execute',[order,await f.sign(order)]);
 assert.equal((await f.account.read('nonce'))[0],1n);
});

test('borrow rate, resulting debt and post-borrow health bounds revert the whole action',async()=>{
 for (const kind of ['rate','debt','health','rate-after']) {
  const f = await fixture();
  let order = f.order();
  if (kind==='rate') await f.pool.send('setRate',[5n*10n**25n]);
  if (kind==='debt') order = f.order({maxDebt:4000000n});
  if (kind==='health') order = f.order({minHealthFactor:5n*10n**18n});
  if (kind==='rate-after') await f.pool.send('attack',[f.pool.address,f.pool.iface.encodeFunctionData('setRate',[5n*10n**25n])]);
  await assert.rejects(f.account.send('execute',[order,await f.sign(order)]),/revert/);
  assert.equal((await f.account.read('nonce'))[0],0n);
  assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
  assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],0n);
  assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 }
});

test('existing account funds cannot disguise short new borrow credit or excess debt',async()=>{
 for (const kind of ['credit','debt']) {
  const f = await fixture(), order = f.order({recipient:f.owner.address,maxDebt:6000000n});
  await f.usdc.send('mint',[f.account.address,7000000n]);
  if (kind==='credit') await f.usdc.send('configure',[1n,false]);
  else await f.pool.send('setDebtExcess',[10n]);
  await assert.rejects(f.account.send('execute',[order,await f.sign(order)]),/revert/);
  assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],7000000n);
  assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],0n);
  assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
  assert.equal((await f.account.read('nonce'))[0],0n);
 }
 const f = await fixture(), order = f.order({recipient:f.owner.address});
 await f.usdc.send('mint',[f.account.address,7000000n]);
 await f.account.send('execute',[order,await f.sign(order)]);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],7000000n);
 assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],5000000n);
});

test('repayment uses the actual debt below its signed cap and rejects an uncleared partial allowance',async()=>{
 for (const ignoreClear of [true,false]) {
  const f = await fixture(), borrow = f.order();
  await f.account.send('execute',[borrow,await f.sign(borrow)]);
  await f.usdc.send('mint',[f.account.address,1000000n]);
  const repay = f.order({action:1,nonce:1n,amount:6000000n,minResult:5000000n,maxDebt:0n,minHealthFactor:0n,maxBorrowRateRay:0n});
  await f.usdc.send('configure',[0n,ignoreClear]);
  if (ignoreClear) {
   await assert.rejects(f.account.send('execute',[repay,await f.sign(repay)]),/revert/);
   assert.equal((await f.account.read('nonce'))[0],1n);
   assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000000n);
   assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],6000000n);
  } else {
   await f.account.send('execute',[repay,await f.sign(repay)]);
   assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],1000000n);
   assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
   assert.equal((await f.account.read('nonce'))[0],2n);
  }
  assert.equal((await f.usdc.read('allowance',[f.account.address,f.pool.address]))[0],0n);
 }
});

test('a protocol callback cannot reenter a second separately signed account operation',async()=>{
 const f = await fixture(), order = f.order(), cancellation = {nonce:1n,deadline:1000n};
 const signature = await f.owner.signTypedData(f.domain,cancelTypes,cancellation);
 await f.pool.send('attack',[f.account.address,f.account.iface.encodeFunctionData('cancel',[1n,1000n,signature])]);
 await f.account.send('execute',[order,await f.sign(order)]);
 assert.equal((await f.pool.read('callbackSucceeded'))[0],false);
 assert.equal((await f.account.read('nonce'))[0],1n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000000n);
});

test('the factory keeps the same deterministic owner address and changed receipt identities fail closed',async()=>{
 const f = await fixture();
 assert.equal((await f.factory.read('accountAddress',[f.owner.address]))[0].toLowerCase(),f.account.address.toLowerCase());
 await f.factory.send('deploy',[f.owner.address]);
 assert.equal((await f.account.read('owner'))[0].toLowerCase(),f.owner.address.toLowerCase());
 assert.notEqual((await f.factory.read('accountAddress',[Wallet.createRandom().address]))[0].toLowerCase(),f.account.address.toLowerCase());
 await f.debt.send('setUnderlying',[f.link.address]);
 const order = f.order();
 await assert.rejects(f.account.send('execute',[order,await f.sign(order)]),/revert/);
 assert.equal((await f.account.read('nonce'))[0],0n);
 const cancellation = {nonce:0n,deadline:1000n}, signature = await f.owner.signTypedData(f.domain,cancelTypes,cancellation);
 await f.account.send('cancel',[0n,1000n,signature]);
 assert.equal((await f.account.read('nonce'))[0],1n);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
});

test('a withdrawal cannot receive the signed amount while burning extra collateral',async()=>{
 const f = await fixture(), order = f.order({action:2,amount:500000000000000000n,recipient:f.owner.address,minResult:500000000000000000n,maxDebt:0n,minHealthFactor:2n*10n**18n,maxBorrowRateRay:0n});
 await f.pool.send('setCollateralExcess',[100000000000000000n]);
 await assert.rejects(f.account.send('execute',[order,await f.sign(order)]),/revert/);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],0n);
 assert.equal((await f.account.read('nonce'))[0],0n);
 await f.pool.send('setCollateralExcess',[0n]);
 await f.account.send('execute',[order,await f.sign(order)]);
 // RAY rounding leaves one less underlying wei after this half-LINK withdrawal.
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],499999999999999999n);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],500000000000000000n);
});

test('separate owner transfers recover retained LINK and USDC even when the Aave receipt is unavailable',async()=>{
 const f = await fixture(), withdrawal = f.order({action:2,amount:1000000000000000000n,minResult:1000000000000000000n,maxDebt:0n,minHealthFactor:2n*10n**18n,maxBorrowRateRay:0n});
 await f.account.send('execute',[withdrawal,await f.sign(withdrawal)]);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.link.read('balanceOf',[f.account.address]))[0],1000000000000000000n);
 await f.usdc.send('mint',[f.account.address,7000000n]);
 await f.debt.send('setUnderlying',[f.link.address]);
 const transfer = {asset:0,nonce:1n,deadline:1000n,amount:1000000000000000000n,recipient:f.owner.address};
 const signature = await f.owner.signTypedData(f.domain,transferTypes,transfer);
 await f.account.send('transferFunds',[transfer,signature]);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],1000000000000000000n);
 assert.equal((await f.link.read('balanceOf',[f.account.address]))[0],0n);
 const usdcTransfer = {...transfer,asset:1,nonce:2n,amount:7000000n};
 await f.account.send('transferFunds',[usdcTransfer,await f.owner.signTypedData(f.domain,transferTypes,usdcTransfer)]);
 assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],7000000n);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],0n);
 assert.equal((await f.usdc.read('allowance',[f.account.address,f.pool.address]))[0],0n);
 assert.equal((await f.account.read('nonce'))[0],3n);
});

test('grown Aave indices bind exact scaled debt and collateral instead of an underlying one-unit gap',async()=>{
 const f = await fixture({incomeIndex:5n*10n**27n,debtIndex:5n*10n**27n});
 const borrow = f.order({amount:5000003n,minResult:5000003n,maxDebt:5000005n});
 await f.account.send('execute',[borrow,await f.sign(borrow)]);
 // Aave half-up RAY division mints 1,000,001 scaled units, worth 5,000,005.
 assert.equal((await f.debt.read('scaledBalanceOf',[f.account.address]))[0],1000001n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000005n);
 const repay = f.order({action:1,nonce:1n,amount:2000003n,minResult:2000003n,maxDebt:3000000n,minHealthFactor:0n,maxBorrowRateRay:0n});
 await f.account.send('execute',[repay,await f.sign(repay)]);
 assert.equal((await f.debt.read('scaledBalanceOf',[f.account.address]))[0],600000n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],3000000n);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],3000000n);
 const withdrawal = f.order({action:2,nonce:2n,amount:500000000000000003n,minResult:500000000000000003n,recipient:f.owner.address,maxDebt:3000000n,minHealthFactor:3n*10n**18n,maxBorrowRateRay:0n});
 await f.account.send('execute',[withdrawal,await f.sign(withdrawal)]);
 assert.equal((await f.aLink.read('scaledBalanceOf',[f.account.address]))[0],99999999999999999n);
 assert.equal((await f.aLink.read('balanceOf',[f.account.address]))[0],499999999999999995n);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],500000000000000003n);
});

test('the observed Sepolia indices accept genuine rounded borrow and withdrawal amounts',async()=>{
 const f = await fixture({incomeIndex:58085439691859778533543705579n,debtIndex:3820083409558281277015113718n});
 const borrow = f.order({amount:5000002n,minResult:5000002n,maxDebt:5000003n});
 await f.account.send('execute',[borrow,await f.sign(borrow)]);
 assert.equal((await f.debt.read('scaledBalanceOf',[f.account.address]))[0],1308872n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000000n);
 const withdrawal = f.order({action:2,nonce:1n,amount:500000000000000000n,minResult:500000000000000000n,recipient:f.owner.address,maxDebt:5000003n,minHealthFactor:2n*10n**18n,maxBorrowRateRay:0n});
 await f.account.send('execute',[withdrawal,await f.sign(withdrawal)]);
 assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],500000000000000000n);
});

test('the first borrow uses the stored index actually applied by Aave rather than an unused normalized projection',async()=>{
 const f = await fixture({debtIndex:5n*10n**27n}), order = f.order({amount:5000003n,minResult:5000003n,maxDebt:5000005n});
 await f.pool.send('setProjectedDebtIndex',[6n*10n**27n]);
 assert.equal((await f.pool.read('getReserveNormalizedVariableDebt',[f.usdc.address]))[0],6n*10n**27n);
 await f.account.send('execute',[order,await f.sign(order)]);
 assert.equal((await f.debt.read('scaledBalanceOf',[f.account.address]))[0],1000001n);
 assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],5000005n);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],5000003n);
});

test('free-fund transfer permissions bind every term, the owner, chain and account',async()=>{
 const f = await fixture(), transfer = {asset:1,nonce:0n,deadline:1000n,amount:5000000n,recipient:f.owner.address};
 await f.usdc.send('mint',[f.account.address,7000000n]);
 await f.link.send('mint',[f.account.address,7000000n]);
 const signature = await f.owner.signTypedData(f.domain,transferTypes,transfer);
 assert.equal((await f.account.read('transferDigest',[transfer]))[0],TypedDataEncoder.hash(f.domain,transferTypes,transfer));
 const changes = {asset:0,nonce:1n,deadline:999n,amount:4000000n,recipient:Wallet.createRandom().address};
 for (const [field,value] of Object.entries(changes)) {
  const altered = {...transfer,[field]:value};
  assert.notEqual((await f.account.read('transferDigest',[altered]))[0],(await f.account.read('transferDigest',[transfer]))[0]);
  await assert.rejects(f.account.send('transferFunds',[altered,signature]),/revert/);
 }
 const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
 const s = BigInt('0x'+signature.slice(66,130)), v = Number.parseInt(signature.slice(130),16);
 const highS = signature.slice(0,66)+(n-s).toString(16).padStart(64,'0')+(v===27?'1c':'1b');
 const invalid = [
  await Wallet.createRandom().signTypedData(f.domain,transferTypes,transfer),
  await f.owner.signTypedData({...f.domain,chainId:11155111},transferTypes,transfer),
  await f.owner.signTypedData({...f.domain,verifyingContract:f.factory.address},transferTypes,transfer),
  await f.owner.signTypedData({...f.domain,name:'AnotherAccount'},transferTypes,transfer),
  await f.owner.signTypedData({...f.domain,version:'2'},transferTypes,transfer),
  signature.slice(0,-2), '0x'+'00'.repeat(65), highS,
 ];
 for (const bad of invalid) await assert.rejects(f.account.send('transferFunds',[transfer,bad]),/revert/);
 assert.equal((await f.account.read('nonce'))[0],0n);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],7000000n);
 assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],0n);
 await f.account.send('transferFunds',[transfer,signature]);
 assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],2000000n);
 assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],5000000n);
});

test('transfer expiry, replay and cancellation use the same account nonce as protocol orders',async()=>{
 for (const winner of ['transfer','cancel','order']) {
  const f = await fixture(), transfer = {asset:1,nonce:0n,deadline:1000n,amount:5000000n,recipient:f.owner.address};
  await f.usdc.send('mint',[f.account.address,7000000n]);
  const signature = await f.owner.signTypedData(f.domain,transferTypes,transfer);
  const cancellation = await f.owner.signTypedData(f.domain,cancelTypes,{nonce:0n,deadline:1000n});
  const order = f.order(), orderSignature = await f.sign(order);
  await assert.rejects(f.atTime('transferFunds',[transfer,signature],1000n),/revert/);
  assert.equal((await f.account.read('nonce'))[0],0n);
  if (winner==='transfer') {
   await f.account.send('transferFunds',[transfer,signature]);
   await assert.rejects(f.account.send('cancel',[0n,1000n,cancellation]),/revert/);
   await assert.rejects(f.account.send('execute',[order,orderSignature]),/revert/);
  } else if (winner==='cancel') await f.account.send('cancel',[0n,1000n,cancellation]);
  else await f.account.send('execute',[order,orderSignature]);
  await assert.rejects(f.account.send('transferFunds',[transfer,signature]),/revert/);
  assert.equal((await f.account.read('nonce'))[0],1n);
  assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],winner==='transfer'?5000000n:0n);
  assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],winner==='transfer'?2000000n:winner==='order'?12000000n:7000000n);
 }
});

test('invalid or unfunded free-fund transfers preserve tokens and authority',async()=>{
 const f = await fixture(), transfer = {asset:1,nonce:0n,deadline:1000n,amount:5000000n,recipient:f.owner.address};
 await f.usdc.send('mint',[f.account.address,7000000n]);
 const invalid = [
  {...transfer,asset:2}, {...transfer,amount:0n}, {...transfer,amount:7000001n},
  {...transfer,recipient:'0x'+'00'.repeat(20)}, {...transfer,recipient:f.account.address}, {...transfer,asset:0},
 ];
 for (const value of invalid) {
  await assert.rejects(f.account.send('transferFunds',[value,await f.owner.signTypedData(f.domain,transferTypes,value)]),/revert/);
  assert.equal((await f.account.read('nonce'))[0],0n);
  assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],7000000n);
  assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],0n);
 }
});

test('recovery rejects short recipient credit and excess source debit with complete rollback',async()=>{
 for (const asset of [0,1]) for (const kind of ['credit','debit']) {
  const f = await fixture(), token = asset===0?f.link:f.usdc;
  const transfer = {asset,nonce:0n,deadline:1000n,amount:5000000n,recipient:f.owner.address};
  await token.send('mint',[f.account.address,7000000n]);
  if (kind==='credit') await token.send('configure',[1n,false]);
  else await token.send('setExtraDebit',[1n]);
  const signature = await f.owner.signTypedData(f.domain,transferTypes,transfer);
  await assert.rejects(f.account.send('transferFunds',[transfer,signature]),/revert/);
  assert.equal((await f.account.read('nonce'))[0],0n);
  assert.equal((await token.read('balanceOf',[f.account.address]))[0],7000000n);
  assert.equal((await token.read('balanceOf',[f.owner.address]))[0],0n);
  await token.send('configure',[0n,false]);
  await token.send('setExtraDebit',[0n]);
  await f.account.send('transferFunds',[transfer,signature]);
  assert.equal((await token.read('balanceOf',[f.account.address]))[0],2000000n);
  assert.equal((await token.read('balanceOf',[f.owner.address]))[0],5000000n);
 }
});

test('free-fund recovery rejects changed underlying code and cross-operation reentry',async()=>{
 for (const kind of ['code','cancel','borrow']) {
  const f = await fixture(), transfer = {asset:1,nonce:0n,deadline:1000n,amount:5000000n,recipient:f.owner.address};
  await f.usdc.send('mint',[f.account.address,7000000n]);
  const signature = await f.owner.signTypedData(f.domain,transferTypes,transfer);
  if (kind==='code') {
   const tokenAddress = createAddressFromString(f.usdc.address), original = await f.evm.vm.stateManager.getCode(tokenAddress);
   // Appending STOP preserves token behavior while changing the frozen runtime hash.
   await f.evm.vm.stateManager.putCode(tokenAddress,Uint8Array.from([...original,0]));
   await assert.rejects(f.account.send('transferFunds',[transfer,signature]),/revert/);
   assert.equal((await f.account.read('nonce'))[0],0n);
   assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],7000000n);
   await f.evm.vm.stateManager.putCode(tokenAddress,original);
  } else {
   let data;
   if (kind==='cancel') {
    const cancellation = await f.owner.signTypedData(f.domain,cancelTypes,{nonce:1n,deadline:1000n});
    data = f.account.iface.encodeFunctionData('cancel',[1n,1000n,cancellation]);
   } else {
    const borrow = f.order({nonce:1n,recipient:f.owner.address});
    data = f.account.iface.encodeFunctionData('execute',[borrow,await f.sign(borrow)]);
   }
   await f.usdc.send('attack',[f.account.address,data]);
  }
  await f.account.send('transferFunds',[transfer,signature]);
  if (kind!=='code') assert.equal((await f.usdc.read('callbackSucceeded'))[0],false);
  assert.equal((await f.account.read('nonce'))[0],1n);
  assert.equal((await f.debt.read('balanceOf',[f.account.address]))[0],0n);
  assert.equal((await f.usdc.read('balanceOf',[f.account.address]))[0],2000000n);
  assert.equal((await f.usdc.read('balanceOf',[f.owner.address]))[0],5000000n);
 }
});

test('tiny withdrawals reject zero-scaled burns and accept the first half-up indexed amount',async()=>{
 for (const faultyReceipt of [false,true]) {
  const f = await fixture({incomeIndex:5n*10n**27n});
  if (faultyReceipt) await f.aLink.send('setAllowZeroScaled',[true]);
  const withdrawal = f.order({action:2,amount:2n,minResult:2n,recipient:f.owner.address,maxDebt:0n,minHealthFactor:2n*10n**18n,maxBorrowRateRay:0n});
  await assert.rejects(f.account.send('execute',[withdrawal,await f.sign(withdrawal)]),/revert/);
  assert.equal((await f.account.read('nonce'))[0],0n);
  assert.equal((await f.aLink.read('scaledBalanceOf',[f.account.address]))[0],200000000000000000n);
  assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],0n);
  // At 5 RAY, 2 underlying units round to zero scaled units; 3 round to one.
  const boundary = {...withdrawal,amount:3n,minResult:3n};
  await f.account.send('execute',[boundary,await f.sign(boundary)]);
  assert.equal((await f.aLink.read('scaledBalanceOf',[f.account.address]))[0],199999999999999999n);
  assert.equal((await f.link.read('balanceOf',[f.owner.address]))[0],3n);
  assert.equal((await f.account.read('nonce'))[0],1n);
 }
});
