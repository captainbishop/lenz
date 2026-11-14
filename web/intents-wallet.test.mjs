import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletSession } from './public/evm-wallet.js';
import { emptyAuthenticationPayload } from '../integrations/intents-auth-payload.mjs';
import {signConfidentialSpend} from './public/intents-spend.js';
import {fixture as spendFixture,verifier,wallet,now} from './intents-spend-fixture.mjs';

const address = '0x' + '12'.repeat(20);
function fixture() {
  const calls = [], handlers = new Map();
  const provider = { address, chain: '0x1', sign: async () => 'signature',
    on: (event, fn) => handlers.set(event, fn), removeListener: event => handlers.delete(event),
    async request(value) {
      calls.push(value);
      if (value.method === 'personal_sign') return provider.sign(value.params);
      return { eth_requestAccounts: [provider.address], eth_accounts: [provider.address], eth_chainId: provider.chain,
        eth_blockNumber: '0x1', eth_getBalance: '0x0', eth_getCode: '0x' }[value.method];
    },
  };
  return { session: createWalletSession(), provider, calls };
}
const payload = () => JSON.stringify(emptyAuthenticationPayload({ signerId: address, salt: Uint8Array.of(1,2,3,4) }));

test('private authentication signs only the locally bounded empty ownership message', async () => {
  const { session, provider, calls } = fixture();
  await session.connect(provider);
  assert(!calls.some(c => c.method.includes('sign')));
  const lease = session.capture(), text = payload();
  await lease.signIntentsAuthentication(text);
  assert.deepEqual(calls.find(c => c.method === 'personal_sign').params, ['0x' + Buffer.from(text).toString('hex'), address]);
  for (const altered of [ {intents:[{intent:'transfer'}]}, {signer_id:'0x'+'34'.repeat(20)},
    {verifying_contract:'evil.near'}, {extra:'unexpected'}, {deadline:'2000-01-01T00:00:00.000Z'}, {nonce:'YQ=='} ]) {
    await assert.rejects(lease.signIntentsAuthentication(JSON.stringify({...JSON.parse(text),...altered})));
  }
  assert.equal(calls.filter(c => c.method === 'personal_sign').length, 1);
  assert.throws(() => lease.request('personal_sign', []), /Unsupported/);
});

test('cancelled prompts cannot overlap after reconnect or return a usable late signature', async () => {
  const {session,provider,calls} = fixture(); await session.connect(provider);
  let release, started; const ready = new Promise(resolve => started=resolve);
  provider.sign = () => release ? Promise.resolve('overlapping signature') : new Promise(resolve => { release=resolve; started(); });
  const controller = new AbortController(), pending = session.capture().signIntentsAuthentication(payload(), {signal:controller.signal});
  const rejected = assert.rejects(pending);
  await ready; controller.abort(); session.disconnect(); await session.connect(provider);
  await assert.rejects(session.capture().signIntentsAuthentication(payload()), /still open/);
  assert.equal(calls.filter(c=>c.method==='personal_sign').length,1);
  release('late'); await rejected;
  provider.sign = async () => 'fresh';
  assert.equal(await session.capture().signIntentsAuthentication(payload()),'fresh');
});

test('silent account changes and aborted work cannot reach a wallet signature', async () => {
  for (const cancelled of [false,true]) {
    const {session,provider,calls}=fixture();await session.connect(provider);const lease=session.capture(),controller=new AbortController();
    if(cancelled)controller.abort();else provider.address='0x'+'34'.repeat(20);
    await assert.rejects(lease.signIntentsAuthentication(payload(),{signal:controller.signal}));
    assert.equal(calls.filter(c=>c.method==='personal_sign').length,0);
  }
});

test('private spending and authentication cannot overlap, even after cancellation or in another session',async()=>{
  for(const firstKind of ['authentication','spending']){
    const {session,provider,calls}=fixture(),offer=spendFixture();provider.address=offer.terms.owner;
    await session.connect(provider);const another=createWalletSession();await another.connect(provider);
    const authPayload=()=>JSON.stringify(emptyAuthenticationPayload({signerId:provider.address,salt:Uint8Array.of(1,2,3,4)}));
    const controller=new AbortController();let started,release,firstPrompt=true;
    const ready=new Promise(r=>started=r);
    provider.sign=async params=>{if(!firstPrompt)return wallet.signMessage(Buffer.from(params[0].slice(2),'hex'));firstPrompt=false;return new Promise(r=>{release=r;started();});};
    const spend=signal=>signConfidentialSpend(provider,offer,{signal,now:()=>now,verifySignature:verifier});
    const first=firstKind==='authentication'?session.capture().signIntentsAuthentication(authPayload(),{signal:controller.signal}):spend(controller.signal);
    const rejected=assert.rejects(first);await ready;controller.abort();
    try{
      await assert.rejects(another.capture().signIntentsAuthentication(authPayload()),/still open/);
      await assert.rejects(spend(),/still open/);
      assert.equal(calls.filter(c=>c.method==='personal_sign').length,1);
    }finally{release('discarded late signature');await rejected;await new Promise(r=>setImmediate(r));}
    assert.equal((await spend()).standard,'erc191');
    await another.capture().signIntentsAuthentication(authPayload());
  }
});
