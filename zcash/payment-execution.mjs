// Local disposable-wallet execution. No browser route is mounted by this module.
import assert from 'node:assert/strict';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkNativeFreshness, evaluateFreshness } from './payment-freshness.mjs';
import { inspectNativeEffects, validateEffects } from './payment-effects.mjs';
import { publicMemos } from './payment-memos.mjs';

const root = fileURLToPath(new URL('./.testnet/', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const fail = (message, status = 409) => Object.assign(Error(message), { status });
const states = ['reviewed','signing','signing-unknown','signed','submitting','submitted','unknown','confirmed','expired'];
const unavailable = async () => { throw fail('Current native input and witness readiness is unavailable.', 503); };

function termsFor(review, freshness) {
  const value = review.value, summary = review.summary;
  assert(identifier(review.id) && ['a','b'].includes(review.wallet) && review.state === 'ready', 'A completed unsigned review is required');
  assert(Number.isSafeInteger(value) && value > 0 && value <= 10000000);
  assert(fingerprint(review.sha256) && fingerprint(summary?.txid), 'Invalid transaction fingerprint');
  assert(summary.recipient === (review.wallet === 'a' ? 'b' : 'a'), 'Recipient must be the other disposable wallet');
  assert(typeof summary.address === 'string' && /^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,295}$/.test(summary.address));
  for (const field of ['fee','change','totalDebit']) assert(typeof summary[field] === 'string' && /^[1-9][0-9]{0,15}$/.test(summary[field]));
  assert(BigInt(summary.fee) <= 10000n && BigInt(summary.totalDebit) === BigInt(value) + BigInt(summary.fee), 'Invalid authorized debit');
  const memos = publicMemos(review);
  assert(memos.status === 'confirmed', 'Inspect and confirm the exact memos before signing');
  return { version:1, network:'testnet', pool:'ironwood', id:review.id, wallet:review.wallet,
    recipient:summary.recipient, address:summary.address, amount:String(value), fee:summary.fee,
    change:summary.change, totalDebit:summary.totalDebit, txid:summary.txid,
    unsignedSha256:review.sha256, memoBinding:memos.binding, expiryHeight:freshness.expiryHeight };
}

export function createShieldedPaymentService({ directory = join(root,'payment-execution'), reviewDirectory = join(root,'payment-review'),
  check = checkNativeFreshness, effects = inspectNativeEffects, preflight = unavailable,
  sign = unavailable, recover = unavailable, submit = unavailable, observe = unavailable, expire = unavailable, now = Date.now } = {}) {
  const journal = join(directory,'current.json');
  let lease = null;
  const readJSON = async (path, optional = false) => {
    try { const bytes = await readFile(path); assert(bytes.length <= 16384,'Saved record is too large'); return JSON.parse(bytes); }
    catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  };
  const read = async () => {
    const record = await readJSON(journal,true);
    if (record) {
      assert(record.version === 1 && states.includes(record.state) && identifier(record.terms?.id) && ['a','b'].includes(record.terms.wallet), 'Invalid execution journal');
      assert(fingerprint(record.binding) && record.binding === sha(JSON.stringify(record.terms)), 'Execution terms changed');
      assert(fingerprint(record.terms.txid) && record.terms.network === 'testnet' && record.terms.pool === 'ironwood');
      if(record.state==='expired'){assert(!record.attempt,'Submitted payment expiry is not supported by this recovery');checkedExpiry(record.expiryEvidence,record);}
    }
    return record;
  };
  const checkedExpiry = (value,record) => {
    const terms=record.terms;
    assert(value?.network==='testnet'&&value.wallet===terms.wallet&&value.recipient===terms.recipient&&value.pool==='ironwood'&&value.txid===terms.txid&&value.status==='expired'&&value.verifier==='native-canonical-expiry/v1'
      && value.signedSha256===record.signedSha256&&value.unsignedSha256===terms.unsignedSha256&&value.expiryHeight===terms.expiryHeight
      && Number.isSafeInteger(value.expiryHeight)&&value.expiryHeight>0&&value.expiryHeight<499999989
      && [value.sourceHeight,value.recipientHeight].every(height=>Number.isSafeInteger(height)&&height>=value.expiryHeight+10&&height<499999999)
      && fingerprint(value.sourceCanonicalHash)&&fingerprint(value.recipientCanonicalHash)&&value.paymentAbsent===true&&value.inputUnspent===true,'Canonical expiry and unchanged input are unavailable');
    return Object.fromEntries(['network','wallet','recipient','pool','txid','status','verifier','signedSha256','unsignedSha256','expiryHeight','sourceHeight','recipientHeight','sourceCanonicalHash','recipientCanonicalHash','paymentAbsent','inputUnspent'].map(key=>[key,value[key]]));
  };
  const save = async record => {
    const temporary = journal+'.'+randomUUID()+'.tmp';
    const handle = await open(temporary,'wx');
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary,journal);
  };
  const fileHash = async path => { const bytes = await readFile(path); assert(bytes.length > 0 && bytes.length <= 1048576,'Unsupported transaction file'); return sha(bytes); };
  const signedFile = record => join(directory,record.terms.id+'.signed.pczt');
  const checkedSigned = async record => {
    assert(fingerprint(record.signedSha256),'Signed transaction fingerprint is unavailable');
    assert.equal(await fileHash(signedFile(record)),record.signedSha256,'Signed transaction changed');
  };
  const approvalCurrent = (approval,binding) => {
    const age = now()-approval?.at;
    const valid = approval?.binding === binding && Number.isFinite(age) && age >= 0 && age < 120000;
    if (!valid) lease = null;
    return valid;
  };
  const publicRecord = record => record ? { payment:{...record.terms, binding:record.binding,state:record.state,
    canSign:record.state === 'reviewed' && approvalCurrent(lease,record.binding),
    canSubmit:record.state === 'signed', ...(record.confirmations ? {confirmations:record.confirmations} : {}),...(record.state==='expired'?{expiryEvidence:checkedExpiry(record.expiryEvidence,record)}:{}) } } : {payment:null};
  const matching = (record,input) => {
    if (!record || record.terms.wallet !== input.wallet || record.terms.id !== input.id) throw fail('Open the matching saved payment.');
  };
  const reviewSnapshot = async input => {
    const record = await readJSON(join(reviewDirectory,'current.json'));
    if (record.wallet !== input.wallet || record.id !== input.id || record.state !== 'ready') throw fail('Open the matching completed unsigned review.');
    const file = join(reviewDirectory,record.id+'.pczt');
    assert.equal(await fileHash(file),record.sha256,'Saved unsigned transaction changed');
    return {record,file};
  };
  const validateCurrent = async ({record,file}, expected, current = () => {}) => {
    const fresh = evaluateFreshness(await check(record.wallet,file));
    current();
    if (!['within-expiry','wallet-behind'].includes(fresh.status)) throw fail('Synchronize the test wallet and check this transaction before signing.');
    validateEffects(await effects(record.wallet,file,record),record);
    current();
    const terms = termsFor(record,fresh);
    if (expected) assert.equal(sha(JSON.stringify(terms)),expected,'Approved transaction terms changed');
    const readiness = await preflight(record.wallet,file,record);
    current();
    assert(readiness?.network === 'testnet' && readiness.wallet === record.wallet && readiness.txid === terms.txid
      && readiness.currentInputs === true && readiness.witnessVerified === true && readiness.walletHeight === fresh.walletHeight,'Current input or witness readiness is unavailable');
    if (fresh.status === 'wallet-behind' || readiness.serverHeight !== undefined) assert(readiness.canonicalHeight === fresh.walletHeight && fingerprint(readiness.canonicalHash)
      && readiness.maximumScanLag === 10 && Number.isSafeInteger(readiness.serverHeight) && readiness.serverHeight >= fresh.serverHeight
      && readiness.serverHeight-fresh.walletHeight <= 10,'The canonical input snapshot is too old or unavailable');
    assert.equal(await fileHash(file),record.sha256,'Unsigned transaction changed during review');
    return terms;
  };
  return async (action,input,{signal} = {}) => {
    const current = () => { if(signal?.aborted) {lease=null;throw fail('Payment approval was interrupted.');} };
    current();
    if (!['status','review','sign','recover-signature','submit','reconcile'].includes(action) || !input || !['a','b'].includes(input.wallet) || !identifier(input.id)) throw fail('Choose a saved test payment.',400);
    const bound = ['sign','recover-signature','submit'].includes(action);
    const keys = bound ? 'binding,id,wallet' : 'id,wallet';
    if (Object.keys(input).sort().join(',') !== keys || (bound && !fingerprint(input.binding))) throw fail('Use the exact saved payment approval.',400);
    await mkdir(directory,{recursive:true});
    if (action === 'status') {
      const record = await read();
      if (record) { matching(record,input); if (['signed','submitting','submitted','unknown','confirmed','expired'].includes(record.state)) await checkedSigned(record); }
      return publicRecord(record);
    }
    let lock;
    try { lock = await open(join(directory,'execution.lock'),'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw fail('A native payment operation is running or needs interruption recovery.'); throw error; }
    try {
      let record = await read();
      if (action === 'review') {
        lease = null;
        if (record && record.state !== 'reviewed') { matching(record,input); throw fail('This transaction already has signing or submission state. Open its status.'); }
        const snapshot = await reviewSnapshot(input);
        const terms = await validateCurrent(snapshot,undefined,current);
        record = {version:1,terms,binding:sha(JSON.stringify(terms)),state:'reviewed'};
        await save(record);
        current();
        lease = {binding:record.binding,at:now()};
        return publicRecord(record);
      }
      matching(record,input);
      if (action === 'sign') {
        const approval = lease; lease = null;
        if (record.state !== 'reviewed' || input.binding !== record.binding || !approvalCurrent(approval,record.binding)) throw fail('Reopen the exact payment review before signing.');
        const snapshot = await reviewSnapshot(input);
        await validateCurrent(snapshot,record.binding,current);
        record.state = 'signing'; await save(record);
        try {
          current();
          const result = await sign(input.wallet,snapshot.file,signedFile(record),record.terms,{signal});
          current();
          assert(result?.txid === record.terms.txid,'Signed transaction ID differs from the review');
          record.signedSha256 = await fileHash(signedFile(record));
          assert.equal(await fileHash(snapshot.file),record.terms.unsignedSha256,'Unsigned transaction changed while signing');
          record.state = 'signed'; await save(record);
        } catch (error) { record.state = 'signing-unknown'; await save(record); throw error; }
      } else if (action === 'recover-signature') {
        lease = null;
        if (record.state !== 'signing-unknown' || record.attempt || input.binding !== record.binding) throw fail('Open the same interrupted signing attempt before recovering its artifact.');
        const candidate = await fileHash(signedFile(record));
        const result = await recover(input.wallet,signedFile(record),{...record.terms,signedSha256:candidate},{signal});
        current();
        assert(result?.txid === record.terms.txid,'Recovered transaction ID differs from approval');
        assert.equal(await fileHash(signedFile(record)),candidate,'Signed transaction changed during recovery');
        record.signedSha256 = candidate; record.state = 'signed'; await save(record);
      } else if (action === 'submit') {
        if (record.state !== 'signed' || input.binding !== record.binding || record.attempt) throw fail('Submission was already attempted or the exact approval is missing. Reconcile this transaction.');
        await checkedSigned(record);
        record.state = 'submitting'; record.attempt = {at:new Date(now()).toISOString(),txid:record.terms.txid,signedSha256:record.signedSha256}; await save(record);
        try {
          current();
          const result = await submit(input.wallet,signedFile(record),{...record.terms,signedSha256:record.signedSha256},{signal});
          current();
          assert(result?.txid === record.terms.txid,'Submission returned a different transaction ID');
          await checkedSigned(record); record.state = 'submitted'; await save(record);
        } catch (error) { record.state = 'unknown'; await save(record); throw error; }
      } else {
        if(record.state==='expired'){await checkedSigned(record);return publicRecord(record);}
        if(record.state==='signed'&&!record.attempt){
          await checkedSigned(record);const snapshot=await reviewSnapshot(input);
          const result=await expire(input.wallet,signedFile(record),{...record.terms,signedSha256:record.signedSha256},{unsignedFile:snapshot.file,signal});
          current();await checkedSigned(record);assert.equal(await fileHash(snapshot.file),record.terms.unsignedSha256,'Unsigned transaction changed during expiry recovery');
          assert(result?.network==='testnet'&&result.wallet===input.wallet&&result.txid===record.terms.txid&&['unknown','expired'].includes(result.status),'Invalid native expiry observation');
          if(result.status==='expired'){record.expiryEvidence=checkedExpiry(result,record);record.state='expired';await save(record);}
          return publicRecord(record);
        }
        if (!record.attempt || !['submitting','submitted','unknown','confirmed'].includes(record.state)) throw fail('This payment has no submitted transaction to reconcile.');
        await checkedSigned(record);
        record.state = 'unknown'; delete record.confirmations; await save(record);
        const result = await observe(input.wallet,record.terms);
        current();
        await checkedSigned(record);
        assert(result?.network === 'testnet' && result.wallet === input.wallet && result.txid === record.terms.txid && ['unknown','pending','confirmed'].includes(result.status),'Invalid transaction observation');
        if (result.status === 'confirmed') {
          assert(result.recipient === record.terms.recipient && result.pool === 'ironwood');
          assert(Number.isSafeInteger(result.minedHeight) && result.minedHeight > 0 && result.recipientMinedHeight === result.minedHeight);
          assert(Number.isSafeInteger(result.sourceHeight) && Number.isSafeInteger(result.recipientHeight));
          const confirmations = Math.min(result.sourceHeight,result.recipientHeight)-result.minedHeight+1;
          assert(confirmations >= 10 && result.sourceDelta === record.terms.totalDebit && result.recipientDelta === record.terms.amount,'Final shielded payment effects do not match');
          record.state = 'confirmed'; record.confirmations = confirmations; await save(record);
        } else if (result.status === 'pending') {
          record.state = 'submitted'; await save(record);
        }
      }
      return publicRecord(record);
    } finally { await lock.close(); await unlink(join(directory,'execution.lock')); }
  };
}
