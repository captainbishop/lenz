import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

const sourceUrl = new URL('./native-payment-execution.mjs', import.meta.url).href;
const tipHash = '7'.repeat(64);
const terms = { expiryHeight:150,signedSha256:createHash('sha256').update('signed').digest('hex'),wallet:'a',network:'testnet',pool:'ironwood',recipient:'b',txid:'a'.repeat(64),
  unsignedSha256:createHash('sha256').update('unsigned').digest('hex'),address:'utest1'+'q'.repeat(100),amount:'1000000',fee:'10000',totalDebit:'1010000' };

// The worker loads the real observer and its modules, with native I/O confined to fixtures.
const worker = String.raw`
import { readFile as readSource } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SourceTextModule, SyntheticModule } from 'node:vm';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {sourceUrl,source,fixture,terms}=JSON.parse(input);
const bytes=Buffer.from('isolated pinned tool fixture');
const hash=createHash('sha256').update(bytes).digest('hex');
const build={version:1,scanReadinessVersion:1,chainTipVersion:1,chainBlockVersion:1,expiredInputVersion:1,revision:'fixture',sourceRevision:'fixture',librustzcashRevision:'fixture',
  windowsExeSha256:hash,cargoLockSha256:hash,signerSourceSha256:hash,manifestSha256:hash,
  patchSha256:hash,sourceSha256:hash,lockSha256:hash,executableSha256:hash};
const fixtureErrors=[];
const forbidden=()=>{fixtureErrors.push('unsupported I/O');throw Error('Native fixture attempted unsupported I/O');};
const fixtureRead=async path=>{
  const name=String(path).replaceAll('\\','/');
  if(name.endsWith('/signed.pczt'))return Buffer.from(fixture.signedBytes??'signed');
  if(name.endsWith('/unsigned.pczt'))return Buffer.from(fixture.unsignedBytes??'unsigned');
  if(name.endsWith('source-lock.json')||name.endsWith('/build.json'))return Buffer.from(JSON.stringify(build));
  if(/\/(Cargo\.(toml|lock)|main\.rs|sign\.rs|[^/]+\.patch|[^/]+\.exe)$/.test(name))return bytes;
  return forbidden();
};
let tips=0;
const scans={a:0,b:0};
let blocks=0;
const nativeResult=args=>{
  if(args[0]==='pczt'&&args.includes('extract'))return terms.txid;
  if(args[0]==='--expired-input')return {network:'testnet',pool:'ironwood',walletHeight:Number(args[3]),expiryHeight:150,currentInputs:true,sourceBlockHeight:100,sourceBlockHash:fixture.tipHash,pcztSha256:createHash('sha256').update('unsigned').digest('hex'),...fixture.input};
  if(String(args[0]).replaceAll('\\','/').endsWith('/wallet.mjs')){
    const action=args[1],wallet=args[2];
    const result={ok:true,network:'test',action,wallet};
    if(action==='info')result.info={chain_name:'test',chain_tip_height:160};
    else if(action==='balance')result.balance={chain_tip_height:fixture.walletHeights?.[wallet]??160};
    else if(action==='sync'){if(fixture.syncFails)throw Error('fixture sync interrupted');}
    else return forbidden();
    return result;
  }
  if(args[0]==='--scan'){
    const wallet=String(args[1]).replaceAll('\\','/').includes('/a/')?'a':'b';
    const height=fixture.walletHeights?.[wallet]??160;
    return {network:'testnet',walletHeight:height,fullyScannedHeight:height,tipHash:fixture.tipHash,
      ...fixture.scans[wallet],...(scans[wallet]++?fixture.finalScans?.[wallet]:{})};
  }
  if(args[0]==='--tip')return {network:'testnet',height:160,hash:fixture.tipHash,...(tips++?fixture.finalTip:fixture.initialTip)};
  if(args[0]==='--block')return {network:'testnet',height:Number(args[1]),hash:fixture.tipHash,...(blocks++>=2?fixture.finalBlock:fixture.initialBlock)};
  return forbidden();
};
const outputForArgs=args=>{const value=nativeResult(args);return typeof value==='string'?value:JSON.stringify(value);};
const nativeExec=(file,args,options,callback)=>{
  try{const stdout=outputForArgs(args);queueMicrotask(()=>callback(null,stdout,''));}
  catch(error){queueMicrotask(()=>callback(error,'',''));}
  return {stdin:{on(){},end(){}}};
};
nativeExec[Symbol.for('nodejs.util.promisify.custom')]=async(file,args)=>({stdout:outputForArgs(args),stderr:''});
const databasePaths=[];
class DatabaseSync {
  constructor(path){databasePaths.push(String(path));this.wallet=String(path).replaceAll('\\','/').includes('/a/')?'a':'b';}
  exec(sql){if(sql!=='BEGIN')forbidden();}
  close(){}
  prepare(sql){return {get:height=>{
    const source=this.wallet==='a',changed=fixture.records[this.wallet]??{};
    if(sql.startsWith('SELECT id_tx'))return fixture.records[this.wallet]??undefined;
    if(sql.includes('sum(rn.value)'))return {value:source?100000000:0};
    if(sql.includes('sum(value)'))return {value:source?98990000:1000000};
    if(sql.startsWith('SELECT hash'))return {hash:Buffer.from(height===(fixture.walletHeights?.[this.wallet]??160)?(fixture.databaseTipHashes[this.wallet]??fixture.tipHash):fixture.tipHash,'hex')};
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
try{console.log(JSON.stringify({result:await module.namespace.verifyNativeExpiredPayment('a','fixture/signed.pczt',terms,{...options,unsignedFile:'fixture/unsigned.pczt'}),fixtureErrors,databasePaths}));}
catch(error){console.log(JSON.stringify({rejected:true,error:error.message,fixtureErrors}));}
`;

async function expire(changes={}) {
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
test('native unused expiry binds the exact artifacts and fully scanned canonical wallets',async()=>{
 const value=await expire();assert.equal(value.rejected,undefined,value.error);assert.equal(value.result.status,'expired');assert.equal(value.result.expiryHeight,150);assert.equal(value.result.sourceHeight,160);assert.equal(value.result.recipientHeight,160);assert.equal(value.result.inputUnspent,true);assert.equal(value.result.paymentAbsent,true);assert.deepEqual(value.fixtureErrors,[]);assert(!JSON.stringify(value.result).includes('nullifier'));
});
test('missing canonical scans or a canonical payment cannot retire an unused signature',async()=>{
 for(const fixture of [{walletHeights:{a:159,b:160}},{walletHeights:{a:160,b:159}},{scans:{a:{fullyScannedHeight:159},b:{}}},{records:{a:{id_tx:1,mined_height:151,block:151},b:null}},{databaseTipHashes:{a:'9'.repeat(64)}},{input:{currentInputs:false}},{input:{expiryHeight:149}},{input:{pcztSha256:'8'.repeat(64)}},{finalBlock:{hash:'6'.repeat(64)}},{syncFails:true},{signedBytes:'changed'},{unsignedBytes:'changed'}]){
  const value=await expire(fixture);assert(value.rejected||value.result.status==='unknown',JSON.stringify(value));assert.deepEqual(value.fixtureErrors,[]);
 }
});
test('the original funding block must match the canonical chain before unused expiry is accepted',async()=>{
 for(const input of [{sourceBlockHeight:0},{sourceBlockHeight:161},{sourceBlockHash:'9'.repeat(64)},{sourceBlockHash:null}])cannotConfirm(await expire({input}));
});
