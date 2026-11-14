import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readNativeWallet } from './companion.mjs';
import { inspectNativeEffects } from './payment-effects.mjs';
import { checkNativeFreshness } from './payment-freshness.mjs';
import { createShieldedPaymentService } from './payment-execution.mjs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const execute = promisify(execFile);
const nativeRoot = new URL('../tooling/zcash-devtool/', import.meta.url);
const original = fileURLToPath(new URL('target/release/zcash-devtool.exe',nativeRoot));
const signer = fileURLToPath(new URL('target/release/lenz-zcash-pczt.exe',nativeRoot));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const maximumScanLag = 10;
const defaultWalletRoot=fileURLToPath(new URL('./.testnet/',import.meta.url));

export async function verifyNativeExecutionTools() {
  const lock = JSON.parse(await readFile(new URL('./source-lock.json',import.meta.url)));
  const build = JSON.parse(await readFile(new URL('./pczt-support/build.json',import.meta.url)));
  assert.equal(build.sourceRevision,lock.revision);
  assert.equal(build.librustzcashRevision,lock.librustzcashRevision);
  for(const [path,expected] of [
    [new URL('target/release/zcash-devtool.exe',nativeRoot),lock.windowsExeSha256],
    [new URL('target/release/lenz-zcash-pczt.exe',nativeRoot),build.windowsExeSha256],
    [new URL('src/commands/pczt/sign.rs',nativeRoot),build.signerSourceSha256],
    [new URL('Cargo.toml',nativeRoot),build.manifestSha256],
    [new URL('Cargo.lock',nativeRoot),lock.cargoLockSha256],
    [new URL('./pczt-support/ironwood-test-signer.patch',import.meta.url),build.patchSha256],
  ]) assert.equal(sha(await readFile(path)),expected,'Native execution source or build changed');
  return {network:'testnet',sourceRevision:lock.revision,signerSha256:build.windowsExeSha256};
}

export async function verifyNativeExpiryPreparationTools(){
  await verifyNativeExecutionTools();const build=JSON.parse(await readFile(new URL('./pczt-support/build.json',import.meta.url)));
  assert(build.expiryWindowVersion===1,'Bounded native expiry preparation is unavailable');
  assert.equal(sha(await readFile(new URL('src/commands/pczt/create.rs',nativeRoot))),build.createSourceSha256,'Native expiry preparation source changed');
}

async function spendInspector() {
  await verifyNativeExecutionTools();
  const build=JSON.parse(await readFile(new URL('./spend-inspector/build.json',import.meta.url)));
  const lock=JSON.parse(await readFile(new URL('./source-lock.json',import.meta.url)));
  assert(build.sourceRevision===lock.librustzcashRevision && build.scanReadinessVersion===1 && build.chainTipVersion===1 && build.chainBlockVersion===1,'Native readiness build is unavailable');
  for(const [path,key] of [['src/main.rs','sourceSha256'],['Cargo.toml','manifestSha256'],['Cargo.lock','lockSha256'],['target/release/lenz-zcash-spend-inspector.exe','executableSha256']])
    assert.equal(sha(await readFile(new URL('./spend-inspector/'+path,import.meta.url))),build[key],'Native spend inspector changed');
  return fileURLToPath(new URL('./spend-inspector/target/release/lenz-zcash-spend-inspector.exe',import.meta.url));
}

export async function readNativeChainTip() {
  const inspector=await spendInspector();
  let value;
  try { const result=await execute(inspector,['--tip'],{windowsHide:true,timeout:75000,maxBuffer:2048});value=JSON.parse(result.stdout); }
  catch { throw Object.assign(Error('The current testnet chain tip could not be checked.'),{status:503}); }
  assert(value.network==='testnet' && Number.isSafeInteger(value.height) && value.height>0 && value.height<499999999 && /^[0-9a-f]{64}$/.test(value.hash),'Invalid native testnet chain tip');
  return value;
}

export async function readNativeChainBlock(height) {
  assert(Number.isSafeInteger(height) && height>0 && height<499999999);
  const inspector=await spendInspector();
  let value;
  try { const result=await execute(inspector,['--block',String(height)],{windowsHide:true,timeout:75000,maxBuffer:2048});value=JSON.parse(result.stdout); }
  catch { throw Object.assign(Error('The canonical testnet block could not be checked.'),{status:503}); }
  assert(value.network==='testnet' && value.height===height && /^[0-9a-f]{64}$/.test(value.hash),'Invalid native canonical block');
  return value;
}

export async function checkNativeScanReadiness(wallet,height,{walletRoot=defaultWalletRoot,readWallet=readNativeWallet}={}) {
  assert(['a','b'].includes(wallet) && Number.isSafeInteger(height) && height>0 && height<499999999);
  await readWallet('balance',wallet);
  const inspector=await spendInspector();
  const database=join(walletRoot,wallet,'data.sqlite');
  let value;
  try { const result=await execute(inspector,['--scan',database,String(height)],{windowsHide:true,timeout:15000,maxBuffer:2048});value=JSON.parse(result.stdout); }
  catch { throw Object.assign(Error('The native wallet is not fully scanned to the selected testnet tip.'),{status:409}); }
  assert(value.network==='testnet' && value.walletHeight===height && value.fullyScannedHeight===height && /^[0-9a-f]{64}$/.test(value.tipHash),'Native scan readiness is unavailable');
  return value;
}

export async function checkNativeCanonicalScan(wallet,options={}) {
  const tip=await readNativeChainTip(),balance=await (options.readWallet??readNativeWallet)('balance',wallet);
  const height=balance.balance.chain_tip_height;
  assert(height<=tip.height,'The selected server is behind the native wallet');
  const scan=await checkNativeScanReadiness(wallet,height,options),block=await readNativeChainBlock(height);
  assert(scan.tipHash===block.hash && (height!==tip.height || tip.hash===block.hash),'The scanned native block differs from the current canonical chain');
  return {network:'testnet',wallet,walletHeight:height,canonicalHeight:height,canonicalHash:block.hash,
    serverHeight:tip.height,blocksBehind:tip.height-height,maximumScanLag};
}

export async function checkNativePaymentInputs(wallet,file,review,options={}) {
  assert(['a','b'].includes(wallet) && review.wallet === wallet);
  const inspector=await spendInspector();
  const fresh=await checkNativeFreshness(wallet,file,options.readWallet??readNativeWallet);
  assert(['within-expiry','wallet-behind'].includes(fresh.status),'Synchronize the native wallet before signing');
  const scan=await checkNativeCanonicalScan(wallet,options);
  assert(scan.walletHeight===fresh.walletHeight && scan.blocksBehind<=maximumScanLag,'Incrementally synchronize the native input snapshot');
  const database=join(options.walletRoot??defaultWalletRoot,wallet,'data.sqlite');
  let value;
  try { const result=await execute(inspector,[file,database,String(fresh.walletHeight)],{windowsHide:true,timeout:15000,maxBuffer:2048});value=JSON.parse(result.stdout); }
  catch { throw Object.assign(Error('The selected native input, witness or retained anchor is unavailable. Synchronize and review the same payment.'),{status:409}); }
  assert(value.network === 'testnet' && value.pool === 'ironwood' && value.currentInputs === true && value.witnessVerified === true
    && value.walletHeight === fresh.walletHeight && value.pcztSha256 === review.sha256,'Native input readiness differs from this review');
  const finalFresh=await checkNativeFreshness(wallet,file,options.readWallet??readNativeWallet),block=await readNativeChainBlock(scan.canonicalHeight);
  assert(['within-expiry','wallet-behind'].includes(finalFresh.status) && finalFresh.walletHeight===scan.walletHeight
    && finalFresh.serverHeight>=fresh.serverHeight && finalFresh.serverHeight>=scan.serverHeight
    && finalFresh.serverHeight-scan.walletHeight<=maximumScanLag && block.hash===scan.canonicalHash,'The canonical input snapshot changed or needs synchronization');
  return {network:'testnet',wallet,txid:review.summary.txid,currentInputs:true,witnessVerified:true,walletHeight:value.walletHeight,
    canonicalHeight:scan.canonicalHeight,canonicalHash:scan.canonicalHash,serverHeight:finalFresh.serverHeight,maximumScanLag};
}

function checkedTerms(wallet,terms) {
  assert(['a','b'].includes(wallet) && terms.wallet === wallet && terms.network === 'testnet' && terms.pool === 'ironwood');
  assert(terms.recipient === (wallet === 'a' ? 'b' : 'a'));
  assert(/^[0-9a-f]{64}$/.test(terms.txid) && /^[0-9a-f]{64}$/.test(terms.unsignedSha256));
  assert(/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(terms.address));
  assert(/^[1-9][0-9]{0,7}$/.test(terms.amount) && BigInt(terms.amount) <= 10000000n);
  assert(/^[1-9][0-9]{0,4}$/.test(terms.fee) && BigInt(terms.fee) <= 10000n);
}
const privateFailure = () => Object.assign(Error('The local bounded Zcash operation did not finish. Reconcile its saved transaction before another attempt.'),{status:503});
const reserve = async (path,bytes) => {
  const file=await open(path,'wx');
  try { if(bytes)await file.writeFile(bytes);await file.sync(); }
  finally { await file.close(); }
};

export async function verifyNativeSignedPayment(wallet,file,terms,{signal,walletRoot=defaultWalletRoot,readWallet=readNativeWallet}={}) {
  checkedTerms(wallet,terms);
  await verifyNativeExecutionTools();
  await readWallet('balance',wallet,{signal});
  const bytes=await readFile(file);
  assert(bytes.length > 0 && bytes.length <= 1048576 && sha(bytes) === terms.signedSha256,'Signed transaction differs from the saved artifact');
  signal?.throwIfAborted();
  const args=['pczt','-w',join(walletRoot,wallet),'extract'];
  const txid=await new Promise((resolve,reject)=>{
    const child=execFile(original,args,{windowsHide:true,timeout:900000,maxBuffer:8192,signal},(error,stdout)=>error?reject(privateFailure()):resolve(stdout.trim()));
    child.stdin.on('error',()=>{});child.stdin.end(bytes);
  });
  assert.equal(txid,terms.txid,'Signed transaction ID differs from approval');
  return {txid};
}

export async function signNativePayment(wallet,file,output,terms,{signal,walletRoot=defaultWalletRoot,readWallet=readNativeWallet}={}) {
  checkedTerms(wallet,terms);
  await verifyNativeExecutionTools();
  await readWallet('balance',wallet,{signal});
  const bytes=await readFile(file);
  assert(bytes.length > 0 && bytes.length <= 1048576 && sha(bytes) === terms.unsignedSha256,'Unsigned transaction differs from approval');
  const unsigned=output+'.unsigned',proved=output+'.proved';
  await reserve(unsigned,bytes);await reserve(proved);await reserve(output);
  const args=['pczt','-w',join(walletRoot,wallet)];
  const options={windowsHide:true,timeout:900000,maxBuffer:1048576,signal};
  try {
    await execute(original,[...args,'prove',unsigned,'--output',proved],options);
    const review={wallet,value:Number(terms.amount),summary:{fee:terms.fee,change:terms.change,address:terms.address}};
    await inspectNativeEffects(wallet,proved,review,{signal,walletRoot,readWallet});
    await checkNativePaymentInputs(wallet,unsigned,{...review,sha256:terms.unsignedSha256,summary:{...review.summary,txid:terms.txid}},{walletRoot,readWallet});
    signal?.throwIfAborted();
    await execute(signer,[...args,'sign','--identity',join(walletRoot,wallet,'identity.age'),proved,
      '--expected-recipient',terms.address,'--expected-value',terms.amount,'--maximum-fee',terms.fee,'--output',output],options);
    const signed=await readFile(output);
    assert(signed.length > 0 && signed.length <= 1048576);
    return await verifyNativeSignedPayment(wallet,output,{...terms,signedSha256:sha(signed)},{signal,walletRoot,readWallet});
  } catch { throw privateFailure(); }
}

export async function submitNativePayment(wallet,file,terms,{signal,walletRoot=defaultWalletRoot,readWallet=readNativeWallet}={}) {
  checkedTerms(wallet,terms);
  await verifyNativeExecutionTools();
  await readWallet('balance',wallet,{signal});
  const bytes=await readFile(file);
  assert(bytes.length > 0 && bytes.length <= 1048576 && sha(bytes) === terms.signedSha256,'Signed transaction differs from the saved attempt');
  const fresh=await checkNativeFreshness(wallet,file,readWallet);
  assert(['within-expiry','wallet-behind'].includes(fresh.status),'Check the same signed transaction after synchronizing the wallet');
  const scan=await checkNativeCanonicalScan(wallet,{walletRoot,readWallet});
  assert(scan.walletHeight===fresh.walletHeight && scan.blocksBehind<=maximumScanLag,'Incrementally synchronize before submitting the same signed payment');
  signal?.throwIfAborted();
  const args=['pczt','-w',join(walletRoot,wallet),'send','--server','zecrocks'];
  const stdout=await new Promise((resolve,reject)=>{
    const child=execFile(original,args,{windowsHide:true,timeout:75000,maxBuffer:8192,signal},(error,output)=>error?reject(privateFailure()):resolve(output.trim()));
    child.stdin.on('error',()=>{});child.stdin.end(bytes);
  });
  if(stdout !== 'Sending transaction...\n'+terms.txid && stdout !== 'Sending transaction...\r\n'+terms.txid)throw privateFailure();
  return {txid:terms.txid};
}

export async function observeNativePayment(wallet,terms,options={}) {
  const readWallet=options.readWallet??readNativeWallet,walletRoot=options.walletRoot??defaultWalletRoot;
  checkedTerms(wallet,terms);
  await verifyNativeExecutionTools();
  for(const selected of [wallet,terms.recipient])await readWallet('sync',selected);
  const tip=await readNativeChainTip();
  const unknown=()=>({network:'testnet',wallet,txid:terms.txid,status:'unknown'});
  const snapshots=[];
  for(const selected of [wallet,terms.recipient]) {
    const balance=await readWallet('balance',selected),currentHeight=balance.balance.chain_tip_height;
    if(currentHeight>tip.height)return unknown();
    const scan=await checkNativeScanReadiness(selected,currentHeight,options),canonical=await readNativeChainBlock(currentHeight);
    if(scan.tipHash!==canonical.hash || (currentHeight===tip.height && tip.hash!==canonical.hash))return unknown();
    const db=new DatabaseSync(join(walletRoot,selected,'data.sqlite'),{readOnly:true});
    try {
      db.exec('BEGIN');
      const localTip=db.prepare('SELECT hash FROM blocks WHERE height=?').get(currentHeight);
      if(!localTip?.hash || Buffer.from(localTip.hash).toString('hex')!==canonical.hash)return unknown();
      const bytes=Buffer.from(terms.txid,'hex').reverse();
      const transaction=db.prepare('SELECT id_tx,mined_height,block,fee FROM transactions WHERE txid=?').get(bytes);
      if(!transaction?.mined_height)return {network:'testnet',wallet,txid:terms.txid,status:transaction?'pending':'unknown'};
      if(transaction.block!==transaction.mined_height)return unknown();
      if(transaction.mined_height>currentHeight)return unknown();
      const receiving=db.prepare('SELECT coalesce(sum(value),0) AS value FROM ironwood_received_notes WHERE transaction_id=?').get(transaction.id_tx).value;
      const spent=db.prepare('SELECT coalesce(sum(rn.value),0) AS value FROM ironwood_received_note_spends ns JOIN ironwood_received_notes rn ON rn.id=ns.ironwood_received_note_id WHERE ns.transaction_id=?').get(transaction.id_tx).value;
      const block=db.prepare('SELECT hash FROM blocks WHERE height=?').get(transaction.mined_height);
      assert(block?.hash,'Confirmed transaction block is unavailable');
      const otherPools=db.prepare('SELECT (SELECT count(*) FROM sapling_received_notes WHERE transaction_id=?1)+(SELECT count(*) FROM orchard_received_notes WHERE transaction_id=?1)+(SELECT count(*) FROM transparent_received_outputs WHERE transaction_id=?1) AS count').get(transaction.id_tx).count;
      assert(otherPools===0,'Unexpected other-pool payment outputs');
      assert(Number.isSafeInteger(receiving) && Number.isSafeInteger(spent),'Invalid native payment value');
      snapshots.push({wallet:selected,minedHeight:transaction.mined_height,height:currentHeight,tipHash:canonical.hash,fee:transaction.fee,receiving,spent,blockHash:Buffer.from(block.hash).toString('hex')});
    } finally { db.close(); }
  }
  const [source,recipient]=snapshots;
  const finalTip=await readNativeChainTip();
  for(const snapshot of snapshots) {
    if(snapshot.height>finalTip.height)return unknown();
    const scan=await checkNativeScanReadiness(snapshot.wallet,snapshot.height,options),block=await readNativeChainBlock(snapshot.height);
    if(scan.tipHash!==snapshot.tipHash || block.hash!==snapshot.tipHash || (finalTip.height===snapshot.height && finalTip.hash!==block.hash))return unknown();
  }
  assert(source.blockHash===recipient.blockHash && source.minedHeight===recipient.minedHeight,'Native wallet block observations disagree');
  assert(source.fee===Number(terms.fee) && source.spent-source.receiving===Number(terms.totalDebit)
    && recipient.receiving-recipient.spent===Number(terms.amount),'Native transaction effects differ from approval');
  const confirmations=Math.min(source.height,recipient.height)-source.minedHeight+1;
  if(confirmations<10)return {network:'testnet',wallet,txid:terms.txid,status:'pending'};
  return {network:'testnet',wallet,recipient:terms.recipient,pool:'ironwood',txid:terms.txid,status:'confirmed',
    minedHeight:source.minedHeight,recipientMinedHeight:recipient.minedHeight,sourceHeight:source.height,recipientHeight:recipient.height,
    sourceDelta:String(source.spent-source.receiving),recipientDelta:String(recipient.receiving-recipient.spent)};
}

export async function verifyNativeExpiredPayment(wallet,file,terms,options={}) {
  const readWallet=options.readWallet??readNativeWallet,walletRoot=options.walletRoot??defaultWalletRoot;
  checkedTerms(wallet,terms);
  assert(Number.isSafeInteger(terms.expiryHeight)&&terms.expiryHeight>0&&terms.expiryHeight<499999989,'A finite original transaction expiry is required');
  const unknown=()=>({network:'testnet',wallet,txid:terms.txid,status:'unknown'});
  await verifyNativeSignedPayment(wallet,file,terms,options);
  const unsigned=await readFile(options.unsignedFile);
  assert(unsigned.length>0&&unsigned.length<=1048576&&sha(unsigned)===terms.unsignedSha256,'Original unsigned transaction differs from the approved artifact');
  const build=JSON.parse(await readFile(new URL('./spend-inspector/build.json',import.meta.url)));
  assert(build.expiredInputVersion===1,'Native expired-input verification is unavailable');
  const inspector=await spendInspector();
  for(const selected of [wallet,terms.recipient]){options.signal?.throwIfAborted();await readWallet('sync',selected,{signal:options.signal});}
  const snapshots=[];
  for(const selected of [wallet,terms.recipient]){
    options.signal?.throwIfAborted();const scan=await checkNativeCanonicalScan(selected,options);
    if(scan.walletHeight<terms.expiryHeight+10||scan.blocksBehind>maximumScanLag)return unknown();
    const db=new DatabaseSync(join(walletRoot,selected,'data.sqlite'),{readOnly:true});
    try{
      db.exec('BEGIN');const local=db.prepare('SELECT hash FROM blocks WHERE height=?').get(scan.canonicalHeight);
      if(!local?.hash||Buffer.from(local.hash).toString('hex')!==scan.canonicalHash)return unknown();
      const transaction=db.prepare('SELECT id_tx,mined_height,block,fee FROM transactions WHERE txid=?').get(Buffer.from(terms.txid,'hex').reverse());
      if(transaction&&(transaction.mined_height!==null&&transaction.mined_height!==undefined||transaction.block!==null&&transaction.block!==undefined))return unknown();
    }finally{db.close();}
    snapshots.push(scan);
  }
  options.signal?.throwIfAborted();
  let input;
  try{const {stdout}=await execute(inspector,['--expired-input',options.unsignedFile,join(walletRoot,wallet,'data.sqlite'),String(snapshots[0].walletHeight)],{windowsHide:true,timeout:15000,maxBuffer:2048,signal:options.signal});input=JSON.parse(stdout);}
  catch{throw Object.assign(Error('The original input is spent, locked or unavailable. Keep the saved payment unresolved.'),{status:409});}
  assert(input.network==='testnet'&&input.pool==='ironwood'&&input.walletHeight===snapshots[0].walletHeight&&input.expiryHeight===terms.expiryHeight&&input.currentInputs===true&&input.pcztSha256===terms.unsignedSha256,'The expired original input differs from approval');
  assert(Number.isSafeInteger(input.sourceBlockHeight)&&input.sourceBlockHeight>0&&input.sourceBlockHeight<=snapshots[0].walletHeight&&/^[0-9a-f]{64}$/.test(input.sourceBlockHash),'The original funding block is unavailable');
  const sourceBlock=await readNativeChainBlock(input.sourceBlockHeight);
  if(sourceBlock.hash!==input.sourceBlockHash)return unknown();
  const finalTip=await readNativeChainTip();
  for(const snapshot of snapshots){
    options.signal?.throwIfAborted();if(snapshot.walletHeight>finalTip.height||finalTip.height-snapshot.walletHeight>maximumScanLag)return unknown();
    const scan=await checkNativeScanReadiness(snapshot.wallet,snapshot.walletHeight,options),block=await readNativeChainBlock(snapshot.walletHeight);
    if(scan.tipHash!==snapshot.canonicalHash||block.hash!==snapshot.canonicalHash||(finalTip.height===snapshot.walletHeight&&finalTip.hash!==block.hash))return unknown();
  }
  if((await readNativeChainBlock(input.sourceBlockHeight)).hash!==sourceBlock.hash)return unknown();
  assert(sha(await readFile(file))===terms.signedSha256&&sha(await readFile(options.unsignedFile))===terms.unsignedSha256,'Original transaction artifacts changed during expiry verification');
  options.signal?.throwIfAborted();
  return {network:'testnet',wallet,recipient:terms.recipient,pool:'ironwood',txid:terms.txid,status:'expired',verifier:'native-canonical-expiry/v1',signedSha256:terms.signedSha256,unsignedSha256:terms.unsignedSha256,expiryHeight:terms.expiryHeight,sourceHeight:snapshots[0].walletHeight,recipientHeight:snapshots[1].walletHeight,sourceCanonicalHash:snapshots[0].canonicalHash,recipientCanonicalHash:snapshots[1].canonicalHash,paymentAbsent:true,inputUnspent:true};
}

// This test service is constructed deliberately; it is not a wallet API default.
export function createNativeShieldedPaymentService(options={}) {
  const native={walletRoot:options.walletRoot??defaultWalletRoot,readWallet:options.readWallet??readNativeWallet};
  return createShieldedPaymentService({check:(wallet,file)=>checkNativeFreshness(wallet,file,native.readWallet),effects:(wallet,file,review)=>inspectNativeEffects(wallet,file,review,native),preflight:(wallet,file,review)=>checkNativePaymentInputs(wallet,file,review,native),observe:(wallet,terms)=>observeNativePayment(wallet,terms,native),...options,
    sign:(wallet,file,output,terms,operation)=>signNativePayment(wallet,file,output,terms,{...native,...operation}),recover:(wallet,file,terms,operation)=>verifyNativeSignedPayment(wallet,file,terms,{...native,...operation}),submit:(wallet,file,terms,operation)=>submitNativePayment(wallet,file,terms,{...native,...operation}),expire:(wallet,file,terms,operation)=>verifyNativeExpiredPayment(wallet,file,terms,{...native,...operation})});
}
