import {mkdir,open,readFile,rename,unlink,realpath,stat} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Account,KeyPair,JsonRpcProvider,actions,encodeTransaction,decodeSignedTransaction} from '../contracts/node_modules/near-api-js/lib/index.js';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {nearImplicitAddress,encodeView,decodeViewResult} from '../aurora/engine-codec.mjs';
import {outsideRepository} from '../integrations/intent-testnet/private-path.mjs';
import {createNearIntentFinalSnapshot} from './intent-near-relay.mjs';
import {createAuroraSponsorCoordinator,emptyAuroraSponsorJournal,checkAuroraSponsorCall} from './intent-aurora-sponsor.mjs';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';

const repository=fileURLToPath(new URL('..',import.meta.url)),runtimes=new Map(),check=(ok,message)=>{if(!ok)throw Error(message);};
const abi=new Interface(['function allowance(address,address) view returns(uint256)']);
export async function openAuroraPrivateJournal({stateDir,fileName,initial}={}){
 check(typeof stateDir==='string'&&outsideRepository(repository,resolve(stateDir))&&/^[a-z-]+\.json$/.test(fileName)&&typeof initial==='function','Keep private sponsor journals outside the product repository.');
 await mkdir(resolve(stateDir),{recursive:true});const directory=await realpath(resolve(stateDir));check(outsideRepository(repository,directory),'The private journal directory entered the product repository.');
 const lockPath=resolve(directory,'run.lock'),lock=await open(lockPath,'wx',0o600),file=resolve(directory,fileName),marker=file+'.initialized',markerValue='lenz/private-journal/v1:'+fileName+'\n',directoryMarker=resolve(directory,'.initialized-journals.json');let closed=false;
 async function readRetained(){
  const info=await stat(file);check(info.isFile()&&info.size<=2_000_000&&outsideRepository(repository,await realpath(file)),'The retained private journal is invalid.');
  const raw=await readFile(file,'utf8');check(Buffer.byteLength(raw,'utf8')<=2_000_000,'The retained private journal is too large.');return JSON.parse(raw);
 }
 async function readMarker(){
  const info=await stat(marker);check(info.isFile()&&info.size<=256&&outsideRepository(repository,await realpath(marker)),'The private journal initialization marker is invalid.');
  check(await readFile(marker,'utf8')===markerValue,'The private journal initialization marker changed.');
 }
 async function readDirectoryMarker(){
  const info=await stat(directoryMarker);check(info.isFile()&&info.size<=2_000_000&&outsideRepository(repository,await realpath(directoryMarker)),'The private journal directory initialization marker is invalid.');
  const raw=await readFile(directoryMarker,'utf8');check(Buffer.byteLength(raw,'utf8')<=2_000_000,'The private journal directory initialization marker is too large.');const value=JSON.parse(raw);
  check(value?.version===1&&Object.keys(value).sort().join(',')==='files,version'&&Array.isArray(value.files)&&value.files.length>0&&value.files.every(name=>typeof name==='string'&&/^[a-z-]+\.json$/.test(name))&&new Set(value.files).size===value.files.length,'The private journal directory initialization marker changed.');return value;
 }
 async function established(){
  check(!closed,'The private journal is closed.');
  try{await readMarker();check((await readDirectoryMarker()).files.includes(fileName),'The private journal directory initialization marker changed.');return await readRetained();}catch(error){if(error.code==='ENOENT')throw Error('An established private journal or its initialization marker is missing. Restore the original files.');throw error;}
 }
 async function persist(state,target=file){
  const raw=JSON.stringify(state);check(typeof raw==='string'&&Buffer.byteLength(raw+'\n','utf8')<=2_000_000,'The retained private journal is too large or invalid.');
  const temporary=target+'.'+randomBytes(12).toString('hex')+'.next',handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(raw+'\n');await handle.sync();}finally{await handle.close();}await rename(temporary,target);
 }
 try{
  await lock.writeFile(String(process.pid));await lock.sync();let marked=true,registered=null,directoryMarked=true;
  try{await stat(directoryMarker);}catch(error){if(error.code!=='ENOENT')throw error;directoryMarked=false;}
  if(directoryMarked)registered=await readDirectoryMarker();
  try{await stat(marker);}catch(error){if(error.code!=='ENOENT')throw error;marked=false;}
  if(registered?.files.includes(fileName)){check(marked,'The private journal initialization marker is missing. Restore the original files.');await established();}
  else{
   check(!marked,'The private journal directory initialization marker is missing or changed. Restore the original files.');
   let existing=true;try{await stat(file);}catch(error){if(error.code!=='ENOENT')throw error;existing=false;}
   if(existing)await readRetained();else await persist(initial());
   const handle=await open(marker,'wx',0o600);try{await handle.writeFile(markerValue);await handle.sync();}finally{await handle.close();}
   await persist({version:1,files:[...(registered?.files??[]),fileName]},directoryMarker);
  }
 }catch(error){await lock.close();await unlink(lockPath);throw error;}
 return Object.freeze({read:established,async write(state){await established();await persist(state);},async close(){if(closed)return;closed=true;await lock.close();await unlink(lockPath);}});
}
async function initialize({deployerKeyFile,operatorId,engineCodeHash}){
 check((await stat(deployerKeyFile)).size<=4096,'The dedicated test operator file is invalid.');const key=JSON.parse(await readFile(deployerKeyFile,'utf8'));
 check(key.accountId===operatorId&&typeof key.privateKey==='string','The dedicated test operator changed.');const pair=KeyPair.fromString(key.privateKey);check(pair.getPublicKey().toString().startsWith('ed25519:'),'The dedicated operator must use an Ed25519 key.');
 const publicKey=pair.getPublicKey().toString(),operatorAddress=nearImplicitAddress(operatorId),provider=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),account=new Account(operatorId,provider,key.privateKey);
 const journal=await openAuroraPrivateJournal({stateDir:resolve(dirname(deployerKeyFile),'aurora-sponsor-'+operatorId),fileName:'sponsor-state.json',initial:emptyAuroraSponsorJournal});
 try{
 const finalSnapshot=createNearIntentFinalSnapshot((method,params)=>provider.sendJsonRpc(method,params));let coordinator;
 async function operatorState(){
  const final=await finalSnapshot(),[engine,operator,keys,protocol,gasPrice,pending]=await Promise.all([final.account('aurora'),final.account(operatorId),final.keys(operatorId),provider.sendJsonRpc('EXPERIMENTAL_protocol_config',{block_id:final.header.hash}),provider.sendJsonRpc('gas_price',{block_id:final.header.hash}),coordinator.pending()]);
  check(engine.code_hash===engineCodeHash&&keys.some(entry=>entry.public_key===publicKey&&entry.access_key?.permission==='FullAccess'),'The pinned Engine or operator authority changed.');
  const maximum=protocol.runtime_config?.wasm_config?.limit_config?.max_total_prepaid_gas,storagePrice=protocol.runtime_config?.storage_amount_per_byte;
  check((typeof maximum==='string'||Number.isSafeInteger(maximum))&&typeof storagePrice==='string'&&typeof operator.amount==='string'&&Number.isSafeInteger(operator.storage_usage)&&typeof gasPrice.gas_price==='string','The operator gas budget cannot be checked.');
  const args=encodeView({sender:operatorAddress,contract:d.inputToken,input:Buffer.from(abi.encodeFunctionData('allowance',[operatorAddress,d.pool]).slice(2),'hex')}),response=await provider.query({request_type:'call_function',account_id:'aurora',method_name:'view',args_base64:base64.encode(args),block_id:final.header.hash});
  check(response.block_hash===final.header.hash&&response.block_height===final.header.height,'The operator allowance returned another final block.');const result=decodeViewResult(Uint8Array.from(response.result));check(result.succeeded,'The operator allowance cannot be checked.');
  const allowance=abi.decodeFunctionResult('allowance',result.output)[0].toString(),available=BigInt(operator.amount)-BigInt(operator.storage_usage)*BigInt(storagePrice),budget=1000000000000000n*BigInt(gasPrice.gas_price)+50000000000000000000000n;
  return {accountId:operatorId,address:operatorAddress,publicKey,engineVerified:true,maxGas:String(maximum),allowance,gasReady:available>=budget&&!pending,pending:!!pending,gasPrice:gasPrice.gas_price,availableBalance:available.toString()};
 }
 async function canonical(result){
  if(!result||result.final_execution_status!=='FINAL')return result;check(JSON.stringify(result).length<=2_000_000&&Array.isArray(result.receipts_outcome)&&result.receipts_outcome.length<=128,'The final sponsor receipt exceeds its boundary.');
  const hashes=[...new Set([result.transaction_outcome?.block_hash,...result.receipts_outcome.map(row=>row.block_hash)])];check(hashes.every(value=>typeof value==='string'&&base58.decode(value).length===32),'The final sponsor block references are invalid.');
  const final=await finalSnapshot();await Promise.all(hashes.map(async hash=>{const block=await provider.sendJsonRpc('block',{block_id:hash});check(block.header?.hash===hash&&Number.isSafeInteger(block.header.height)&&block.header.height<=final.header.height,'The original sponsor receipt is not finalized.');const sameHeight=await provider.sendJsonRpc('block',{block_id:block.header.height});check(sameHeight.header?.hash===hash,'The original sponsor receipt is not canonical.');}));return result;
 }
 const transport={async send(bytes){return canonical(await provider.sendTransactionUntil(decodeSignedTransaction(base64.decode(bytes)),'FINAL'));},async transaction(txHash,senderId){return canonical(await provider.sendJsonRpc('tx',{tx_hash:txHash,sender_account_id:senderId,wait_until:'FINAL'}));}};
 const signer={async signTransaction(call){
  checkAuroraSponsorCall(call);const operator=await operatorState();check(operator.gasReady&&BigInt(operator.maxGas)>=BigInt(call.gas),'The shared sponsor gas or pending authority changed.');
  const signed=await account.createSignedTransaction({receiverId:'aurora',actions:[actions.functionCall('call',base64.decode(call.args),BigInt(call.gas),0n)]}),txHash=base58.encode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
  check(signed.transaction.publicKey.toString()===publicKey,'The operator signing key changed.');return {bytes:base64.encode(signed.encode()),txHash,senderId:operatorId};
 }};
 coordinator=createAuroraSponsorCoordinator({signer,transport,journal,operatorId,budgetStatus:async()=>{const state=await operatorState();return {gasPrice:state.gasPrice,availableBalance:state.availableBalance};},fundingDailyLimit:Number(process.env.LENZ_AURORA_FUNDING_DAILY_LIMIT??5),swapDailyLimit:Number(process.env.LENZ_AURORA_SWAP_DAILY_LIMIT??5),maxGasPrice:process.env.LENZ_AURORA_MAX_GAS_PRICE??'200000000'});return Object.freeze({...coordinator,operatorId,operatorAddress,operatorState,close:()=>journal.close()});
 }catch(error){await journal.close();throw error;}
}
export async function openAuroraSponsorRuntime({deployerKeyFile,operatorId,engineCodeHash}={}){
 check(typeof deployerKeyFile==='string'&&outsideRepository(repository,resolve(deployerKeyFile))&&typeof operatorId==='string'&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(operatorId)&&typeof engineCodeHash==='string'&&base58.decode(engineCodeHash).length===32,'Pin the dedicated test operator and Engine outside the repository.');
 const keyFile=await realpath(resolve(deployerKeyFile));check(outsideRepository(repository,keyFile),'The dedicated operator key entered the product repository.');const identity=keyFile.toLowerCase();let entry=runtimes.get(identity);
 if(entry)check(entry.operatorId===operatorId&&entry.engineCodeHash===engineCodeHash,'The shared sponsor configuration changed.');
 else{entry={operatorId,engineCodeHash,references:0,promise:null};entry.promise=initialize({deployerKeyFile:keyFile,operatorId,engineCodeHash}).catch(error=>{if(runtimes.get(identity)===entry)runtimes.delete(identity);throw error;});runtimes.set(identity,entry);}
 const runtime=await entry.promise;entry.references++;let closed=false;
 return Object.freeze({...runtime,async close(){if(closed)return;closed=true;if(--entry.references===0){runtimes.delete(identity);await runtime.close();}}});
}
