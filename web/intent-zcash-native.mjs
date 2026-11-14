import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNativeWalletReader} from '../zcash/companion.mjs';
import {createPaymentReviewService,inspectReview} from '../zcash/payment-review.mjs';
import {checkNativeFreshness} from '../zcash/payment-freshness.mjs';
import {inspectNativeEffects,inspectNativeMemos} from '../zcash/payment-effects.mjs';
import {verifyNativeExecutionTools,verifyNativeExpiryPreparationTools,createNativeShieldedPaymentService} from '../zcash/native-payment-execution.mjs';

const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repository=fileURLToPath(new URL('../',import.meta.url));
const executable=fileURLToPath(new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe',import.meta.url));
const preparationExecutable=fileURLToPath(new URL('../tooling/zcash-devtool/target/release/lenz-zcash-pczt.exe',import.meta.url));
const outside=path=>{const tail=relative(resolve(repository).toLowerCase(),resolve(path).toLowerCase());return tail==='..'||tail.startsWith('..'+sep)||isAbsolute(tail);};
export async function privateZcashPath(path,{mustExist=true}={}){
 assert(typeof path==='string'&&isAbsolute(path)&&outside(path),'Native custody and journals must be outside the repository');
 let actual;try{actual=await realpath(path);}catch(error){if(mustExist||error.code!=='ENOENT')throw error;actual=join(await realpath(resolve(path,'..')),path.split(/[\\/]/).at(-1));}
 assert(outside(actual),'Native custody and journals must be outside the repository');return actual;
}
export async function openConfiguredNativeZcash({configuration}){
 assert(configuration?.version===1&&configuration.network==='testnet'&&configuration.custody==='local-native','Choose the explicitly configured native testnet backend');
 const walletRoot=await privateZcashPath(configuration.walletRoot);
 for(const wallet of ['a','b'])assert(/^[0-9a-f]{64}$/.test(configuration.recipientAddressSha256?.[wallet]),'Pin both native testnet receiving addresses');
 assert.notEqual(configuration.recipientAddressSha256.a,configuration.recipientAddressSha256.b,'Configure distinct native source and recipient wallets');
 const baseReader=createNativeWalletReader({walletRoot});
 async function guard(){
  assert.equal(await privateZcashPath(configuration.walletRoot),walletRoot,'Native custody directory changed');
  for(const wallet of ['a','b'])for(const name of ['keys.toml','data.sqlite','identity.age'])await privateZcashPath(join(walletRoot,wallet,name));
 }
 const readWallet=async(action,wallet,options)=>{await guard();return baseReader(action,wallet,options);};
 const native={walletRoot,readWallet};
 async function source(wallet){
  assert(['a','b'].includes(wallet));await verifyNativeExecutionTools();
  const [balance,address]=await Promise.all([readWallet('balance',wallet),readWallet('address',wallet)]);
  assert.equal(sha(address.orchardAddress),configuration.recipientAddressSha256[wallet],'The configured native receiving address changed');
  const {stdout}=await execute(executable,['wallet','-w',join(walletRoot,wallet),'list-accounts'],{windowsHide:true,timeout:15000,maxBuffer:16384});
  const keys=[...stdout.matchAll(/^\s+UFVK: (\S+)$/gm)];assert.equal(keys.length,1);assert.equal([...stdout.matchAll(/^Account /gm)].length,1);assert(/^\s+Account index: 0\s*$/m.test(stdout));
  const amount=balance.balance.ironwood_spendable;assert(Number.isSafeInteger(amount)&&amount>=0&&amount<=2100000000000000);
  return {wallet,accountId:'native-zcash:'+wallet+':'+sha(keys[0][1]),address:address.orchardAddress,balance:String(amount),walletHeight:balance.balance.chain_tip_height};
 }
 async function prepare(wallet,value,output){
  await verifyNativeExpiryPreparationTools();await readWallet('sync',wallet);
  const [funds,destination]=await Promise.all([source(wallet),source(wallet==='a'?'b':'a')]);
  assert(BigInt(funds.balance)>BigInt(value)+10000n,'Insufficient native testnet funds for payment, fee and change');
  const args=['pczt','-w',join(walletRoot,wallet)];
  await execute(preparationExecutable,[...args,'create','--address',destination.address,'--value',String(value),'--target-note-count','1','--expiry-blocks','120','--output',output],{windowsHide:true,timeout:60000,maxBuffer:1048576});
  const fresh=await checkNativeFreshness(wallet,output,readWallet);
  assert(fresh.expiryHeight===funds.walletHeight+121&&fresh.blocksRemaining>20,'The new unsigned payment does not retain its bounded native expiry window');
  const {stdout}=await execute(executable,[...args,'inspect',output],{windowsHide:true,timeout:60000,maxBuffer:1048576});
  return {...inspectReview(stdout.trim(),value,destination.address),recipient:destination.wallet,address:destination.address,walletHeight:funds.walletHeight};
 }
 return Object.freeze({source,sync:(wallet,options)=>readWallet('sync',wallet,options),
  createReview:({directory})=>createPaymentReviewService({directory,prepare,check:(wallet,file)=>checkNativeFreshness(wallet,file,readWallet),effects:(wallet,file,review)=>inspectNativeEffects(wallet,file,review,native),memos:(wallet,file,review,options)=>inspectNativeMemos(wallet,file,review,{...native,...options})}),
  createPayment:options=>createNativeShieldedPaymentService({...options,...native}),
 });
}
