import { readState, updateState } from './chat-store.js';
import { keysAre, assert } from './peer-crypto.js';
import { CARRIER_DOMAIN, PAGE_SIZE, carrierConfig, wrapForCarrier, validateEnvelope, inboxRequest, carrierPost } from './carrier-protocol.js';
import { receiveDeliveredPacket } from './receive-packet.js';
import { savedPackets, sendable } from './delivery-packets.js';
import { acceptDefiReply, pendingDefiChecks, checkDefiSwap } from './defi-wallet.js';
import {requestedDeliveryPackets} from './delivery-mode.js';

export { savedPackets, sendable } from './delivery-packets.js';
export async function setCarrierEnabled(enabled) {
  return updateState(state=>{
    assert(state.identity, 'Create your Lenz profile first.');
    const previous=state.carrier??{outbox:[],excluded:[]};
    const requested=new Set(requestedDeliveryPackets(state).map(packet=>packet.id));
    // Restore prior delivery consent while retaining unrequested history locally.
    state.carrier={...previous,enabled,excluded:enabled?[...new Set([...previous.excluded.filter(id=>!requested.has(id)),...savedPackets(state).filter(p=>!requested.has(p.id)&&!previous.outbox.some(e=>e.envelope.packet.id===p.id)).map(p=>p.id)])]:previous.excluded};
  });
}
export function createCarrierClient({config, contract, defiConfig, onUpdate=()=>{}, onError=()=>{}, post=carrierPost, now=Date.now}) {
  const carriers=carrierConfig(config), delays=new Map(), cursors=new Map(), checks=new Map();
  let swapConfig=defiConfig?structuredClone(defiConfig):null;
  let controller=new AbortController(), stopped=false, mailboxOwner=null;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
  const changed=()=>{channel?.postMessage('changed');onUpdate();};
  async function queue(){
    await updateState(async state=>{
      if(!state.identity||!state.carrier?.enabled)return;
      const c=state.carrier;
      for(const packet of savedPackets(state)){
        if(c.excluded.includes(packet.id)||c.outbox.some(e=>e.envelope.packet.id===packet.id))continue;
        if(!await sendable(state,packet,contract))continue;
        if(c.outbox.length>=1000)throw Error('Automatic delivery queue is full. Your files remain saved locally.');
        const envelope=await wrapForCarrier(state.identity,packet,now());
        c.outbox.push({envelope,storedBy:[],isReceipt:state.messages.some(r=>r.receiptToShare?.id===packet.id)});
      }
    });
  }
  async function exchange(origin,signal){
    const state=await readState();if(stopped||signal.aborted||!state.carrier?.enabled)return;
    const due=state.carrier.outbox.filter(e=>e.envelope.expiresAt>now()&&!state.messages.some(r=>r.packet.id===e.envelope.packet.id&&r.receivedReceipt));
    // Cycle through the queue so an unavailable mailbox cannot starve later messages.
    const offset=due.length?(delays.get(origin)?.offset??0)%due.length:0, selected=[...due.slice(offset),...due.slice(0,offset)].slice(0,8);
    for(const entry of selected){
      const current=await readState();
      if(signal.aborted||!current.carrier?.enabled)return;
      if(!await sendable(current,entry.envelope.packet,contract))continue;
      try {
      const ack=await post(origin,'/v1/store',entry.envelope,{signal,limit:1024});
      assert(keysAre(ack,['type','id','status','expiresAt'])&&ack.type===CARRIER_DOMAIN&&ack.id===entry.envelope.id&&ack.status==='stored'&&ack.expiresAt===entry.envelope.expiresAt,'Invalid carrier storage response.');
      await updateState(s=>{const e=s.carrier?.outbox.find(e=>e.envelope.id===entry.envelope.id);if(e&&!e.storedBy.includes(origin))e.storedBy.push(origin);});
      }catch(error){if(signal.aborted)return;onError(error);}
    }
    // Mailbox reads are signed for this carrier and return only this identity's ciphertext.
    const mailbox=await readState();
    if(signal.aborted||stopped||!mailbox.carrier?.enabled||mailbox.identity?.profile.id!==state.identity?.profile.id)return;
    const after=cursors.get(origin)??'', q=await inboxRequest(mailbox.identity,origin,after,now());
    if(signal.aborted||stopped)return;
    const reply=await post(origin,'/v1/inbox',q,{signal});
    assert(keysAre(reply,['type','envelopes','next'])&&reply.type===CARRIER_DOMAIN&&Array.isArray(reply.envelopes)&&reply.envelopes.length<=PAGE_SIZE,'Invalid carrier inbox response.');
    let last=after;
    for(const envelope of reply.envelopes){
      assert(typeof envelope?.id==='string'&&envelope.id>last,'Unordered carrier inbox.');last=envelope.id;
    }
    assert(reply.next===(reply.envelopes.length===PAGE_SIZE?last:''),'Invalid carrier cursor.');
    for(const envelope of reply.envelopes){
      if(signal.aborted||stopped)return;
      try{
        await validateEnvelope(envelope,now());
        assert(envelope.packet.to===state.identity.profile.id,'Carrier returned someone else’s file.');
        await updateState(async s=>{
          if(signal.aborted||stopped||!s.carrier?.enabled||s.identity?.profile.id!==state.identity.profile.id)return;
          if(await acceptDefiReply(s,swapConfig,envelope.packet)){signal.throwIfAborted();return;}
          await receiveDeliveredPacket(s,envelope.packet,{contract,sender:envelope.sender});
          signal.throwIfAborted();
        },{signal});
      }catch(error){onError(error);}
    }
    cursors.set(origin,reply.next);
    delays.set(origin,{at:now()+(reply.next?1000:15000)+Math.floor(Math.random()*500),failures:0,offset:due.length?(offset+selected.length)%due.length:0});
    changed();
  }
  async function checkUpdates(signal) {
    const pending=await pendingDefiChecks(await readState(),swapConfig),live=new Set(pending.map(p=>p.requestId));
    for(const id of checks.keys())if(!live.has(id))checks.delete(id);
    const next=p=>Math.max(checks.get(p.requestId)??0,p.checkedAt+30000);
    const due=pending.filter(p=>now()>=next(p)).sort((a,b)=>next(a)-next(b)).slice(0,2);
    for(const item of due) {
      if(signal.aborted||stopped||!navigator.onLine)return;
      checks.set(item.requestId,now()+30000);
      try{await checkDefiSwap(swapConfig,item.requestId,{signal,automatic:true});changed();}
      catch(error){if(!signal.aborted)onError(error);}
      finally{checks.set(item.requestId,now()+30000);}
    }
  }
  return {
    carriers,
    async tick(){
      if(stopped||!navigator.onLine||!carriers.length)return;
      const signal=controller.signal;
      return navigator.locks.request('lenz-carrier-sync-v1',{ifAvailable:true},async lock=>{
        const current=await readState();
        if(!lock||stopped||signal.aborted||!current.identity||!current.carrier?.enabled)return;
        if(mailboxOwner!==current.identity.profile.id){mailboxOwner=current.identity.profile.id;cursors.clear();delays.clear();checks.clear();}
        await queue(); // Must commit before any network request.
        if(signal.aborted||stopped)return;
        await Promise.allSettled(carriers.filter(p=>(delays.get(p)?.at??0)<=now()).map(async origin=>{
          try{await exchange(origin,signal);}
          catch(error){
            const old=delays.get(origin), failures=Math.min((old?.failures??0)+1,8);
            delays.set(origin,{at:now()+Math.min(60000,1000*2**failures)+Math.floor(Math.random()*500),failures,offset:(old?.offset??0)+8});
            if(!signal.aborted)onError(error);
          }
        }));
        if(!signal.aborted&&!stopped){try{await checkUpdates(signal);}catch(error){if(!signal.aborted)onError(error);}}
      });
    },
    setDefiConfig(value){if(stopped)return;swapConfig=value?structuredClone(value):null;cursors.clear();delays.clear();checks.clear();},
    wake(){delays.clear();checks.clear();},
    pause(){controller.abort();controller=new AbortController();},
    close(){stopped=true;controller.abort();channel?.close();},
  };
}
