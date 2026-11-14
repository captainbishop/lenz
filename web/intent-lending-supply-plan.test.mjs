import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, getCreate2Address, keccak256, concat } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { checkLendingSupplyPlan, lendingSupplyVaultAddress, checkLendingSupplyPublicRequest, lendingSupplyPreparation, lendingSupplySignals, buildLendingSupplyAuthorization, lendingSupplyPublicRequest, lendingSupplySelection, buildLendingSupplyReview } from './public/intent-lending-supply.js';

const address = digit => '0x' + digit.repeat(40), hash = digit => '0x' + digit.repeat(64);
const now = 1800000000000;
const config = { ...LENDING_TESTNET, lendingFactory: address('1'), privacyPool: address('2'), supplyFactory: address('3'), verifier: address('4'), hasher: address('5'), supplyVaultCreationCode: '0x60006000', codeHashes: Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'].map(key => [key, hash('9')])) };
const plan = { beneficiary: address('6'), refundRecipient: address('6'), minScaledCredit: '900000000000000000', deadline: '1800000300', salt: hash('7') };
const route = { chainId: config.chain, factory: config.lendingFactory, ...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key => [[key, config[key]],[key + 'CodeHash', config.codeHashes[key]]])) };
function review() {
  const identity = { lenzIdentity:'a'.repeat(64), ownerAddress:address('8'), account:plan.beneficiary, accountId:plan.beneficiary, deployed:true, route, chainId:config.chain };
  const snapshot = { chainId:config.chain, observedAt:now, block:{number:'100',hash:hash('8'),timestamp:String(now/1000),finality:'finalized',requireCanonical:true}, routeVerified:true, trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},account:{status:'verified',address:plan.beneficiary,owner:identity.ownerAddress,codeHash:hash('8'),route},reserves:{LINK:{active:true,frozen:false,paused:false,oneNoteSupplyPossible:true}}, privatePool:{address:config.privacyPool,root:hash('1'),nextIndex:1,commitments:[hash('2')],withdrawals:[]} };
  const selection = lendingSupplySelection({chainId:config.chain,asset:config.link,accountId:'b'.repeat(64),amount:config.denomination,commitment:hash('2')},{recipient:plan.beneficiary,minimum:plan.minScaledCredit,deadline:now+300000,now,config});
  const spend = {commitment:hash('2'),nullifierHash:'0x'+'0'.repeat(63)+'3',root:hash('1'),pathElements:Array(20).fill(hash('0')),pathIndices:Array(20).fill(0)};
  return buildLendingSupplyReview(selection,spend,{snapshot,identity,salt:plan.salt,now,config});
}

test('the private Supply vault commits the exact factory constructor and refund plan', () => {
  assert.deepEqual(checkLendingSupplyPlan(plan),plan);
  const coder=AbiCoder.defaultAbiCoder();
  const terms=[config.link,config.pool,config.aLink,config.denomination,plan.minScaledCredit,plan.deadline,plan.beneficiary,plan.refundRecipient,config.chainId,plan.salt,config.codeHashes.link,config.codeHashes.pool,config.codeHashes.aLink];
  const initHash=keccak256(concat([config.supplyVaultCreationCode,coder.encode(['tuple(address,address,address,uint256,uint256,uint256,address,address,uint256,bytes32,bytes32,bytes32,bytes32)'],[terms])]));
  const salt=keccak256(coder.encode(['uint256','tuple(address,address,uint256,uint256,bytes32)'],[config.chainId,Object.values(plan)]));
  assert.equal(lendingSupplyVaultAddress(plan,{config}),getCreate2Address(config.supplyFactory,salt,initHash).toLowerCase());
  assert.throws(()=>checkLendingSupplyPlan({...plan,refundRecipient:address('7')}),/refund/);
});

test('the proof spends one original note into its durable account without exposing a witness to the sponsor', () => {
  const checked=review(),signals=lendingSupplySignals(checked),proof='0x'+'ab'.repeat(256);
  assert.deepEqual(signals,[BigInt(hash('1')).toString(),'3',BigInt(checked.vault).toString(),'0','0','0']);
  const authorization=buildLendingSupplyAuthorization(checked,{solidity:{proof,publicSignals:signals},publicSignals:signals},{config});
  assert.deepEqual(buildLendingSupplyAuthorization(checked,{solidity:{proof,publicSignals:signals.map(value=>'0x'+BigInt(value).toString(16))},publicSignals:signals},{config}),authorization);
  const request=lendingSupplyPublicRequest({review:checked,authorization},{config});
  assert.deepEqual(checkLendingSupplyPublicRequest(request,{config}),request);
  assert.equal(request.plan.beneficiary,plan.beneficiary);
  assert.ok(!/commitment|pathElements|pathIndices|secret/.test(JSON.stringify(request)));
  assert.deepEqual(lendingSupplyPreparation(checked,{config}),Object.fromEntries(Object.entries(request).filter(([key])=>!['artifactId','proof','publicSignals'].includes(key))));
  assert.throws(()=>checkLendingSupplyPublicRequest({...request,publicSignals:signals.with(3,'1')},{config}),/signals/);
  assert.throws(()=>checkLendingSupplyPublicRequest({...request,ownerAddress:address('1')},{config}),/identity/);
});
