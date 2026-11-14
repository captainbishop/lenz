import { Interface, keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { createLendingReader } from './intent-lending-read.mjs';
import { checkLendingSupplyPreparation,checkLendingSupplyPublicRequest } from './public/intent-lending-supply.js';

const check = (value, reason) => { if (!value) throw Error(reason); };
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const scalar = value => hash(value) && BigInt(value) > 0n && BigInt(value) < field;
const tuple = '(address beneficiary,address refundRecipient,uint256 minScaledCredit,uint256 deadline,bytes32 salt)';
const abi = new Interface([`function vaultAddress(${tuple}) view returns(address)`,
  'function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)','function commitments(bytes32) view returns(bool)',
  'function isKnownRoot(bytes32) view returns(bool)','function isSpent(bytes32) view returns(bool)','function verifyProof(bytes,uint256[6]) view returns(bool)',
  'function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)',
  ...['inputToken','aavePool','aToken','beneficiary','refundRecipient'].map(name => `function ${name}() view returns(address)`),
  ...['inputAmount','minScaledCredit','deadline','chainId','status'].map(name => `function ${name}() view returns(uint256)`),
  ...['salt','inputCodeHash','aavePoolCodeHash','aTokenCodeHash'].map(name => `function ${name}() view returns(bytes32)`),
  'event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)',
]);
function abortable(work, signal) {
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(work).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

export function createLendingSupplyReader({deployment = {},fetchImpl = fetch,now = Date.now,readSnapshot,timeoutMs = 60000,blockTag = 'finalized'} = {}) {
  const config = {...LENDING_TESTNET,...deployment};
  check(decimal(config.privacyPoolDeploymentBlock) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 && ['finalized','latest'].includes(blockTag), 'Pin the original Supply pool deployment block and read timeout.');
  const baseDeployment = Object.fromEntries(Object.entries(deployment).filter(([key]) => ['lendingFactory','privacyPool','supplyFactory','verifier','hasher','codeHashes','implementationPins'].includes(key)));
  const baseSnapshot = readSnapshot ?? createLendingReader({deployment:baseDeployment,fetchImpl,now}).snapshot;
  let sequence = 0;
  async function rpc(method,params,signal) {
    const id = ++sequence;
    const response = await abortable(fetchImpl(config.rpc,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal,body:JSON.stringify({jsonrpc:'2.0',id,method,params})}),signal);
    check(response.ok && !response.redirected && response.body, 'The original Supply network is unavailable.');
    const stream = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) { const {done,value} = await abortable(stream.read(),signal); if (done) break; length += value.byteLength; check(length <= 2000000, 'The Supply read response is too large.'); chunks.push(value); }
    } finally { stream.cancel().catch(() => {}); stream.releaseLock(); }
    let body; try { body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); } catch { throw Error('The Supply read response cannot be decoded.'); }
    check(body?.jsonrpc === '2.0' && body.id === id && !Object.hasOwn(body,'error') && Object.hasOwn(body,'result'), 'The Supply RPC evidence is invalid.'); return body.result;
  }
  async function observe(input,request,options = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const snapshot = await abortable(baseSnapshot(input,{signal,blockTag}),signal), block = snapshot?.block;
    check(snapshot?.chainId === config.chain && snapshot.routeVerified === true && snapshot.trust?.executionPinsVerified === true && snapshot.trust.codePinsVerified === true && snapshot.trust.implementationPinsVerified === true && Number.isSafeInteger(snapshot.observedAt) && Math.abs(now() - snapshot.observedAt) <= 120000 && block?.finality === blockTag && block.requireCanonical === true && decimal(block.number) && decimal(block.timestamp) && hash(block.hash), 'The canonical pinned Supply snapshot is unavailable.');
    check(await rpc('eth_chainId',[],signal) === config.chainHex, 'The Supply network changed.');
    const ref = {blockHash:block.hash,requireCanonical:true};
    async function read(target,name,...args) {
      const value = await rpc('eth_call',[{to:target,data:abi.encodeFunctionData(name,args)},ref],signal);
      check(typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(value) && value.length <= 32768, 'The original Supply contract response is invalid.');
      let result; try { result = abi.decodeFunctionResult(name,value); check(abi.encodeFunctionResult(name,result).toLowerCase() === value, 'Noncanonical Supply contract result.'); } catch { throw Error('The original Supply contract response cannot be verified.'); }
      return result[0];
    }
    const [nextIndex,root,inputBalance] = await Promise.all([read(config.privacyPool,'nextIndex'),read(config.privacyPool,'getLastRoot'),read(config.link,'balanceOf',config.privacyPool)]);
    check(nextIndex <= 4096n && scalar(root), 'The original Supply pool exceeds the supported history boundary.');
    const deposits = [], withdrawals = [], eventKeys = new Set(), final = BigInt(block.number), start = BigInt(config.privacyPoolDeploymentBlock);
    check(start <= final && final - start <= 1000000n, 'The Supply pool history exceeds its bounded scan.');
    for (let from = start; from <= final; from += 5000n) {
      const to = from + 4999n > final ? final : from + 4999n;
      const logs = await rpc('eth_getLogs',[{address:config.privacyPool,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16)}],signal);
      check(Array.isArray(logs) && deposits.length + withdrawals.length + logs.length <= 8192, 'The complete Supply history exceeds the supported event count.');
      for (const log of logs) {
        check(log?.address?.toLowerCase() === config.privacyPool && log.removed === false && quantity(log.blockNumber) && BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to && hash(log.blockHash) && hash(log.transactionHash) && quantity(log.logIndex), 'The original Supply pool event is invalid.');
        const key = log.transactionHash + ':' + log.logIndex; check(!eventKeys.has(key), 'The Supply history repeats a pool event.'); eventKeys.add(key);
        let parsed; try { parsed = abi.parseLog(log); } catch { throw Error('The original Supply pool event cannot be decoded.'); }
        const evidence = {blockNumber:BigInt(log.blockNumber).toString(),blockHash:log.blockHash,transactionHash:log.transactionHash,logIndex:BigInt(log.logIndex).toString()};
        if (parsed?.name === 'Deposit') {
          check(scalar(parsed.args.commitment) && parsed.args.leafIndex < 4096n && parsed.args.timestamp <= BigInt(block.timestamp), 'The original Supply commitment is invalid.');
          deposits.push({commitment:parsed.args.commitment,index:Number(parsed.args.leafIndex),...evidence});
        } else if (parsed?.name === 'Withdrawal') {
          check(scalar(parsed.args.nullifierHash), 'The original Supply withdrawal nullifier is invalid.');
          withdrawals.push({recipient:parsed.args.to.toLowerCase(),nullifierHash:parsed.args.nullifierHash,relayer:parsed.args.relayer.toLowerCase(),fee:parsed.args.fee.toString(),...evidence});
        } else throw Error('The original pool emitted an unsupported Supply event.');
      }
    }
    deposits.sort((a,b) => a.index - b.index);
    check(deposits.length === Number(nextIndex) && deposits.every((row,index) => row.index === index) && new Set(deposits.map(row => row.commitment)).size === deposits.length && new Set(withdrawals.map(row => row.nullifierHash)).size === withdrawals.length && withdrawals.length <= deposits.length, 'The original Supply history is incomplete or repeats a spend.');
    const eventBlocks = new Map([...deposits,...withdrawals].map(row => [row.blockNumber,row.blockHash]));
    check([...deposits,...withdrawals].every(row => eventBlocks.get(row.blockNumber) === row.blockHash), 'The Supply event history contains conflicting block hashes.');
    for (const [number,expected] of eventBlocks) { const canonical = await rpc('eth_getBlockByNumber',['0x'+BigInt(number).toString(16),false],signal); check(canonical?.hash === expected && BigInt(canonical.number) === BigInt(number), 'An original Supply event is no longer canonical.'); }
    const enriched = {...snapshot,privatePool:{address:config.privacyPool,root,nextIndex:Number(nextIndex),inputBalance:inputBalance.toString(),commitments:deposits.map(row => row.commitment),deposits,withdrawals}};
    let result = {snapshot:enriched};
    if (request) {
      const [factoryVault,knownRoot,spent,code,balance,allowance] = await Promise.all([read(config.supplyFactory,'vaultAddress',request.plan),read(config.privacyPool,'isKnownRoot',request.root),read(config.privacyPool,'isSpent',request.nullifierHash),rpc('eth_getCode',[request.vault,ref],signal),read(config.link,'balanceOf',request.vault),read(config.link,'allowance',request.vault,config.pool)]);
      check(factoryVault.toLowerCase() === request.vault && typeof code === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(code) && code.length <= 50000, 'The deterministic original Supply vault changed.');
      const vault = {address:request.vault,deployed:code !== '0x',status:null,inputBalance:balance.toString(),allowance:allowance.toString(),termsVerified:false};
      if (vault.deployed) {
        const terms = {inputToken:config.link,aavePool:config.pool,aToken:config.aLink,inputAmount:config.denomination,...request.plan,chainId:String(config.chainId),inputCodeHash:config.codeHashes.link,aavePoolCodeHash:config.codeHashes.pool,aTokenCodeHash:config.codeHashes.aLink};
        await Promise.all(Object.entries(terms).map(async ([name,expected]) => { const observed = await read(request.vault,name), value = typeof observed === 'bigint' ? observed.toString() : observed.toLowerCase(); check(value === expected, 'The original Supply vault immutable terms changed.'); vault[name] = value; }));
        const status = await read(request.vault,'status'); check([0n,2n,3n].includes(status), 'The Supply vault is not in a resolved or recoverable state.');
        vault.status = Number(status); vault.termsVerified = true; vault.codeHash = keccak256(code);
      }
      const withdrawal = withdrawals.find(row => row.nullifierHash === request.nullifierHash) ?? null;
      check(spent === Boolean(withdrawal), 'The finalized Supply nullifier and withdrawal history disagree.');
      const proofValid = request.proof ? await read(config.verifier,'verifyProof',request.proof,request.publicSignals) : undefined;
      result = {snapshot:enriched,knownRoot,spent,vault,withdrawal,...(request.proof ? {proofValid} : {})};
    }
    const canonical = await rpc('eth_getBlockByNumber',['0x'+BigInt(block.number).toString(16),false],signal);
    check(canonical?.hash === block.hash && BigInt(canonical.number) === BigInt(block.number) && BigInt(canonical.timestamp) === BigInt(block.timestamp), 'The original Supply snapshot is no longer canonical.');
    return result;
  }
  return Object.freeze({
    async snapshot(input = {},options = {}) { return (await observe(input,null,options)).snapshot; },
    async supplySnapshot(value,options = {}) { const request = value?.proof ? checkLendingSupplyPublicRequest(value,{config}) : checkLendingSupplyPreparation(value,{config}); return observe({owner:request.ownerAddress,account:request.plan.beneficiary},request,options); },
  });
}
