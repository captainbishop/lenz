import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,TypedDataEncoder} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {createIdentity,signValue} from './public/peer-crypto.js';
import {receivingTerms,receivingWalletData,signReceivingInstruction,verifyReceivingInstruction,encodeReceivingInstruction,decodeReceivingInstruction,receivingLink,RECEIVING_TTL,RECEIVING_DOMAIN} from './public/receiving-instructions.js';
import {paymentRecipient,checkRecipientTransfer} from './public/payment-recipient.js';
import {createWalletSession} from './public/evm-wallet.js';
import {transferAssets,prepareTransfer} from './public/evm-transfer.js';
import {transferFixture} from './evm-transfer-fixtures.mjs';

const wallet=new Wallet('0x'+'17'.repeat(32)),other=new Wallet('0x'+'18'.repeat(32)),now=Date.now();
async function fixture(chainId='0x1',asset='native'){
 const identity=await createIdentity('Johnson'),terms=await receivingTerms(identity.profile,{chainId,address:wallet.address},asset,{now}),data=receivingWalletData(terms,{now});
 const signature=await wallet.signTypedData(data.domain,data.types,data.message),instruction=await signReceivingInstruction(identity,terms,signature,{now});
 return {identity,terms,data,signature,instruction};
}
test('independent EIP-712 wallet and Lenz signatures resolve exact native and token destinations',async()=>{
 for(const chain of ['0x1','0x2105','0xa4b1'])for(const asset of transferAssets(chain)){
  const f=await fixture(chain,asset.id),verified=await verifyReceivingInstruction(f.instruction,{recipientId:f.identity.profile.id,chainId:chain,asset:asset.id,now});
  assert.equal(verified.terms.address,wallet.address.toLowerCase());assert.equal(verified.terms.visibility,'public');
  const resolved=await paymentRecipient(receivingLink(verified,'https://lenz.example'),{now});assert.equal(resolved.asset,asset.id);assert.equal(resolved.chainId,chain);
  assert.equal(TypedDataEncoder.hash(f.data.domain,f.data.types,f.data.message).length,66);
 }
});
test('each signed receiving field rejects substitution even if the other signature is refreshed',async()=>{
 const f=await fixture();
 for(const patch of [{address:other.address.toLowerCase()},{asset:transferAssets('0x1')[1].id},{chainId:'0x2105'},{issuedAt:now-1,expiresAt:now-1+RECEIVING_TTL},{nonce:'a'.repeat(64)},{visibility:'private'},{version:2},{expiresAt:now+RECEIVING_TTL+1}]){
  const changed=structuredClone(f.instruction);Object.assign(changed.terms,patch);changed.signature=await signValue(f.identity,[RECEIVING_DOMAIN,changed.terms,changed.walletSignature]);
  await assert.rejects(verifyReceivingInstruction(changed,{now}));
 }
 const changed=structuredClone(f.instruction);changed.terms.profile.name='Someone else';await assert.rejects(verifyReceivingInstruction(changed,{now}),/signed/);
 const stranger=await createIdentity('Johnson'),substituted=structuredClone(f.instruction);substituted.terms.profile=stranger.profile;substituted.signature=await signValue(stranger,[RECEIVING_DOMAIN,substituted.terms,substituted.walletSignature]);await assert.rejects(verifyReceivingInstruction(substituted,{now}),/ownership/);
});
test('missing signatures, extra fields, wrong person, stale and future links are rejected',async()=>{
 const f=await fixture();
 for(const patch of [{signature:'0'.repeat(128)},{walletSignature:'0x'+'00'.repeat(65)},{type:'other'},{extra:true}])await assert.rejects(verifyReceivingInstruction({...f.instruction,...patch},{now}));
 await assert.rejects(verifyReceivingInstruction(f.instruction,{now:now+RECEIVING_TTL}),/expired/);
 await assert.rejects(verifyReceivingInstruction(f.instruction,{now:now-1}),/valid/);
 await assert.rejects(verifyReceivingInstruction(f.instruction,{now,recipientId:'f'.repeat(64)}),/another/);
 await assert.rejects(verifyReceivingInstruction(f.instruction,{now,chainId:'0x2105'}),/network/);
 await assert.rejects(verifyReceivingInstruction(f.instruction,{now,asset:transferAssets('0x1')[1].id}),/asset/);
 const recovered={...f.identity,access:'recovered-chat'};await assert.rejects(signReceivingInstruction(recovered,f.terms,f.signature,{now}));
});
test('links use bounded canonical encoding and never accept arbitrary URL instructions',async()=>{
 const f=await fixture(),encoded=encodeReceivingInstruction(f.instruction);assert.deepEqual(decodeReceivingInstruction(encoded),f.instruction);
 for(const input of [encoded+'=',encoded+' ',encoded.slice(0,-3),'lenz:receive:v1:'+'a'.repeat(6000)])assert.throws(()=>decodeReceivingInstruction(input));
 for(const text of ['https://example.test/redirect#receive='+encoded,'https://user:pass@example.test/money.html#receive='+encoded,'https://example.test/money.html?forward=1#receive='+encoded])await assert.rejects(paymentRecipient(text,{now}));
 assert.throws(()=>receivingLink(f.instruction,'http://remote.example'));
});
test('raw external addresses require an explicit network; EIP-681 binds native or reviewed token',async()=>{
 await assert.rejects(paymentRecipient(wallet.address),/network/);
 assert.equal((await paymentRecipient(wallet.address,{network:'0x2105'})).chainId,'0x2105');
 const native=await paymentRecipient(`ethereum:${wallet.address}@1`);assert.equal(native.asset,'native');
 const token=transferAssets('0x2105').find(t=>t.symbol==='USDC');const erc20=await paymentRecipient(`ethereum:${token.id}@8453/transfer?address=${wallet.address}`);assert.equal(erc20.asset,token.id);assert.equal(erc20.address,wallet.address.toLowerCase());
 for(const text of [`ethereum:${wallet.address}`,`ethereum:${wallet.address}@01`,`ethereum:${wallet.address}@137`,`ethereum:${wallet.address}@1?value=100`,`ethereum:${wallet.address}@1/approve?address=${other.address}`,`ethereum:${wallet.address}@1/transfer?address=${other.address}`,'lenz1_example','johnson.near','0x'+'0'.repeat(40)])await assert.rejects(paymentRecipient(text,{network:'0x1'}));
});
test('network, asset, address and expiry guards run before transfer preparation',async()=>{
 const f=transferFixture(),signed=await fixture(),recipient=await paymentRecipient(encodeReceivingInstruction(signed.instruction),{now});
 for(const patch of [{chainId:'0x2105'},{asset:transferAssets('0x1')[1].id},{recipient:other.address.toLowerCase()}]){
  await assert.rejects(async()=>{const terms={chainId:'0x1',asset:'native',recipient:recipient.address,...patch};checkRecipientTransfer(recipient,terms,{now});await prepareTransfer(f.lease,{...f.input,recipient:terms.recipient});});
 }
 assert.throws(()=>checkRecipientTransfer(recipient,{chainId:'0x1',asset:'native',recipient:recipient.address},{now:recipient.expiresAt}),/expired/);assert.equal(f.calls.length,0);
});
async function sessionFixture(){
 const f=await fixture(),calls=[],handlers=new Map();let account=wallet.address,code='0x',hook=null;
 const provider={on:(e,fn)=>handlers.set(e,fn),removeListener:e=>handlers.delete(e),async request(q){calls.push(q);if(hook){const value=await hook(q);if(value!==undefined)return value;}if(['eth_requestAccounts','eth_accounts'].includes(q.method))return [account];if(q.method==='eth_chainId')return '0x1';if(q.method==='eth_getCode')return code;if(q.method==='eth_blockNumber')return '0x1';if(q.method==='eth_getBalance')return '0x0';if(q.method==='eth_signTypedData_v4'){const {domain,types,message}=JSON.parse(q.params[1]);delete types.EIP712Domain;return wallet.signTypedData(domain,types,message);}throw Error('Unexpected '+q.method);}};
 const session=createWalletSession();await session.connect(provider);return {...f,session,calls,handlers,setAccount:a=>account=a,setCode:c=>code=c,setHook:h=>hook=h};
}
test('wallet signing permits only receiving terms and never requests spending authority',async()=>{
 const f=await sessionFixture(),lease=f.session.capture(),signature=await lease.signReceiving(f.terms);
 assert.equal(signature,f.signature);assert.equal(f.calls.filter(c=>c.method==='eth_signTypedData_v4').length,1);assert(!f.calls.some(c=>c.method==='eth_sendTransaction'||c.method==='personal_sign'));
 for(const patch of [{visibility:'private'},{address:other.address.toLowerCase()},{chainId:'0x2105'},{asset:other.address.toLowerCase()},{expiresAt:now+RECEIVING_TTL+1}])await assert.rejects(lease.signReceiving({...f.terms,...patch}));
 assert.equal(f.calls.filter(c=>c.method==='eth_signTypedData_v4').length,1);
});
test('contract accounts, wallet changes, incorrect signatures and late signature replies cannot create links',async()=>{
 for(const mode of ['contract','account','event','wrong-signature']){
  const f=await sessionFixture();if(mode==='contract')f.setCode('0x6000');if(mode==='account')f.setAccount(other.address);
  if(mode==='event')f.setHook(q=>{if(q.method==='eth_signTypedData_v4'){f.handlers.get('accountsChanged')();return f.signature;}});
  if(mode==='wrong-signature')f.setHook(q=>q.method==='eth_signTypedData_v4'?other.signTypedData(f.data.domain,f.data.types,f.data.message):undefined);
  await assert.rejects(f.session.capture().signReceiving(f.terms));
  if(['contract','account'].includes(mode))assert.equal(f.calls.filter(c=>c.method==='eth_signTypedData_v4').length,0);
 }
});
