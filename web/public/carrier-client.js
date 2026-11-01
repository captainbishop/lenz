import { readState, updateState } from './chat-store.js';
import { openMessage, keysAre, assert, digest } from './peer-crypto.js';
import { CARRIER_DOMAIN, PAGE_SIZE, carrierConfig, wrapForCarrier, validateEnvelope, inboxRequest, carrierPost } from './carrier-protocol.js';
import { receivePacket } from './receive-packet.js';
import { DELIVERY_RECEIPT, prepareDeliveryReceipt } from './delivery-receipts.js';
import { isNearPayment } from './near-payment-service.js';
import { readNearVault, nearLedger, transferTerms } from './near-protocol.js';

const savedPackets = state => state.messages.flatMap(r=>[r.packet,r.receiptToShare].filter(p=>p?.from===state.identity?.profile.id));
async function sendable(state,packet,contract){
  const contact=state.contacts.find(p=>p.id===packet.to);if(!contact)return false;
  const payload=await openMessage(state.identity,contact,packet);
  if(isNearPayment(payload)){
    if(payload.contract!==contract)return false;
    const ledger=await nearLedger(await readNearVault(state,contract));
    return !ledger.blocked.has(await digest(transferTerms(contract,payload.path.at(-1)))+':0');
  }
  return payload.kind==='chat'||payload.kind===DELIVERY_RECEIPT;
}
export async function setCarrierEnabled(enabled) {
  return updateState(state=>{
    assert(state.identity, 'Create your Lenz profile first.');
    const previous=state.carrier??{outbox:[],excluded:[]};
    // Enabling never uploads old history. Previously queued files retain their exact signatures.
    state.carrier={...previous,enabled,excluded:enabled?[...new Set([...previous.excluded,...savedPackets(state).filter(p=>!previous.outbox.some(e=>e.envelope.packet.id===p.id)).map(p=>p.id)])]:previous.excluded};
  });
}
export function createCarrierClient({config, contract, onUpdate=()=>{}, onError=()=>{}, post=carrierPost, now=Date.now}) {
  const carriers=carrierConfig(config), delays=new Map(), cursors=new Map();
  let controller=new AbortController(), stopped=false;
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
    const after=cursors.get(origin)??'', q=await inboxRequest(state.identity,origin,after,now());
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
          if(!s.carrier?.enabled)return;
          const result=await receivePacket(s,envelope.packet,false,contract);
          if(result.kind!==DELIVERY_RECEIPT)await prepareDeliveryReceipt(s,envelope.packet.id);
        });
      }catch(error){onError(error);}
    }
    cursors.set(origin,reply.next);
    delays.set(origin,{at:now()+(reply.next?1000:15000)+Math.floor(Math.random()*500),failures:0,offset:due.length?(offset+selected.length)%due.length:0});
    changed();
  }
  return {
    carriers,
    async tick(){
      if(stopped||!navigator.onLine||!carriers.length)return;
      return navigator.locks.request('lenz-carrier-sync-v1',{ifAvailable:true},async lock=>{
        if(!lock||stopped||!(await readState()).carrier?.enabled)return;
        await queue(); // Must commit before any network request.
        const signal=controller.signal;
        await Promise.allSettled(carriers.filter(p=>(delays.get(p)?.at??0)<=now()).map(async origin=>{
          try{await exchange(origin,signal);}
          catch(error){
            const old=delays.get(origin), failures=Math.min((old?.failures??0)+1,8);
            delays.set(origin,{at:now()+Math.min(60000,1000*2**failures)+Math.floor(Math.random()*500),failures,offset:(old?.offset??0)+8});
            if(!signal.aborted)onError(error);
          }
        }));
      });
    },
    wake(){delays.clear();},
    pause(){controller.abort();controller=new AbortController();},
    close(){stopped=true;controller.abort();channel?.close();},
  };
}
