const check=(ok,message)=>{if(!ok)throw Error(message);};
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const units=value=>typeof value==='string'&&/^[1-9][0-9]{0,7}$/.test(value)&&BigInt(value)<=10000000n;
export const ZCASH_INTENT_ROUTE='native-zcash-ironwood-testnet/v1';
export const ZCASH_INTENT_ASSET='zcash:testnet:ZEC';
export const ZCASH_INTENT_CHAIN='zcash:testnet';
export const zcashSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function zcashPaymentTerms(review){
 const native=review.native;
 return {version:1,network:native.network,pool:native.pool,id:native.id,wallet:native.wallet,recipient:native.recipient,address:native.address,amount:native.amount,fee:native.fee,change:native.change,totalDebit:native.totalDebit,txid:native.txid,unsignedSha256:native.unsignedSha256,memoBinding:native.memoBinding,expiryHeight:native.expiryHeight};
}
export function zcashTestUnits(value){
 check(typeof value==='string'&&/^0\.[0-9]{1,8}$/.test(value),'Enter between 0.00000001 and 0.1 test ZEC.');
 const amount=BigInt(value.slice(2).padEnd(8,'0')).toString();check(units(amount),'Enter between 0.00000001 and 0.1 test ZEC.');return amount;
}
export function formatZcashAmount(value){
 if(value===null||value===undefined)return 'Unknown';check(typeof value==='string'&&/^[0-9]{1,16}$/.test(value),'The test ZEC amount is unavailable.');
 const amount=BigInt(value),fraction=(amount%100000000n).toString().padStart(8,'0').replace(/0+$/,'');return (amount/100000000n).toString()+(fraction?'.'+fraction:'')+' test ZEC';
}
export function zcashTestSelection(source,recipient,amount,{requestId=crypto.randomUUID(),deadline=Date.now()+1800000}={}){
 const value=zcashTestUnits(amount);check(uuid(requestId),'The payment request cannot be identified.');
 return {requestId,route:ZCASH_INTENT_ROUTE,action:'pay',privacy:'private',source:{chainId:ZCASH_INTENT_CHAIN,asset:ZCASH_INTENT_ASSET,accountId:source,amount:value},destination:{chainId:ZCASH_INTENT_CHAIN,asset:ZCASH_INTENT_ASSET,accountId:recipient,minAmount:value},deadline};
}
export function checkZcashSelection(value){
 check(value?.route===ZCASH_INTENT_ROUTE&&uuid(value.requestId)&&value.action==='pay'&&value.privacy==='private','Choose the native shielded testnet payment.');
 check(value.source?.chainId===ZCASH_INTENT_CHAIN&&value.destination?.chainId===ZCASH_INTENT_CHAIN&&value.source.asset===ZCASH_INTENT_ASSET&&value.destination.asset===ZCASH_INTENT_ASSET,'Use test ZEC on Zcash testnet.');
 check(typeof value.source.accountId==='string'&&/^native-zcash:[ab]:[0-9a-f]{64}$/.test(value.source.accountId),'Open the original native source.');
 check(typeof value.destination.accountId==='string'&&/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,250}$/.test(value.destination.accountId),'Choose the configured shielded testnet recipient.');
 check(units(value.source.amount)&&value.source.amount===value.destination.minAmount&&Number.isSafeInteger(value.deadline)&&value.deadline>0,'Review the exact payment amount and deadline.');return structuredClone(value);
}
export function checkZcashReview(review,chosen){
 const selection=checkZcashSelection(chosen),terms=review?.native;
 check(review?.id===selection.requestId&&review.route===ZCASH_INTENT_ROUTE&&review.action===selection.action&&review.privacy===selection.privacy&&review.deadline===selection.deadline&&zcashSame(review.source,selection.source)&&zcashSame(review.destination,selection.destination),'The native route changed the selected payment.');
 check(uuid(terms?.id)&&['a','b'].includes(terms.wallet)&&selection.source.accountId.startsWith('native-zcash:'+terms.wallet+':')&&terms.recipient===(terms.wallet==='a'?'b':'a')&&terms.network==='testnet'&&terms.pool==='ironwood'&&terms.address===selection.destination.accountId&&terms.amount===selection.source.amount,'The native payment terms changed.');
 check(hash(terms.txid)&&hash(terms.unsignedSha256)&&hash(terms.memoBinding)&&hash(terms.binding)&&/^[1-9][0-9]{0,4}$/.test(terms.fee)&&BigInt(terms.fee)<=10000n&&/^[1-9][0-9]{0,15}$/.test(terms.change)&&terms.totalDebit===(BigInt(terms.amount)+BigInt(terms.fee)).toString(),'The signed payment debit or fingerprint changed.');
 check(Number.isSafeInteger(terms.expiryHeight)&&terms.expiryHeight>0&&terms.memos==='empty'&&Number.isSafeInteger(review.reviewedAt)&&review.reviewedAt>0&&review.authorization?.custody==='local-native'&&review.authorization.label==='Approve & sign native payment','Review the native custody and exact empty memos.');
 check(review.authorityId===terms.txid+':'+terms.unsignedSha256&&review.fees?.length===1&&review.fees[0].amount===terms.fee&&review.fees[0].asset===ZCASH_INTENT_ASSET,'The payment fee or source authority changed.');
 check(typeof review.privacyDisclosure==='string'&&review.privacyDisclosure.length>0&&typeof review.recoveryDisclosure==='string'&&review.recoveryDisclosure.length>0,'The native route disclosure is unavailable.');return structuredClone(review);
}
export function checkZcashAuthorization(value,review){
 check(value?.intentId===review.id&&hash(value.signedSha256)&&value.artifactId===value.signedSha256&&value.paymentBinding===review.native.binding&&value.txid===review.native.txid&&value.custody==='local-native','The saved native signature differs from this approval.');return structuredClone(value);
}
export function checkZcashOutcome(value,attempt){
 const review=checkZcashReview(attempt.review,attempt.review),authorization=checkZcashAuthorization(attempt.authorization,review);
 check(value?.intentId===review.id&&value.artifactId===authorization.artifactId&&['unknown','pending','executed','expired'].includes(value.status)&&(value.resubmissionSafe!==true||value.status==='pending'&&value.nativeState==='signed'),'Check the original native transaction.');
 if(value.status==='executed'){
  const evidence=value.evidence;check(value.verified===true&&evidence?.network==='testnet'&&evidence.verifier==='native-canonical-wallet-effects/v1'&&evidence.pool==='ironwood'&&evidence.transaction===review.native.txid&&evidence.recipient===review.destination.accountId&&evidence.inputAmount===review.native.totalDebit&&evidence.outputAmount===review.native.amount&&evidence.fee===review.native.fee&&Number.isSafeInteger(evidence.confirmations)&&evidence.confirmations>=10,'The canonical native payment effects are unavailable.');
 }else if(value.status==='expired'){
  const evidence=value.evidence;check(value.verified===true&&value.resubmissionSafe===false&&value.nativeState==='expired'&&evidence?.network==='testnet'&&evidence.verifier==='native-canonical-expiry/v1'&&evidence.pool==='ironwood'&&evidence.transaction===review.native.txid&&evidence.signedSha256===authorization.signedSha256&&evidence.unsignedSha256===review.native.unsignedSha256&&evidence.expiryHeight===review.native.expiryHeight
   && [evidence.sourceHeight,evidence.recipientHeight].every(height=>Number.isSafeInteger(height)&&height>=review.native.expiryHeight+10&&height<499999999)&&hash(evidence.sourceCanonicalHash)&&hash(evidence.recipientCanonicalHash)&&evidence.paymentAbsent===true&&evidence.inputUnspent===true&&evidence.inputAmount===undefined&&evidence.outputAmount===undefined&&evidence.fee===undefined,'The original payment expiry and unchanged input are unavailable.');
 }else check(value.verified!==true,'A pending payment is not a verified result.');return structuredClone(value);
}
