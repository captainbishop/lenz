// Creates only isolated, faucet-funded testnet accounts. Never reads a user's wallet.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Account, KeyPair, actions, nearToYocto, teraToGas } from 'near-api-js';
import { provider, configPath, finalReceipt, view } from './client.mjs';

const wasm = await readFile(new URL('./target/wasm32-unknown-unknown/release/lenz_test_dollar.wasm',import.meta.url));
await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
const keyPath = new URL('./.testnet/deployer.json',import.meta.url);
let key;
try { key = JSON.parse(await readFile(keyPath,'utf8')); }
catch(e) {
  if(e.code!=='ENOENT')throw e;
  const pair=KeyPair.fromRandom('ed25519');key={accountId:`lenz-dev-${Date.now()}.testnet`,privateKey:pair.toString(),publicKey:pair.getPublicKey().toString()};
  await writeFile(keyPath,JSON.stringify(key),{flag:'wx',mode:0o600});
}
let exists;
try { await provider.viewAccount({accountId:key.accountId,blockQuery:{finality:'final'}});exists=true; }
catch(e) { if(!/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))throw e; }
if(!exists) {
  const response=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:key.accountId,newAccountPublicKey:key.publicKey}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error(`Testnet faucet returned ${response.status}: ${(await response.text()).slice(0,400)}`);
  console.log('Testnet faucet accepted account creation:',key.accountId);
  for(let i=0;i<15;i++) { try {await provider.viewAccessKey({accountId:key.accountId,publicKey:key.publicKey,finalityQuery:{finality:'final'}});exists=true;break;}catch(e){if(i===14)throw e;await new Promise(r=>setTimeout(r,2000));} }
}
if (!key.accountId.startsWith('lenz-dev-') || !key.accountId.endsWith('.testnet')) throw new Error('Expected a disposable Lenz testnet deployer.');
const parent=new Account(key.accountId,provider,key.privateKey),contract=`tusd.${key.accountId}`;
// The 359 KB release needs over 3 NEAR of storage stake. Keep test gas headroom.
const deploymentBalance=nearToYocto('5');
const contractKeyPath=new URL('./.testnet/contract.json',import.meta.url);
let contractKey;
try{contractKey=JSON.parse(await readFile(contractKeyPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const pair=KeyPair.fromRandom('ed25519');contractKey={accountId:contract,privateKey:pair.toString(),publicKey:pair.getPublicKey().toString()};await writeFile(contractKeyPath,JSON.stringify(contractKey),{flag:'wx',mode:0o600});}
let deployed=false,contractState;
try {contractState=await provider.viewAccount({accountId:contract,blockQuery:{finality:'final'}});if(contractState.code_hash!=='11111111111111111111111111111111')deployed=true;}
catch(e) {if(!/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))throw e; await parent.createAccount({newAccountId:contract,publicKey:contractKey.publicKey,nearToTransfer:deploymentBalance});}
if(deployed)throw new Error('This contract already has code. Refusing an automatic replacement.');
if(contractState && contractState.amount < deploymentBalance) {
  finalReceipt(await parent.signAndSendTransaction({receiverId:contract,actions:[actions.transfer(deploymentBalance-contractState.amount)],waitUntil:'FINAL'}));
}
const account=new Account(contract,provider,contractKey.privateKey);
const tx=await account.signAndSendTransaction({receiverId:contract,actions:[actions.deployContract(wasm),actions.functionCall('new',{},teraToGas('100'),0n)],waitUntil:'FINAL'});
const receipt=finalReceipt(tx),metadata=await view(contract,'ft_metadata',{});
if(metadata.symbol!=='tUSD'||metadata.decimals!==6)throw new Error('Unexpected token metadata after deployment.');
const config={network:'testnet',contract,ready:true,deployTx:receipt.txHash,wasmSha256:createHash('sha256').update(wasm).digest('hex')};
await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
await writeFile(new URL('./deployment.json',import.meta.url),JSON.stringify({...config,metadata,receipt},null,2)+'\n');
console.log(JSON.stringify(config,null,2));
