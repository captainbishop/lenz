import test from 'node:test';
import assert from 'node:assert/strict';
import {WALLET_NETWORKS,NETWORK_STORAGE_KEY,networkId,customNetwork,createNetworkStore} from './public/evm-networks.js';
import {createWalletSession,nativeAmount} from './public/evm-wallet.js';
import {transferAssets,transferTerms} from './public/evm-transfer.js';
const input={chainId:'12345',name:'Example Chain',symbol:'COIN',decimals:6,rpcUrl:'https://rpc.example.com/'};
function registry(){
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 let tail=Promise.resolve();const locks={request:(_,fn)=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
 return {values,storage,store:createNetworkStore({storage,locks})};
}
function wallet(){
 const handlers=new Map(),calls=[],p={chain:'0x1',address:'0x'+'12'.repeat(20),balance:'0xf4241',hook:null,
  on:(e,f)=>handlers.set(e,f),removeListener:(e,f)=>{if(handlers.get(e)===f)handlers.delete(e);},emit:(e,v)=>handlers.get(e)?.(v),
  async request(call){calls.push(call);if(p.hook){const result=await p.hook(call);if(result!==undefined)return result;}
   if(call.method==='wallet_switchEthereumChain'){p.chain=call.params[0].chainId;p.emit('chainChanged',p.chain);return null;}
   if(call.method==='wallet_addEthereumChain')return null;
   return {eth_accounts:[p.address],eth_requestAccounts:[p.address],eth_chainId:p.chain,eth_blockNumber:'0x2a',eth_getBalance:p.balance}[call.method];
  }};return {p,calls,handlers};
}
test('custom metadata canonicalizes IDs and preserves exact native decimals without overriding builtins',async()=>{
 const {store}=registry();await store.add(input);const n=store.get('0x3039');assert.equal(n.id,'12345');assert.equal(n.symbol,'COIN');assert(Object.isFrozen(n));
 assert.equal(networkId('0xA4B1'),'0xa4b1');assert.equal(nativeAmount('0xf4241',6),'1.000001');assert.equal(nativeAmount('0xf',0),'15');assert.equal(nativeAmount('0x1',36),'0.'+'0'.repeat(35)+'1');
 for(const id of ['1','42161','8453'])assert.throws(()=>store.add({...input,chainId:id}),/built in/);
 assert.throws(()=>store.remove('0x1'),/cannot/);assert.equal(store.get('1'),WALLET_NETWORKS['0x1']);
});
test('invalid IDs, misleading names, precision and unsafe RPC forms are rejected before persistence',()=>{
 const {store,values}=registry();
 for(const change of [{chainId:'0'},{chainId:'01'},{chainId:'0x00'},{chainId:'9007199254740992'},{chainId:'1e3'},{name:'Ethereum'},{name:'x\u202eevil'},{name:'<img>'},{symbol:'ETH<script>'},{decimals:1.1},{decimals:-1},{decimals:37},...['http://rpc.example.com','javascript:alert(1)','https://user:password@rpc.example.com','https://rpc.example.com/?key=secret','https://rpc.example.com/#secret','https://127.0.0.1','https://2130706433','https://[::1]','https://local','https://x.local','https://rpc.example.com:9999','https://rpc.example.com\\@evil.com'].map(rpcUrl=>({rpcUrl}))])assert.throws(()=>store.add({...input,...change}),JSON.stringify(change));
 assert.equal(values.size,0);
});
test('settings survive reload; failed writes and malformed storage never replace prior settings',async()=>{
 const {store,values,storage}=registry();await store.add(input);const before=values.get(NETWORK_STORAGE_KEY);
 assert.equal(createNetworkStore({storage}).get('12345').rpcUrl,input.rpcUrl);
 storage.setItem=()=>{throw Error('Quota');};await assert.rejects(store.add({...input,chainId:'12346'}),/Quota/);assert.equal(values.get(NETWORK_STORAGE_KEY),before);
 await assert.rejects(createNetworkStore({storage}).add({...input,chainId:'12346'}),/safely save/);
 for(const raw of ['{','{}',JSON.stringify({version:1,networks:[input,input]}),'x'.repeat(32769)]){values.set(NETWORK_STORAGE_KEY,raw);assert.throws(()=>store.list());assert.equal(store.get('1'),WALLET_NETWORKS['0x1']);await assert.rejects(store.add(input));assert.equal(values.get(NETWORK_STORAGE_KEY),raw);}
});
test('serialized concurrent additions preserve both networks and reject duplicate IDs and overflow',async()=>{
 const {store}=registry();await Promise.all([store.add(input),store.add({...input,chainId:'12346'})]);assert.equal(store.list().length,2);
 await assert.rejects(store.add({...input,chainId:'0x3039'}),/already saved/);
 for(let i=2;i<20;i++)await store.add({...input,chainId:String(12345+i)});
 await assert.rejects(store.add({...input,chainId:'20000'}),/Remove/);await store.remove('12345');assert.equal(store.get('12345'),null);assert.equal(store.list().length,19);
});
test('explicit builtin switching invalidates captured send leases and verifies actual selected chain',async()=>{
 const {p,calls}=wallet(),session=createWalletSession();await session.connect(p);const lease=session.capture();
 const promise=session.switchNetwork('42161');assert.equal(session.snapshot,null);assert.throws(()=>lease.sendTransaction({}),/changed/);
 const result=await promise;assert.equal(result.chainId,'0xa4b1');assert.equal(result.receiveUri,'ethereum:'+p.address+'@42161');
 assert.deepEqual(calls.find(c=>c.method==='wallet_switchEthereumChain').params,[{chainId:'0xa4b1'}]);assert(!calls.some(c=>c.method==='wallet_addEthereumChain'));assert.equal(calls.filter(c=>c.method==='eth_requestAccounts').length,1);
});
test('custom registration requires consent, then independently switches and reads the correct currency',async()=>{
 const {store}=registry();await store.add(input);const {p,calls}=wallet(),session=createWalletSession({networks:store});await session.connect(p);
 await assert.rejects(session.switchNetwork('12345'),/Allow sharing/);assert(!calls.some(c=>c.method.startsWith('wallet_')));
 const result=await session.switchNetwork('12345',{addConsent:true});assert.equal(result.amount,'1.000001');assert.equal(result.network.symbol,'COIN');assert.equal(result.receiveUri,'ethereum:'+p.address+'@12345');
 assert.deepEqual(calls.filter(c=>c.method.startsWith('wallet_')).map(c=>c.method),['wallet_addEthereumChain','wallet_switchEthereumChain']);
 assert.deepEqual(calls.find(c=>c.method==='wallet_addEthereumChain').params,[{chainId:'0x3039',chainName:'Example Chain',nativeCurrency:{name:'COIN',symbol:'COIN',decimals:6},rpcUrls:[input.rpcUrl]}]);
 assert.throws(()=>transferAssets('0x3039'),/Unsupported/);assert.throws(()=>transferTerms(result,{asset:'native',recipient:'0x'+'34'.repeat(20),amount:'1',publicConsent:true}),/Unsupported/);
});
test('selected network onboarding works from an initially unsupported wallet without automatic financial calls',async()=>{
 const {p,calls}=wallet();p.chain='0x89';const result=await createWalletSession().connect(p,{chainId:'0x2105'});assert.equal(result.chainId,'0x2105');assert.equal(calls[0].method,'wallet_switchEthereumChain');assert(calls.some(c=>c.method==='eth_requestAccounts'));
 assert(!calls.some(c=>/send|sign/i.test(c.method)));
});
test('rejection, unknown network, wrong switch result and account changes never expose a new account',async()=>{
 for(const mode of ['reject','unknown','wrong','event','account','disconnect']){
  const {p,handlers}=wallet(),session=createWalletSession();await session.connect(p);
  p.hook=({method})=>{if(method!=='wallet_switchEthereumChain')return;if(mode==='reject'||mode==='unknown')throw Object.assign(Error(mode),{code:mode==='reject'?4001:4902});if(mode==='wrong')return null;if(mode==='event')p.emit('chainChanged','0x1');if(mode==='account')p.address='0x'+'34'.repeat(20);if(mode==='disconnect')p.emit('accountsChanged',[]);};
  await assert.rejects(session.switchNetwork('0x2105'));assert.equal(session.snapshot,null);assert.equal(handlers.size,0);
 }
});
test('cancelled and timed-out switches ignore late replies without another RPC or overriding a newer session',async()=>{
 const {p,calls}=wallet(),session=createWalletSession({timeoutMs:20});await session.connect(p);let release,ready;const started=new Promise(r=>ready=r);
 p.hook=({method})=>method==='wallet_switchEthereumChain'?new Promise(r=>{release=r;ready();}):undefined;
 const pending=session.switchNetwork('0x2105');await started;await assert.rejects(pending,/respond/);assert.equal(session.snapshot,null);const count=calls.length;
 const next=wallet();await session.connect(next.p);release(null);await new Promise(r=>setTimeout(r,5));assert.equal(calls.length,count);assert.equal(session.snapshot.chainId,'0x1');
});
test('a switch in progress cannot be overlapped and closing it rejects the eventual result',async()=>{
 const {p}=wallet(),session=createWalletSession();await session.connect(p);let release,ready;const started=new Promise(r=>ready=r);
 p.hook=({method})=>method==='wallet_switchEthereumChain'?new Promise(r=>{release=r;ready();}):undefined;
 const pending=session.switchNetwork('0x2105');await started;await assert.rejects(session.switchNetwork('0xa4b1'),/open request/);session.disconnect();release(null);await assert.rejects(pending,/changed/);assert.equal(session.snapshot,null);
});
test('changed custom settings invalidate selected consent, pending registration and captured reads',async()=>{
 const {store}=registry();await store.add(input);const selected=store.get('12345'),{p,calls}=wallet(),session=createWalletSession({networks:store});await session.connect(p);
 await store.remove('12345');await store.add({...input,rpcUrl:'https://other.example.com/'});
 await assert.rejects(session.switchNetwork('12345',{addConsent:true,expectedNetwork:selected}),/settings changed/);assert(!calls.some(c=>c.method.startsWith('wallet_')));
 p.hook=async({method})=>{if(method==='wallet_addEthereumChain')await store.remove('12345');};await assert.rejects(session.switchNetwork('12345',{addConsent:true}),/settings changed/);assert(!calls.some(c=>c.method==='wallet_switchEthereumChain'));
 await store.add(input);p.hook=null;p.chain='0x3039';await session.connect(p);const lease=session.capture();await store.remove('12345');assert.throws(()=>lease.request('eth_accounts'),/changed/);
});
test('changing native decimals during observation rejects the mismatched balance',async()=>{
 const {store}=registry();await store.add(input);const {p}=wallet();p.chain='0x3039';p.hook=async({method})=>{if(method==='eth_getBalance'){await store.remove('12345');await store.add({...input,decimals:18});}};
 const session=createWalletSession({networks:store});await assert.rejects(session.connect(p),/settings changed/);assert.equal(session.snapshot,null);
});
test('an old selected connection cannot disconnect a newer session using the same provider',async()=>{
 const {p}=wallet(),session=createWalletSession();let release,ready;const started=new Promise(r=>ready=r);
 p.hook=({method})=>method==='wallet_switchEthereumChain'?new Promise(r=>{release=r;ready();}):undefined;
 const old=session.connect(p,{chainId:'0x2105'});await started;session.disconnect();p.hook=null;
 await session.connect(p);const current=session.snapshot;release(null);await assert.rejects(old,/changed/);assert.equal(session.snapshot,current);
});
