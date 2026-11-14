import {Transaction} from './evm-vendor/aurora-transaction.js';
import {keccak256} from './evm-vendor/offline-budget.js';
import {checkLendingCrosschainQuote} from './intent-lending-crosschain.js';
import {LENDING_TESTNET} from './intent-lending-config.js';

const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&BigInt(value)>0n;
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const hex=value=>'0x'+BigInt(value).toString(16);
const word=value=>BigInt(value).toString(16).padStart(64,'0');
const digest=value=>keccak256(new TextEncoder().encode(JSON.stringify(value)));
const topic=value=>keccak256(new TextEncoder().encode(value));
const native='0x'+'0'.repeat(40);
const empty=()=>({draft:null,review:null,attempts:[]});
const storeOwner=sender=>JSON.stringify(['eip155:84532',sender]);
export const LENDING_CROSSCHAIN_PINS=Object.freeze({
  sourceChainId:84532,sourceChain:'eip155:84532',sourceChainHex:'0x14a34',sourceRpc:'https://sepolia.base.org',
  depository:'0x5feab8db4534f9f7e2669bb260c57a01ad1c12e3',depositoryCodeHash:'0x6893ed34d4eae95694ad933f234144aee86a3adeba21e2bd27a974dc8c554787',
  sourceRouter:'0xf5042e6ffac5a625d4e7848e0b01373d8eb9e222',sourceRouterCodeHash:'0xcac636d7d6f70010af1282ad61f552d0206237f3bd462ae0d3037fa61efff636',
  destinationRouter:'0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab',destinationRouterCodeHash:'0xa04fa7f7868504736b04db891b71499e8824fbe0a04f22df2e02b91a639f3679',
});
const pins=LENDING_CROSSCHAIN_PINS;
const sourceTopic=topic('RelayNativeDeposit(address,uint256,bytes32)');
const depositTopic=topic('Deposit(bytes32,uint32,uint256)');
const transferTopic=topic('Transfer(address,address,uint256)');

function selection(input){return {action:'fund-lending',source:{chainId:pins.sourceChain,asset:native,accountId:input.plan.sender,amount:input.quote.steps[0].items[0].data.value},destination:{chainId:LENDING_TESTNET.chain,asset:LENDING_TESTNET.link,accountId:input.account,minAmount:LENDING_TESTNET.denomination},privacy:'public',deadline:input.plan.deadline};}
function transactionFor(quote,nonce){const tx=quote.steps[0].items[0].data;return {from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),chainId:pins.sourceChainHex,nonce:hex(nonce),data:tx.data,value:hex(tx.value),gas:hex(tx.gas),maxFeePerGas:hex(tx.maxFeePerGas),maxPriorityFeePerGas:hex(tx.maxPriorityFeePerGas)};}
function checkedInput(input,{config,now}){
  check(input&&Object.keys(input).sort().join()==='account,owner,ownerAddress,plan,quote'&&typeof input.owner==='string'&&/^[0-9a-f]{64}$/.test(input.owner)&&address(input.ownerAddress)&&address(input.account),'Choose the original recoverable lending account and note.');
  check(input.plan.privacyPool===config.privacyPool,'The original funding pool changed.');checkLendingCrosschainQuote(input.quote,input.plan,{now});return input;
}
export function checkLendingCrosschainReview(value,{config=LENDING_TESTNET,now=Date.now(),allowExpired=false}={}){
  check(value&&Object.keys(value).sort().join()==='account,action,createdAt,deadline,destination,id,owner,ownerAddress,plan,privacy,quote,source,sourceBlock,transaction,type'&&value.type==='LendingCrosschainFundingReview'&&Number.isSafeInteger(value.createdAt)&&value.createdAt>0,'The original cross-chain review is invalid.');
  checkedInput({owner:value.owner,ownerAddress:value.ownerAddress,account:value.account,plan:value.plan,quote:value.quote},{config,now:value.createdAt});
  for(const [key,expected]of Object.entries(selection(value)))check(same(value[key],expected),'The cross-chain source or destination changed.');
  check(quantity(value.transaction?.nonce)&&same(value.transaction,transactionFor(value.quote,value.transaction.nonce)),'The original wallet transaction changed.');
  checkBlock(value.sourceBlock,'latest');
  const {id,...body}=value;check(id==='lending-crosschain:'+digest(body).slice(2),'The original cross-chain review changed.');
  check(allowExpired||now<value.deadline,'The cross-chain funding review expired.');return structuredClone(value);
}
export function checkLendingCrosschainAuthorization(value,review){
  check(value&&Object.keys(value).sort().join()==='artifactId,intentId,transactionHash'&&value.intentId===review.id&&hash(value.transactionHash)&&value.artifactId===value.transactionHash,'The original source transaction authorization changed.');return structuredClone(value);
}
function checkBlock(block,finality){check(block?.finality===finality&&block.requireCanonical===true&&uint(block.number)&&uint(block.timestamp)&&hash(block.hash),'The canonical cross-chain block is unavailable.');}
function checkDestination(snapshot,input,config,now){
  check(snapshot?.chainId===config.chain&&snapshot.routeVerified===true&&snapshot.trust?.codePinsVerified===true&&snapshot.trust.implementationPinsVerified===true&&snapshot.trust.executionPinsVerified===true&&Number.isSafeInteger(snapshot.observedAt)&&Math.abs(now-snapshot.observedAt)<=120000,'The destination funding route is unavailable.');checkBlock(snapshot.block,'finalized');
  check(snapshot.account?.status==='verified'&&snapshot.account.address===input.account&&snapshot.account.owner===input.ownerAddress&&snapshot.account.route?.factory===config.lendingFactory,'The original destination account changed.');
  const pool=snapshot.privatePool,route=snapshot.crosschain;
  check(pool?.address===config.privacyPool&&Array.isArray(pool.commitments)&&Array.isArray(pool.deposits)&&pool.commitments.length===pool.deposits.length&&new Set(pool.commitments).size===pool.commitments.length,'The original private-pool history is unavailable.');
  check(route?.router===pins.destinationRouter&&route.routerCodeHash===pins.destinationRouterCodeHash&&uint(route.allowance)&&route.commitmentExists===pool.commitments.includes(input.plan.commitment),'The destination router, allowance or commitment changed.');
  return pool.deposits.find(row=>row.commitment===input.plan.commitment)??null;
}
function checkPreflight(value,input,config,now){
  const source=value?.source;check(Number.isSafeInteger(value?.observedAt)&&Math.abs(now-value.observedAt)<=120000&&source?.chainId===pins.sourceChainId&&source.sender===input.plan.sender&&uint(source.nonce)&&BigInt(source.nonce)<=BigInt(Number.MAX_SAFE_INTEGER)&&uint(source.balance)&&uint(source.gasEstimate)&&source.depositoryCodeHash===pins.depositoryCodeHash&&source.routerCodeHash===pins.sourceRouterCodeHash&&source.senderCode==='0x','The original source wallet or funding code changed.');checkBlock(source.block,'latest');
  const quoted=input.quote.steps[0].items[0].data;
  check(BigInt(source.balance)>=BigInt(quoted.value)+BigInt(quoted.gas)*BigInt(quoted.maxFeePerGas)&&BigInt(source.gasEstimate)<=BigInt(quoted.gas)&&source.simulated===true,'The original source amount or gas is unavailable.');
  check(!checkDestination(value.destination,input,config,now)&&value.destination.crosschain.allowance==='0','The original private commitment is already funded or its allowance is unresolved.');return source;
}
export function checkLendingCrosschainSourceTransaction(value,review){
  check(value&&hash(value.hash)&&typeof value.raw==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(value.raw)&&value.raw.length<=4096,'The original source transaction cannot be verified.');
  const tx=Transaction.from(value.raw),expected=review.transaction;
  check(tx.isSigned()&&tx.type===2&&tx.chainId===84532n&&tx.from.toLowerCase()===expected.from&&tx.to?.toLowerCase()===expected.to&&tx.data===expected.data&&tx.value===BigInt(expected.value)&&BigInt(tx.nonce)===BigInt(expected.nonce)&&tx.gasLimit===BigInt(expected.gas)&&tx.maxFeePerGas===BigInt(expected.maxFeePerGas)&&tx.maxPriorityFeePerGas===BigInt(expected.maxPriorityFeePerGas)&&(tx.accessList?.length??0)===0&&tx.hash===value.hash&&keccak256(value.raw)===value.hash,'The source wallet sent another transaction.');return value.hash;
}
function canonicalReceipt(receipt,block,transactionHash,finalized){
  check(receipt?.transactionHash===transactionHash&&hash(receipt.blockHash)&&quantity(receipt.blockNumber)&&['0x0','0x1'].includes(receipt.status)&&Array.isArray(receipt.logs)&&receipt.logs.length<=500&&block?.hash===receipt.blockHash&&quantity(block.number)&&BigInt(block.number)===BigInt(receipt.blockNumber),'The original receipt is not canonical.');
  const indexes=new Set();for(const log of receipt.logs){check(log.removed!==true&&log.transactionHash===transactionHash&&log.blockHash===receipt.blockHash&&log.blockNumber===receipt.blockNumber&&quantity(log.logIndex)&&!indexes.has(log.logIndex),'The original receipt log changed.');indexes.add(log.logIndex);}
  return BigInt(finalized.number)>=BigInt(receipt.blockNumber);
}
function sourceWitness(receipt,review){
  const expected='0x'+word(review.plan.sender)+word(review.source.amount)+review.quote.protocol.v2.orderId.slice(2);
  check(receipt.from?.toLowerCase()===review.plan.sender&&receipt.to?.toLowerCase()===pins.depository,'The original source receipt changed.');
  const logs=receipt.logs.filter(log=>log.address?.toLowerCase()===pins.depository&&same(log.topics,[sourceTopic])&&log.data===expected);
  check(logs.length===1,'The original source deposit or Relay order is missing.');
}
function destinationWitness(receipt,deposit,review){
  check(receipt.status==='0x1'&&receipt.blockHash===deposit.blockHash&&BigInt(receipt.blockNumber).toString()===deposit.blockNumber,'The original destination deposit receipt changed.');
  const events=receipt.logs.filter(log=>log.address?.toLowerCase()===review.plan.privacyPool&&same(log.topics,[depositTopic,review.plan.commitment])&&typeof log.data==='string'&&/^0x[0-9a-f]{128}$/.test(log.data)&&BigInt('0x'+log.data.slice(2,66))===BigInt(deposit.index));
  const moved=receipt.logs.filter(log=>log.address?.toLowerCase()===LENDING_TESTNET.link&&same(log.topics,[transferTopic,'0x'+word(pins.destinationRouter),'0x'+word(review.plan.privacyPool)])&&log.data==='0x'+word(LENDING_TESTNET.denomination));
  check(events.length===1&&moved.length===1,'The original private note or exact LINK transfer is missing.');
}
export function checkLendingCrosschainOutcome(value,review){
  check(value?.intentId===review.id&&value.orderId===review.quote.protocol.v2.orderId&&value.requestId===review.quote.requestId&&value.commitment===review.plan.commitment&&['pending','unknown','funded','failed'].includes(value.status)&&value.verified===(value.status==='funded'||value.status==='failed'),'The original cross-chain result changed.');
  if(value.verified)check(hash(value.transactionHash)&&value.evidence?.source?.transactionHash===value.transactionHash,'The original source result is missing.');
  if(value.status==='funded')check(value.evidence?.destination?.commitment===review.plan.commitment&&value.evidence.destination.amount===LENDING_TESTNET.denomination&&value.evidence.destination.pool===review.plan.privacyPool&&value.evidence.destination.allowance==='0'&&hash(value.evidence.destination.transactionHash),'The original funded note evidence is missing.');
  return structuredClone(value);
}
const result=(review,status='unknown',fields={})=>checkLendingCrosschainOutcome({intentId:review.id,orderId:review.quote.protocol.v2.orderId,requestId:review.quote.requestId,commitment:review.plan.commitment,status,verified:status==='funded'||status==='failed',...fields},review);

export function createLendingCrosschainFundingService({source,store,reader,requireRecovery,config=LENDING_TESTNET,now=Date.now,timeoutMs=60000}={}){
  check(source&&store&&reader&&typeof requireRecovery==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Open the recoverable cross-chain funding source.');
  async function retained(review){const state=await store.read(storeOwner(review.plan.sender)),row=state.attempts.find(value=>value.id===review.id);check(row&&same(row.review,review),'The original cross-chain request is not retained.');if(row.authorization)checkLendingCrosschainAuthorization(row.authorization,review);return row;}
  async function change(review,operation){const owner=storeOwner(review.plan.sender);const saved=await store.update(owner,async state=>{await operation(state);return state;});check(same(await store.read(owner),saved),'The original cross-chain request was not durably saved.');return saved.attempts.find(row=>row.id===review.id);}
  function leaseFor(review){const lease=source.capture();check(lease.identity?.chainId===pins.sourceChainHex&&lease.identity.address===review.plan.sender,'Connect the original source wallet on Base Sepolia.');lease.assertCurrent();return lease;}
  async function prepare(input,{signal}={}){
    checkedInput(input,{config,now:now()});const lease=leaseFor(input);signal?.throwIfAborted();
    const checked=checkPreflight(await reader.preflight(input,{signal}),input,config,now());lease.assertCurrent();signal?.throwIfAborted();
    const body={type:'LendingCrosschainFundingReview',...selection(input),owner:input.owner,ownerAddress:input.ownerAddress,account:input.account,plan:structuredClone(input.plan),quote:structuredClone(input.quote),createdAt:now(),sourceBlock:structuredClone(checked.block),transaction:transactionFor(input.quote,checked.nonce)};
    const review=checkLendingCrosschainReview({...body,id:'lending-crosschain:'+digest(body).slice(2)},{config,now:now()});
    await change(review,state=>{check(!state.attempts.some(row=>!['declined','executed'].includes(row.status)&&row.outcome?.status!=='failed'),'Check the original funding request before reviewing another.');state.review=review;});return review;
  }
  async function reconcile(review,{transactionHash,signal}={}){
    review=checkLendingCrosschainReview(review,{config,allowExpired:true});const row=await retained(review);
    if(row.outcome?.verified)return checkLendingCrosschainOutcome(row.outcome,review);
    const candidate=transactionHash??row.authorization?.transactionHash??row.candidateHash;
    check(!row.authorization||!transactionHash||transactionHash===row.authorization.transactionHash,'Keep the original verified source transaction.');
    if(candidate!==undefined&&candidate!==null)check(hash(candidate),'Enter the original transaction hash from your wallet.');
    const observed=await reader.observe({review,transactionHash:candidate??null},{signal});
    check(Number.isSafeInteger(observed?.observedAt)&&Math.abs(now()-observed.observedAt)<=120000,'The funding observation is stale.');
    const s=observed.source;check(s?.chainId===pins.sourceChainId&&s.depositoryCodeHash===pins.depositoryCodeHash,'The original source network or depository changed.');checkBlock(s.block,'finalized');
    if(!s.transaction)return result(review,'unknown',{...(candidate?{candidateHash:candidate}:{}),description:'Check the original transaction in your source wallet.'});
    const verifiedHash=checkLendingCrosschainSourceTransaction(s.transaction,review);check(!candidate||candidate===verifiedHash,'The source transaction hash changed.');
    const authorization={intentId:review.id,artifactId:verifiedHash,transactionHash:verifiedHash};
    await change(review,state=>{const saved=state.attempts.find(value=>value.id===review.id);check(saved&&same(saved.review,review)&&(!saved.authorization||saved.authorization.transactionHash===verifiedHash),'The original source request changed.');saved.authorization=authorization;saved.status='submission-unresolved';saved.candidateHash=verifiedHash;});
    let outcome=result(review,'pending',{transactionHash:verifiedHash,description:'Awaiting finalized source confirmation.'});
    if(s.receipt&&canonicalReceipt(s.receipt,s.receiptBlock,verifiedHash,s.block)){
      const sourceEvidence={transactionHash:verifiedHash,blockHash:s.receipt.blockHash,blockNumber:BigInt(s.receipt.blockNumber).toString(),orderId:review.quote.protocol.v2.orderId,amount:review.source.amount};
      if(s.receipt.status==='0x0')outcome=result(review,'failed',{transactionHash:verifiedHash,evidence:{source:sourceEvidence},description:'The source transaction failed. Only its network fee was spent.'});
      else{
        sourceWitness(s.receipt,review);const deposit=checkDestination(observed.destination,review,config,now());
        outcome=result(review,'pending',{transactionHash:verifiedHash,description:'Source confirmed. Checking the original private deposit.'});
        if(deposit){check(hash(deposit.transactionHash)&&Number.isSafeInteger(deposit.index)&&deposit.index>=0&&deposit.index<4096,'The original private deposit is invalid.');const receipt=observed.destinationReceipt;
          check(canonicalReceipt(receipt,observed.destinationReceiptBlock,deposit.transactionHash,observed.destination.block),'The original destination deposit is not finalized.');destinationWitness(receipt,deposit,review);check(observed.destination.crosschain.allowance==='0','The destination allowance remains unresolved.');
          outcome=result(review,'funded',{transactionHash:verifiedHash,evidence:{source:sourceEvidence,destination:{...deposit,chainId:config.chain,pool:config.privacyPool,asset:config.link,amount:config.denomination,allowance:'0',checkedBlockNumber:observed.destination.block.number,checkedBlockHash:observed.destination.block.hash}},description:'The original private LINK note is funded.'});
        }
      }
    }
    await change(review,state=>{const saved=state.attempts.find(value=>value.id===review.id);check(saved&&saved.authorization?.transactionHash===verifiedHash,'The original source request changed.');saved.outcome=outcome;if(outcome.status==='funded')saved.status='executed';});return outcome;
  }
  async function submit(review,{signal}={}){
    review=checkLendingCrosschainReview(review,{config,now:now()});const lease=leaseFor(review),owner=storeOwner(review.plan.sender),existing=(await store.read(owner)).attempts.find(row=>row.id===review.id);
    if(existing&&existing.status!=='declined')return reconcile(review,{signal});
    const observed=checkPreflight(await reader.preflight({owner:review.owner,ownerAddress:review.ownerAddress,account:review.account,plan:review.plan,quote:review.quote},{signal}),review,config,now());
    check(hex(observed.nonce)===review.transaction.nonce,'The source nonce changed. Review the funding request again.');lease.assertCurrent();signal?.throwIfAborted();
    await change(review,state=>{check(same(state.review,review)&&!state.attempts.some(row=>row.status!=='declined'&&row.status!=='executed'&&row.outcome?.status!=='failed'),'Check the original source payment before trying again.');const row={id:review.id,authorityId:pins.sourceChain+':'+review.plan.sender+':'+review.transaction.nonce,review,createdAt:now(),status:'approval-unresolved',authorization:null,outcome:null,candidateHash:null};const index=state.attempts.findIndex(value=>value.id===review.id);if(index<0)state.attempts.push(row);else state.attempts[index]=row;});
    let dispatched=false,timer;
    const operation=(async()=>{
      try{await requireRecovery({review,signal});lease.assertCurrent();signal?.throwIfAborted();check(now()<review.deadline,'The cross-chain funding review expired.');
        const [accounts,chain,nonce]=await Promise.all([lease.request('eth_accounts',[]),lease.request('eth_chainId',[]),lease.request('eth_getTransactionCount',[review.plan.sender,'pending'])]);
        check(accounts?.[0]?.toLowerCase()===review.plan.sender&&chain===pins.sourceChainHex&&nonce===review.transaction.nonce,'The source wallet, network or nonce changed.');lease.assertCurrent();signal?.throwIfAborted();
        dispatched=true;const candidateHash=await lease.sendTransaction(structuredClone(review.transaction));check(hash(candidateHash),'The wallet did not return an original transaction hash.');
        await change(review,state=>{const row=state.attempts.find(value=>value.id===review.id);check(row&&same(row.review,review),'The original funding request changed.');row.candidateHash=candidateHash;});
        return await reconcile(review);
      }catch(error){if(!dispatched||error?.code===4001)await change(review,state=>{const row=state.attempts.find(value=>value.id===review.id);if(row&&!row.authorization&&!row.candidateHash)row.status='declined';});return result(review,'unknown',{description:dispatched?'Check the original transaction in your source wallet.':error.message});}
    })();
    try{return await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve(result(review,'unknown',{description:'The wallet reply is delayed. Check the original transaction.'})),timeoutMs);})]);}finally{clearTimeout(timer);}
  }
  return Object.freeze({prepare,submit,reconcile,async pending(sender){check(address(sender),'Choose the original source wallet.');return structuredClone((await store.read(storeOwner(sender))).attempts);}});
}
