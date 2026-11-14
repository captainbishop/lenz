import https from 'node:https';
import {readFile,rename,mkdir,realpath,open,unlink,stat} from 'node:fs/promises';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {HYPERLIQUID} from './public/hyperliquid-environment.js';
import {orderAmount,orderText} from './public/hyperliquid-order.js';
import {HYPERLIQUID_TESTNET_GRANTS,checkedHyperFundingRequest,hyperFundingAmount} from './public/hyperliquid-funding-policy.js';

const {Wallet,Signature,verifyTypedData}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const repo=resolve(fileURLToPath(new URL('../',import.meta.url))),unit=10n**18n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const fields=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.sort().join(',');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const lowerAddress=value=>typeof value==='string'?value.toLowerCase():'';
const mac=(state,wallet)=>createHmac('sha256',Buffer.from(wallet.privateKey.slice(2),'hex')).update('lenz-hyperliquid-testnet-funding-v1\n'+canonical(state)).digest('hex');
const outside=value=>{const path=resolve(value),part=relative(repo,path);check(part&&isAbsolute(value)&&(part==='..'||part.startsWith('..'+sep)||isAbsolute(part)),'Funding configuration must stay outside the product repository.');return path;};
const endpoints={info:HYPERLIQUID.info,exchange:HYPERLIQUID.api+'/exchange',explorer:'https://rpc.hyperliquid-testnet.xyz/explorer'};
export function hyperliquidFundingTransport(kind,body){
  check(Object.hasOwn(endpoints,kind),'Unsupported funding source.');
  return new Promise((resolveResult,reject)=>{
    const request=https.request(endpoints[kind],{method:'POST',headers:{'content-type':'application/json'},timeout:15000},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)request.destroy(Error('Funding response too large.'));else chunks.push(chunk);});
      response.on('end',()=>{try{check(response.statusCode===200,'Funding source unavailable.');resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Funding source unavailable.'));}});
    });
    request.on('timeout',()=>request.destroy(Error('Funding source unavailable.')));request.on('error',()=>reject(Error('Funding source unavailable.')));request.end(JSON.stringify(body));
  });
}
export function checkedFundingRequest(input){
  return checkedHyperFundingRequest(input);
}
export function checkedFundingRecovery(input){check(fields(input,['version','account','chainId'])&&input.version===1&&input.chainId===HYPERLIQUID.chainId&&address(input.account),'Invalid testnet funding recovery.');return structuredClone(input);}
export function fundingTypedData(action){
  check(['usdSend','spotSend'].includes(action?.type)&&action.hyperliquidChain==='Testnet'&&action.signatureChainId==='0x66eee'&&address(action.destination)&&['100',action.type==='usdSend'?HYPERLIQUID_TESTNET_GRANTS.perpsUSDC:HYPERLIQUID_TESTNET_GRANTS.spotUSDC].includes(action.amount)&&Number.isSafeInteger(action.time)&&action.time>0,'Invalid sponsored testnet transfer.');
  const spot=action.type==='spotSend';check(fields(action,spot?['type','signatureChainId','hyperliquidChain','destination','token','amount','time']:['type','signatureChainId','hyperliquidChain','destination','amount','time'])&&(!spot||/^USDC:0x[0-9a-f]{32}$/.test(action.token)),'Invalid sponsored testnet transfer.');
  const name=spot?'HyperliquidTransaction:SpotSend':'HyperliquidTransaction:UsdSend';
  return {domain:{name:'HyperliquidSignTransaction',version:'1',chainId:421614,verifyingContract:'0x'+'0'.repeat(40)},types:{[name]:[{name:'hyperliquidChain',type:'string'},{name:'destination',type:'string'},...(spot?[{name:'token',type:'string'}]:[]),{name:'amount',type:'string'},{name:'time',type:'uint64'}]},message:{hyperliquidChain:action.hyperliquidChain,destination:action.destination,...(spot?{token:action.token}:{}),amount:action.amount,time:action.time}};
}
export function createHyperliquidTestnetFunding({operatorKeyFile=process.env.LENZ_HYPERLIQUID_TESTNET_OPERATOR_FILE??'',journalFile=resolve(repo,'../../Lenz-local-notes/testnet-operator/hyperliquid-funding-journal.json'),transport=hyperliquidFundingTransport,now=Date.now}={}){
  let queue=Promise.resolve(),queued=0;
  const call=(kind,body)=>transport(kind,structuredClone(body));
  async function operator(){
    if(!operatorKeyFile)return null;
    const path=outside(operatorKeyFile),actual=outside(await realpath(path));check((await stat(actual)).size<=4096,'Invalid testnet distributor configuration.');const raw=await readFile(actual,'utf8');
    const value=JSON.parse(raw);check(fields(value,['version','environment','purpose','privateKey'])&&value.version===1&&value.environment==='testnet'&&value.purpose==='lenz-hyperliquid-testnet-funding-only'&&/^0x[0-9a-f]{64}$/.test(value.privateKey),'Invalid testnet distributor configuration.');
    return new Wallet(value.privateKey);
  }
  function checkedJournal(state,wallet){
    const owner=wallet.address.toLowerCase();
    check(fields(state,['version','environment','chainId','operator','nonce','grants'])&&state.version===1&&state.environment==='testnet'&&state.chainId===HYPERLIQUID.chainId&&state.operator===owner&&Number.isSafeInteger(state.nonce)&&state.nonce>=0&&Array.isArray(state.grants)&&state.grants.length<=500,'Funding journal does not match this testnet distributor.');
    const ids=new Set(),nonces=new Set();let highest=0;
    for(const grant of state.grants){
      check(fields(grant,['request','createdAt','state','transfers'])&&Number.isSafeInteger(grant.createdAt)&&grant.createdAt>0&&grant.createdAt<=now()+1000&&['pending','confirmed','rejected'].includes(grant.state)&&Array.isArray(grant.transfers)&&grant.transfers.length<=2,'Invalid retained funding request.');
      checkedFundingRequest(grant.request);check(!ids.has(grant.request.id)&&grant.request.account!==owner,'Invalid retained funding request.');ids.add(grant.request.id);
      for(const [index,stage]of grant.transfers.entries()){
        check(fields(stage,['bucket','nonce','action','signature','state','receipt'])&&stage.bucket===['perps','spot'][index]&&Number.isSafeInteger(stage.nonce)&&stage.nonce>=grant.createdAt&&!nonces.has(stage.nonce)&&['prepared','submitting','acknowledged','unknown','confirmed','rejected'].includes(stage.state),'Invalid retained testnet transfer.');
        nonces.add(stage.nonce);highest=Math.max(highest,stage.nonce);const typed=fundingTypedData(stage.action);
        check(stage.action.destination===grant.request.account&&stage.action.amount===hyperFundingAmount(grant.request,stage.bucket)&&stage.action.time===stage.nonce&&stage.action.type===(stage.bucket==='perps'?'usdSend':'spotSend')&&fields(stage.signature,['r','s','v'])&&/^0x[0-9a-f]{64}$/.test(stage.signature.r)&&/^0x[0-9a-f]{64}$/.test(stage.signature.s)&&[27,28].includes(stage.signature.v)&&verifyTypedData(typed.domain,typed.types,typed.message,stage.signature).toLowerCase()===owner,'Retained funding authority does not match this distributor.');
        const r=stage.receipt;check(stage.state==='confirmed'?fields(r,['hash','time','amount','fee','bucket'])&&hash(r.hash)&&Number.isSafeInteger(r.time)&&r.time>=stage.nonce&&r.time<=now()+1000&&r.amount===hyperFundingAmount(grant.request,stage.bucket)&&r.bucket===stage.bucket&&orderAmount(r.fee)<=unit:r===null,'Invalid retained funding receipt.');
        if(index)check(grant.transfers[index-1].state==='confirmed','Invalid funding transfer sequence.');
      }
      check(grant.state!=='confirmed'||grant.transfers.length===2&&grant.transfers.every(stage=>stage.state==='confirmed'),'Invalid completed funding request.');
      check(grant.state!=='rejected'||grant.transfers.some(stage=>stage.state==='rejected'),'Invalid rejected funding request.');
    }
    check(state.nonce===highest,'Invalid retained funding nonce.');return state;
  }
  async function journal(wallet){
    const owner=wallet.address.toLowerCase();
    const path=outside(journalFile);let state;
    try{check(outside(await realpath(path))===path,'Invalid funding journal path.');check((await stat(path)).size<=2*1024*1024,'Funding journal is full.');state=JSON.parse(await readFile(path,'utf8'));const auth=state.auth;delete state.auth;check(typeof auth==='string'&&/^[0-9a-f]{64}$/.test(auth)&&timingSafeEqual(Buffer.from(auth,'hex'),Buffer.from(mac(state,wallet),'hex')),'Funding journal authentication failed.');}catch(error){if(error.code!=='ENOENT')throw Error('Funding journal unavailable.');state={version:1,environment:'testnet',chainId:HYPERLIQUID.chainId,operator:owner,nonce:0,grants:[]};}
    return checkedJournal(state,wallet);
  }
  async function save(state,wallet){
    checkedJournal(state,wallet);const path=outside(journalFile);await mkdir(dirname(path),{recursive:true});check(outside(await realpath(dirname(path)))===dirname(path),'Invalid funding journal directory.');
    const raw=JSON.stringify({...state,auth:mac(state,wallet)});check(Buffer.byteLength(raw)<=2*1024*1024,'Funding journal is full.');const temp=path+'.'+randomBytes(12).toString('hex')+'.tmp',file=await open(temp,'wx',0o600);
    try{await file.writeFile(raw);await file.sync();}finally{await file.close();}try{await rename(temp,path);}catch(error){await unlink(temp);throw error;}
  }
  async function balances(account){
    const [mode,spot,perp]=await Promise.all([call('info',{type:'userAbstraction',user:account}),call('info',{type:'spotClearinghouseState',user:account}),call('info',{type:'clearinghouseState',user:account})]);
    check(mode==='disabled'&&Array.isArray(spot?.balances)&&Array.isArray(perp?.assetPositions)&&typeof perp.withdrawable==='string','Funding for this account mode is unavailable.');
    const usdc=spot.balances.filter(row=>row.token===0);check(usdc.length<=1,'Ambiguous testnet USDC balance.');const row=usdc[0],spotAmount=row?orderAmount(row.total)-orderAmount(row.hold):0n;check(spotAmount>=0n,'Invalid testnet USDC balance.');
    return {spot:spotAmount,perps:orderAmount(perp.withdrawable)};
  }
  const displayBalances=value=>({spotUSDC:orderText(value.spot),perpsUSDC:orderText(value.perps)});
  async function configuration(){
    const base={version:2,chainId:HYPERLIQUID.chainId,environment:'testnet',grants:{...HYPERLIQUID_TESTNET_GRANTS},available:false,reason:'operator_unconfigured'};
    if(!operatorKeyFile)return base;
    try{const wallet=await operator();await journal(wallet);const value=await balances(wallet.address.toLowerCase());return {...base,available:value.spot>=orderAmount(HYPERLIQUID_TESTNET_GRANTS.spotUSDC)+unit&&value.perps>=orderAmount(HYPERLIQUID_TESTNET_GRANTS.perpsUSDC)+unit,reason:value.spot>=orderAmount(HYPERLIQUID_TESTNET_GRANTS.spotUSDC)+unit&&value.perps>=orderAmount(HYPERLIQUID_TESTNET_GRANTS.perpsUSDC)+unit?null:'operator_unfunded'};}catch{return {...base,reason:'operator_unavailable'};}
  }
  async function receipt(stage,owner){
    const startTime=stage.nonce,endTime=Math.max(now(),stage.nonce),[sent,received]=await Promise.all([owner,stage.action.destination].map(user=>call('info',{type:'userNonFundingLedgerUpdates',user,startTime,endTime})));
    check(Array.isArray(sent)&&Array.isArray(received)&&sent.length<=2000&&received.length<=2000,'Funding receipt unavailable.');
    const match=row=>{try{const d=row.delta;return hash(row.hash)&&Number.isSafeInteger(row.time)&&row.time>=startTime&&row.time<=endTime&&lowerAddress(d?.user)===owner&&lowerAddress(d.destination)===stage.action.destination&&d.type===(stage.bucket==='perps'?'internalTransfer':'spotTransfer')&&orderAmount(String(stage.bucket==='perps'?d.usdc:d.amount))===orderAmount(stage.action.amount)&&orderAmount(String(d.fee))<=unit&&(stage.bucket==='perps'||['USDC',stage.action.token].includes(d.token))&&(d.nativeTokenFee===undefined||orderAmount(String(d.nativeTokenFee))===0n);}catch{return false;}};
    const candidates=sent.filter(match).filter(row=>received.filter(match).some(r=>r.hash===row.hash));
    if(candidates.length!==1)return null;
    const proof=await call('explorer',{type:'txDetails',hash:candidates[0].hash}),tx=proof?.tx;
    if(proof?.type!=='txDetails'||tx?.hash!==candidates[0].hash||lowerAddress(tx.user)!==owner||tx.error!==null||!Number.isSafeInteger(tx.time)||tx.time<startTime||tx.time>endTime||canonical(tx.action)!==canonical(stage.action))return null;
    return {hash:tx.hash,time:tx.time,amount:stage.action.amount,fee:orderText(orderAmount(candidates[0].delta.fee)),bucket:stage.bucket};
  }
  async function processRequest(input){
    const request=checkedFundingRequest(input);if(!operatorKeyFile)return {...await configuration(),id:request.id,account:request.account,state:'unavailable'};
    let wallet;try{wallet=await operator();}catch{return {version:request.version,id:request.id,account:request.account,chainId:HYPERLIQUID.chainId,environment:'testnet',state:'unavailable',available:false,reason:'operator_unavailable'};}
    const owner=wallet.address.toLowerCase();check(request.account!==owner,'The distributor cannot grant funds to itself.');
    const lockPath=outside(journalFile)+'.lock';await mkdir(dirname(lockPath),{recursive:true});outside(await realpath(dirname(lockPath)));let lock;
    try{lock=await open(lockPath,'wx',0o600);}catch{throw Error('Funding is busy or needs operator recovery.');}
    try{
      const state=await journal(wallet);let grant=state.grants.find(row=>row.request.id===request.id);const persist=()=>save(state,wallet);
      if(grant)check(canonical(grant.request)===canonical(request),'Funding request changed.');
      else{
        check(!state.grants.some(row=>row.request.account===request.account&&(row.state==='pending'||row.createdAt>now()-86400000)),'Test funds were already requested for this wallet. Check the retained request.');
        check(state.grants.filter(row=>row.createdAt>now()-86400000).length<25&&state.grants.length<500,'Testnet funding limit reached.');
        const value=await balances(owner);if(value.spot<orderAmount(hyperFundingAmount(request,'spot'))+unit||value.perps<orderAmount(hyperFundingAmount(request,'perps'))+unit)return {version:request.version,id:request.id,account:request.account,chainId:HYPERLIQUID.chainId,environment:'testnet',state:'unavailable',available:false,reason:'operator_unfunded'};
        await balances(request.account);
        grant={request,createdAt:now(),state:'pending',transfers:[]};state.grants.push(grant);await persist();
      }
      for(const bucket of ['perps','spot']){
        let stage=grant.transfers.find(row=>row.bucket===bucket);
        if(!stage){
          const value=await balances(owner);if(value[bucket]<orderAmount(hyperFundingAmount(request,bucket))+unit)break;
          const meta=bucket==='spot'?await call('info',{type:'spotMeta'}):null,token=meta?.tokens?.filter(t=>t.index===0&&t.name==='USDC');check(bucket!=='spot'||token?.length===1&&/^0x[0-9a-f]{32}$/.test(token[0].tokenId),'Testnet USDC identity unavailable.');
          const nonce=Math.max(now(),state.nonce+1),action={type:bucket==='perps'?'usdSend':'spotSend',signatureChainId:'0x66eee',hyperliquidChain:'Testnet',destination:request.account,...(bucket==='spot'?{token:'USDC:'+token[0].tokenId}:{}),amount:hyperFundingAmount(request,bucket),time:nonce},typed=fundingTypedData(action),signature=Signature.from(await wallet.signTypedData(typed.domain,typed.types,typed.message));
          stage={bucket,nonce,action,signature:{r:signature.r,s:signature.s,v:signature.v},state:'prepared',receipt:null};state.nonce=nonce;grant.transfers.push(stage);await persist();
        }
        if(stage.state==='prepared'){
          if(now()-stage.nonce>86400000){stage.state='rejected';grant.state='rejected';await persist();break;}
          stage.state='submitting';await persist();
          try{const result=await call('exchange',{action:stage.action,nonce:stage.nonce,signature:stage.signature});stage.state=result?.status==='err'?'rejected':result?.status==='ok'&&result.response?.type==='default'?'acknowledged':'unknown';}catch{stage.state='unknown';}
          await persist();
        }
        if(stage.state==='rejected'){grant.state='rejected';await persist();break;}
        if(stage.state!=='confirmed'){try{stage.receipt=await receipt(stage,owner);if(stage.receipt)stage.state='confirmed';}catch{}await persist();}
        if(stage.state!=='confirmed')break;
      }
      if(grant.transfers.length===2&&grant.transfers.every(stage=>stage.state==='confirmed'))grant.state='confirmed';await persist();
      let currentBalances=null;try{currentBalances=displayBalances(await balances(request.account));}catch{}
      return {version:request.version,id:request.id,account:request.account,chainId:HYPERLIQUID.chainId,environment:'testnet',state:grant.state,receipts:grant.transfers.map(stage=>stage.receipt).filter(Boolean),balances:currentBalances};
    }finally{await lock.close();await unlink(lockPath);}
  }
  return {configuration,async recover(input){
    const request=checkedFundingRecovery(input),base={...request,environment:HYPERLIQUID.environment,request:null,state:'unavailable',receipts:[],createdAt:null};if(!operatorKeyFile)return base;
    const wallet=await operator(),state=await journal(wallet),grant=state.grants.filter(row=>row.request.account===request.account).sort((a,b)=>b.createdAt-a.createdAt)[0];if(!grant)return {...base,state:'not_found'};
    return {...base,request:structuredClone(grant.request),state:grant.state,createdAt:grant.createdAt,receipts:grant.transfers.map(stage=>stage.receipt).filter(Boolean)};
  },request(input){const checked=checkedFundingRequest(input);check(queued<30,'Funding is busy. Retry the retained request.');queued++;const work=queue.then(()=>processRequest(checked)).finally(()=>{queued--;});queue=work.catch(()=>{});return work;}};
}
