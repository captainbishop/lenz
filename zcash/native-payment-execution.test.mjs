import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const sourceUrl = new URL('./native-payment-execution.mjs', import.meta.url).href;
const tipHash = '7'.repeat(64);
const terms = { wallet:'a',network:'testnet',pool:'ironwood',recipient:'b',txid:'a'.repeat(64),
  unsignedSha256:'b'.repeat(64),address:'utest1'+'q'.repeat(100),amount:'1000000',fee:'10000',totalDebit:'1010000' };

// The worker loads the real observer and its modules, with native I/O confined to fixtures.
const worker = String.raw`
import { readFile as readSource } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SourceTextModule, SyntheticModule } from 'node:vm';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {sourceUrl,source,fixture,terms}=JSON.parse(input);
const bytes=Buffer.from('isolated pinned tool fixture');
const hash=createHash('sha256').update(bytes).digest('hex');
const build={version:1,scanReadinessVersion:1,chainTipVersion:1,chainBlockVersion:1,revision:'fixture',sourceRevision:'fixture',librustzcashRevision:'fixture',
  windowsExeSha256:hash,cargoLockSha256:hash,signerSourceSha256:hash,manifestSha256:hash,
  patchSha256:hash,sourceSha256:hash,lockSha256:hash,executableSha256:hash};
const fixtureErrors=[];
const forbidden=()=>{fixtureErrors.push('unsupported I/O');throw Error('Native fixture attempted unsupported I/O');};
const fixtureRead=async path=>{
  const name=String(path).replaceAll('\\','/');
  if(name.endsWith('source-lock.json')||name.endsWith('/build.json'))return Buffer.from(JSON.stringify(build));
  if(/\/(Cargo\.(toml|lock)|main\.rs|sign\.rs|[^/]+\.patch|[^/]+\.exe)$/.test(name))return bytes;
  return forbidden();
};
let tips=0;
const scans={a:0,b:0};
let blocks=0;
const nativeResult=args=>{
  if(String(args[0]).replaceAll('\\','/').endsWith('/wallet.mjs')){
    const action=args[1],wallet=args[2];
    const result={ok:true,network:'test',action,wallet};
    if(action==='info')result.info={chain_name:'test',chain_tip_height:110};
    else if(action==='balance')result.balance={chain_tip_height:fixture.walletHeights?.[wallet]??110};
    else if(action==='sync'){if(fixture.syncFails)throw Error('fixture sync interrupted');}
    else return forbidden();
    return result;
  }
  if(args[0]==='--scan'){
    const wallet=String(args[1]).replaceAll('\\','/').includes('/a/')?'a':'b';
    const height=fixture.walletHeights?.[wallet]??110;
    return {network:'testnet',walletHeight:height,fullyScannedHeight:height,tipHash:fixture.tipHash,
      ...fixture.scans[wallet],...(scans[wallet]++?fixture.finalScans?.[wallet]:{})};
  }
  if(args[0]==='--tip')return {network:'testnet',height:110,hash:fixture.tipHash,...(tips++?fixture.finalTip:fixture.initialTip)};
  if(args[0]==='--block')return {network:'testnet',height:Number(args[1]),hash:fixture.tipHash,...(blocks++>=2?fixture.finalBlock:fixture.initialBlock)};
  return forbidden();
};
const nativeExec=(file,args,options,callback)=>{
  try{const stdout=JSON.stringify(nativeResult(args));queueMicrotask(()=>callback(null,stdout,''));}
  catch(error){queueMicrotask(()=>callback(error,'',''));}
  return {stdin:{on(){},end(){}}};
};
nativeExec[Symbol.for('nodejs.util.promisify.custom')]=async(file,args)=>({stdout:JSON.stringify(nativeResult(args)),stderr:''});
const databasePaths=[];
class DatabaseSync {
  constructor(path){databasePaths.push(String(path));this.wallet=String(path).replaceAll('\\','/').includes('/a/')?'a':'b';}
  exec(sql){if(sql!=='BEGIN')forbidden();}
  close(){}
  prepare(sql){return {get:height=>{
    const source=this.wallet==='a',changed=fixture.records[this.wallet]??{};
    if(sql.startsWith('SELECT id_tx'))return {id_tx:1,mined_height:101,block:101,fee:source?10000:null,...changed};
    if(sql.includes('sum(rn.value)'))return {value:source?100000000:0};
    if(sql.includes('sum(value)'))return {value:source?98990000:1000000};
    if(sql.startsWith('SELECT hash'))return {hash:Buffer.from(height===(fixture.walletHeights?.[this.wallet]??110)?(fixture.databaseTipHashes[this.wallet]??fixture.tipHash):fixture.tipHash,'hex')};
    if(sql.includes('AS count'))return {count:0};
    return forbidden();
  }};}
}
const cache=new Map();
const synthetic=(identifier,value)=>new SyntheticModule(Object.keys(value),function(){
  for(const key of Object.keys(value))this.setExport(key,value[key]);
},{identifier});
const builtins={
  'node:fs/promises':{readFile:fixtureRead,open:forbidden,writeFile:forbidden,mkdir:forbidden,rename:forbidden,unlink:forbidden,access:forbidden},
  'node:child_process':{execFile:nativeExec},
  'node:sqlite':{DatabaseSync},
};
const load=async identifier=>{
  if(cache.has(identifier))return cache.get(identifier);
  const pending=(async()=>{
    if(identifier.startsWith('node:'))return synthetic(identifier,builtins[identifier]??await import(identifier));
    const text=identifier===sourceUrl?source:await readSource(new URL(identifier),'utf8');
    return new SourceTextModule(text,{identifier,initializeImportMeta(meta){meta.url=identifier;}});
  })();
  cache.set(identifier,pending);return pending;
};
const module=await load(sourceUrl);
await module.link((specifier,parent)=>load(specifier.startsWith('node:')?specifier:new URL(specifier,parent.identifier).href));
await module.evaluate();
const options=fixture.privateWalletRoot?{walletRoot:fixture.privateWalletRoot,readWallet:async(action,wallet)=>nativeResult(['fixture/wallet.mjs',action,wallet])}:{};
try{console.log(JSON.stringify({result:await module.namespace.observeNativePayment('a',terms,options),fixtureErrors,databasePaths}));}
catch(error){console.log(JSON.stringify({rejected:true,error:error.message,fixtureErrors}));}
`;

async function observe(changes={}) {
  const fixture={tipHash,scans:{},records:{},databaseTipHashes:{},...changes};
  const source=await readFile(new URL(sourceUrl),'utf8');
  const stdout=await new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,['--experimental-vm-modules','--input-type=module','-e',worker],
      {windowsHide:true,timeout:15000,maxBuffer:1048576},(error,output,stderr)=>error?reject(Error(stderr||error.message)):resolve(output));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({sourceUrl,source,fixture,terms}));
  });
  return JSON.parse(stdout);
}

const cannotConfirm=value=>{
  assert.deepEqual(value.fixtureErrors,[],'The fixture must cover every native I/O operation');
  assert(value.rejected===true||value.result?.status==='unknown',JSON.stringify(value));
};

test('the exact payment confirms after complete scans and matching chain observations',async()=>{
  const value=await observe();
  assert.deepEqual(value.fixtureErrors,[]);
  assert.equal(value.result?.status,'confirmed',JSON.stringify(value));
  assert.equal(value.result.sourceDelta,'1010000');
  assert.equal(value.result.recipientDelta,'1000000');
  assert.equal(value.result.sourceHeight-value.result.minedHeight+1,10);
});

test('an explicitly configured observer reads only its private native wallet databases',async()=>{
  const privateWalletRoot=joinPathForFixture();
  const value=await observe({privateWalletRoot});
  assert.deepEqual(value.fixtureErrors,[]);assert.equal(value.result?.status,'confirmed',JSON.stringify(value));
  assert.equal(value.databasePaths.length,2);for(const path of value.databasePaths)assert(path.startsWith(privateWalletRoot));
});
const joinPathForFixture=()=>process.platform==='win32'?'C:\\private-native-fixture':'/private-native-fixture';

test('ordinary head advancement retains confirmation through the checked canonical scan',async()=>{
  const value=await observe({finalTip:{height:111,hash:'8'.repeat(64)}});
  assert.deepEqual(value.fixtureErrors,[]);
  assert.equal(value.result?.status,'confirmed',JSON.stringify(value));
  assert.equal(value.result.sourceHeight,110);
  assert.equal(value.result.recipientHeight,110);
});

test('different complete scan heights count only confirmations observed by both wallets',async()=>{
  const value=await observe({walletHeights:{b:111},initialTip:{height:112,hash:'8'.repeat(64)},finalTip:{height:113,hash:'9'.repeat(64)}});
  assert.deepEqual(value.fixtureErrors,[]);
  assert.equal(value.result?.status,'confirmed',JSON.stringify(value));
  assert.equal(value.result.sourceHeight,110);assert.equal(value.result.recipientHeight,111);
  const pending=await observe({walletHeights:{b:109}});
  assert.deepEqual(pending.fixtureErrors,[]);assert.equal(pending.result?.status,'pending',JSON.stringify(pending));
});

test('canonical block height mismatches and records above the full scan remain unconfirmed',async()=>{
  cannotConfirm(await observe({initialBlock:{height:109}}));
  cannotConfirm(await observe({walletHeights:{a:100}}));
});

test('an incomplete native scan cannot turn stale transaction records into confirmation',async()=>{
  for(const wallet of ['a','b'])cannotConfirm(await observe({scans:{[wallet]:{fullyScannedHeight:100}}}));
});

test('a wallet scanned on a different chain cannot confirm the payment',async()=>{
  for(const wallet of ['a','b'])cannotConfirm(await observe({scans:{[wallet]:{tipHash:'8'.repeat(64)}},finalScans:{[wallet]:{tipHash}}}));
});

test('a wallet database changed after scan readiness cannot confirm the payment',async()=>{
  for(const wallet of ['a','b'])cannotConfirm(await observe({databaseTipHashes:{[wallet]:'8'.repeat(64)}}));
});

test('a mined height without scanned block association cannot confirm the payment',async()=>{
  for(const wallet of ['a','b'])cannotConfirm(await observe({records:{[wallet]:{block:null}}}));
});

test('a changed chain after reading wallet effects keeps the payment unresolved',async()=>{
  for(const finalTip of [{height:109},{hash:'8'.repeat(64)}])cannotConfirm(await observe({finalTip}));
  cannotConfirm(await observe({finalTip:{height:111,hash:'9'.repeat(64)},finalBlock:{hash:'8'.repeat(64)}}));
});

test('interrupted wallet synchronization cannot confirm a stored payment',async()=>{
  cannotConfirm(await observe({syncFails:true}));
});
