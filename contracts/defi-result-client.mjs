import assert from 'node:assert/strict';
import {openMessage,keysAre} from '../web/public/peer-crypto.js';
import {checkDefiRequest} from '../web/public/defi-request.js';

// Read-only recipient boundary. The injected observer must use the recipient's
// pinned chain configuration. Executor claims never create credit or unlock funds.
export async function verifyDefiResult(identity,executor,config,approvedRequest,packet,{observe,now=Date.now()}={}){
  const request=structuredClone(approvedRequest),envelope=structuredClone(packet);
  // Verify the original approval at its issue time: expiry does not erase liabilities
  // or prevent later status/recovery checks. This function cannot dispatch a call.
  const checked=await checkDefiRequest(config,identity.profile,executor,request,request.createdAt);
  assert(envelope.from===checked.executor&&envelope.to===checked.sender,'Wrong DeFi result direction');
  const claimed=await openMessage(identity,executor,envelope);
  assert(keysAre(claimed,['type','requestId','checkedAt','state','observation','transaction'])
    && claimed.type==='lenz/defi-observation/v1'&&claimed.requestId===checked.id,'Different DeFi result request');
  assert(Number.isSafeInteger(now)&&Number.isSafeInteger(claimed.checkedAt)
    && claimed.checkedAt>=checked.createdAt&&claimed.checkedAt<=now+60000,'Invalid DeFi result time');
  assert(['observed','pending','unavailable','expired','needs_review','conflicted','ready'].includes(claimed.state),'Invalid DeFi result state');
  assert(typeof observe==='function','Independent chain observer required');
  let observation;
  try{observation=await observe(structuredClone(checked.operation));}
  catch{return {requestId:checked.id,state:'unverified',observation:null};}
  assert(observation?.finality==='FINAL'&&Number.isSafeInteger(observation.block?.height)&&observation.block.height>0
    && typeof observation.block.hash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(observation.block.hash),'Independent observation is not final');
  assert(['observed','pending','ready','conflicted','needs_review'].includes(observation.state),'Invalid independent result state');
  return {requestId:checked.id,state:observation.state,observation:structuredClone(observation)};
}
