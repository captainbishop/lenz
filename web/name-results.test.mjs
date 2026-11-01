import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNameResult,changedNameAddress} from './public/name-results.js';
const request={system:'ens',network:'testnet',name:'Alice.ETH'};
const result=()=>({version:1,...request,name:'alice.eth',requestedName:'Alice.ETH',chainId:1313161555,identityBinding:'not_verified',state:'address_found',authority:'ethereum:mainnet',coinType:'3460645203',block:{hash:'0x'+'12'.repeat(32),height:'100'},checkedAt:'2026-11-01T13:00:00.000Z',auroraAddress:'0x'+'34'.repeat(20),addressKind:'ens-aurora-record'});
test('client validates name request, chain, authority and explicit unverified identity before display',()=>{
  assert.deepEqual(validateNameResult(result(),request),result());
  for(const change of [{network:'mainnet'},{requestedName:'Bob.ETH'},{chainId:1},{identityBinding:'verified'},{coinType:'60'},{authority:'near:mainnet'},
    {auroraAddress:'0x'+'00'.repeat(20)},{auroraAddress:'0x1234'},{checkedAt:'invalid'},{state:'no_address'},{name:[]},{block:{hash:'invalid',height:'100'}}]){
    assert.throws(()=>validateNameResult({...result(),...change},request));
  }
});
test('address changes and removal are explicit; unrelated names or networks are never compared',()=>{
  const old=result();assert.equal(changedNameAddress(old,result()),false);
  assert.equal(changedNameAddress(old,{...result(),auroraAddress:'0x'+'56'.repeat(20)}),true);
  assert.equal(changedNameAddress(old,{...result(),state:'no_address',auroraAddress:undefined}),true);
  assert.equal(changedNameAddress(old,{...result(),network:'mainnet'}),false);assert.equal(changedNameAddress(old,{...result(),name:'bob.eth'}),false);
});
