import { readState, updateState } from './chat-store.js';
import { CHAT_DOMAIN, assert, openMessage } from './peer-crypto.js';
import { savedPackets, sendable } from './delivery-packets.js';
import { nostrConfig, packEnvelope, packContactRequest, mailboxKey, createReassembler, createContactRequestReassembler } from './nostr-protocol.js';
import { openRelay, readMailbox, readContactRequestInbox } from './nostr-socket.js';
import { receiveDeliveredPacket } from './receive-packet.js';
import { CONTACT_REQUEST, contactForPacket } from './contact-requests.js';
import { requestedDeliveryPackets } from './delivery-mode.js';

export async function setNostrEnabled(enabled, {owner} = {}) {
  await updateState(state=>{
    assert(state.identity, 'Create your Lenz profile first.');
    assert(!owner || state.identity.profile.id === owner, 'Your account changed. Reload before changing delivery.');
    const previous = state.nostr ?? {outbox:[],excluded:[]};
    const requested=new Set(requestedDeliveryPackets(state).map(packet=>packet.id));
    state.nostr = {...previous,enabled,excluded:enabled ? [...new Set([...previous.excluded.filter(id=>!requested.has(id)),
      ...savedPackets(state).filter(p=>!requested.has(p.id)&&!previous.outbox.some(e=>e.packetId===p.id)).map(p=>p.id)])] : previous.excluded};
  });
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
  channel?.postMessage('changed');channel?.close();
}
export function createNostrClient({config,contract,onUpdate=()=>{},onError=()=>{},connect=openRelay,now=Date.now}) {
  const relays = nostrConfig(config), delays = new Map(), cursors = new Map(), assembler = createReassembler(), requests = createContactRequestReassembler();
  let controller = new AbortController(), stopped = false, mailboxOwner = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
  const allowed = async()=>!stopped && !!(await readState()).nostr?.enabled;
  const pause = ()=>{controller.abort();controller=new AbortController();assembler.clear();requests.clear();};
  if(channel)channel.onmessage=()=>{void allowed().then(ok=>{if(!ok)pause();});};
  const acknowledged = (state,e)=>state.messages.some(r=>r.packet.id===e.packetId&&r.receivedReceipt);
  async function queue() {
    await updateState(async state=>{
      if(!state.identity||!state.nostr?.enabled)return;
      const n = state.nostr;
      for(const e of n.outbox)if(e.expiresAt<=now()||acknowledged(state,e))e.events=[];
      let size = n.outbox.reduce((sum,e)=>sum+JSON.stringify(e.events).length,0);
      for(const packet of savedPackets(state)) {
        if(n.excluded.includes(packet.id)||n.outbox.some(e=>e.packetId===packet.id)||!await sendable(state,packet,contract))continue;
        if(n.outbox.length>=1000||size>=6*1024*1024){onError(Error('Public delivery queue is full. Use file sharing.'));break;}
        const contact=contactForPacket(state,packet),payload=await openMessage(state.identity,contact,packet);
        const entry = await (payload.kind===CONTACT_REQUEST?packContactRequest:packEnvelope)(state.identity,contact,packet,now());
        const length = JSON.stringify(entry.events).length;
        if(size+length>6*1024*1024){onError(Error('Public delivery queue is full. Use file sharing.'));break;}
        entry.isReceipt=state.messages.some(r=>r.receiptToShare?.id===packet.id);
        n.outbox.push(entry);size+=length;
      }
    });
  }
  async function exchange(origin,signal) {
    const snapshot=await readState(),owner=snapshot.identity?.profile.id;
    if(!owner||!await allowed()||signal.aborted)return;
    const currentOwner=async()=>!signal.aborted&&await allowed()&&(await readState()).identity?.profile.id===owner;
    const relay = await connect(origin,{signal,allowed:currentOwner});
    let failed=false;
    const rejected=error=>{failed=true;onError(error,origin);};
    try {
      const state=await readState();if(!await currentOwner())return;
      const previous=delays.get(origin)??{}, packets=savedPackets(state);
      const due=state.nostr.outbox.filter(e=>e.expiresAt>now()&&!acknowledged(state,e)).flatMap(e=>e.events.map(event=>({entry:e,event})));
      const offset=due.length?(previous.offset??0)%due.length:0;
      const selected=[...due.slice(offset),...due.slice(0,offset)].slice(0,32);
      for(const {entry,event} of selected) {
        if(!await currentOwner())return;
        const current=await readState(),packet=packets.find(p=>p.id===entry.packetId);
        if(!packet||entry.expiresAt<=now()||acknowledged(current,entry)||!await sendable(current,packet,contract))continue;
        try {
          await relay.publish(event);
          // This only records relay acceptance. Recipient receipts are separately signed.
          await updateState(s=>{if(signal.aborted||stopped||s.identity?.profile.id!==owner||!s.nostr?.enabled)return;const e=s.nostr?.outbox.find(e=>e.hash===entry.hash);if(e){
            const record=e.storedBy.find(r=>r.origin===origin);
            if(record){if(!record.ids.includes(event.id))record.ids.push(event.id);}
            else e.storedBy.push({origin,ids:[event.id]});
          }});
        }catch(error){if(signal.aborted)return;rejected(error);}
      }
      if(!await currentOwner())return;
      const requestKey=origin+':requests:'+owner;
      try {
      const requestCursor=await readContactRequestInbox(relay,owner,cursors.get(requestKey),async event=>{
        if(!await currentOwner())return;
        try{
          const envelope=await requests.accept(event,owner,now());if(!envelope)return;
          await updateState(async s=>{
            if(signal.aborted||stopped||!s.nostr?.enabled||s.identity?.profile.id!==owner)return;
            const peer={type:CHAT_DOMAIN,...envelope.sender,name:'Message request'};
            assert((await openMessage(s.identity,peer,envelope.packet)).kind===CONTACT_REQUEST,'This request inbox only accepts contact requests.');
            await receiveDeliveredPacket(s,envelope.packet,{contract,sender:envelope.sender});
            signal.throwIfAborted();
          },{signal});
        }catch(error){if(!signal.aborted)rejected(error);}
      },now());
      if(!await currentOwner())return;cursors.set(requestKey,requestCursor);
      }catch(error){if(!signal.aborted)rejected(error);}
      if(!await currentOwner())return;
      const current=await readState(), contacts=[...new Map([...current.contacts,...(current.contactRequests??[]).filter(r=>r.direction==='incoming').map(r=>r.profile)].map(p=>[p.id,p])).values()];
      const contactOffset=contacts.length?(previous.contactOffset??0)%contacts.length:0;
      const selectedContacts=[...contacts.slice(contactOffset),...contacts.slice(0,contactOffset)].slice(0,4);
      for(const contact of selectedContacts) {
        if(!await currentOwner())return;
        const mailbox=await mailboxKey(current.identity,contact,contact.id);
        const key=origin+':'+mailbox.publicKey;
        try {
          const cursor=await readMailbox(relay,mailbox.publicKey,cursors.get(key),async event=>{
            if(!await currentOwner())return;
            try {
              const envelope=await assembler.accept(event,mailbox,contact,current.identity.profile.id,now());
              if(!envelope)return;
              await updateState(async s=>{
                if(signal.aborted||stopped||!s.nostr?.enabled||s.identity?.profile.id!==owner)return;
                await receiveDeliveredPacket(s,envelope.packet,{contract,sender:envelope.sender});
                signal.throwIfAborted();
              },{signal});
            }catch(error){rejected(error);}
          },now());
          cursors.set(key,cursor);
        }finally{mailbox.secret.fill(0);}
      }
      delays.set(origin,{at:now()+15000,failures:0,offset:offset+selected.length,contactOffset:contactOffset+selectedContacts.length});
      channel?.postMessage('changed');onUpdate({origin,ok:!failed});
    }finally{relay.close();}
  }
  return {
    relays,
    async tick() {
      if(stopped||!navigator.onLine||!relays.length)return;
      return navigator.locks.request('lenz-nostr-sync-v1',{ifAvailable:true},async lock=>{
        if(!lock||!await allowed())return;
        const state=await readState();if(!state.identity)return;
        if(mailboxOwner!==state.identity.profile.id){mailboxOwner=state.identity.profile.id;cursors.clear();delays.clear();assembler.clear();requests.clear();}
        await queue(); // A failed durable commit must cause zero network operations.
        const signal=controller.signal;
        await Promise.allSettled(relays.filter(r=>(delays.get(r)?.at??0)<=now()).map(async origin=>{
          try{await exchange(origin,signal);}
          catch(error){
            const previous=delays.get(origin)??{},failures=Math.min((previous.failures??0)+1,6);
            delays.set(origin,{...previous,at:now()+Math.min(60000,1000*2**failures),failures,offset:(previous.offset??0)+32,contactOffset:(previous.contactOffset??0)+1});
            if(!signal.aborted)onError(error,origin);
          }
        }));
      });
    },
    wake(){for(const [origin,value]of delays)delays.set(origin,{...value,at:0});},
    pause,
    close(){stopped=true;pause();channel?.close();},
  };
}
