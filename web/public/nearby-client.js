import { readState, updateState } from './chat-store.js';
import { savedPackets, sendable } from './delivery-packets.js';
import { receiveDeliveredPacket } from './receive-packet.js';
import { createNearbyConnection } from './nearby-connection.js';
import { setNearbyRecipient } from './delivery-mode.js';
import {acceptCourierPacket,courierHandoff,dispatchCourierItem,markCourierSent} from './nearby-courier.js';

export async function nearbySession(contactId,{contract,defiConfig=null,onState=()=>{},onError=()=>{},onUpdate=()=>{}}) {
  const deliveryOptions={contract,defiConfig:structuredClone(defiConfig)};
  const initial=await readState(), contact=initial.contacts.find(c=>c.id===contactId);
  if(!initial.identity||!contact)throw Error('Add and verify this person’s Lenz ID first.');
  const baseline=new Set(savedPackets(initial).map(p=>p.id)), allowed=new Set(),sent=new Set(),courierSent=new Set();
  const channel=new BroadcastChannel('proof-u-chat-refresh');
  let stopped=false,syncing=false;
  const changed=()=>{channel.postMessage('changed');onUpdate();};
  const connection=createNearbyConnection({identity:initial.identity,contact,onError,onState:state=>{
    if(state==='connected'){setNearbyRecipient(contact.id);void sync();}
    if(state==='closed'){stopped=true;clearInterval(timer);setNearbyRecipient(null);channel.close();removeEventListener('lenz-delivery-ready',wake);}
    onState(state,contact);
  },onPacket:async packet=>{
    const receipt=await updateState(async state=>{
      if(stopped)throw Error('Nearby session ended.');
      if(await acceptCourierPacket(state,contactId,packet,deliveryOptions))return null;
      return (await receiveDeliveredPacket(state,packet,{contract})).receipt;
    });
    if(receipt)allowed.add(receipt.id);
    changed();setTimeout(wake,0);
  }});
  async function sync() {
    if(stopped||syncing||!connection.connected)return;
    syncing=true;
    try {
      for(let count=0;count<32;count++) {
        const state=await readState();
        const packets=savedPackets(state).filter(p=>p.to===contactId&&!sent.has(p.id)&&(!baseline.has(p.id)||allowed.has(p.id)));
        const packet=packets.find(p=>!state.messages.find(r=>r.packet.id===p.id)?.receivedReceipt);
        if(packet){
          if(!await sendable(state,packet,contract)){sent.add(packet.id);continue;}
          await connection.send(packet);sent.add(packet.id);changed();
        }else{
          const next=await courierHandoff(contactId,{...deliveryOptions,exclude:[...courierSent]});if(!next)break;
          await connection.send(next.packet,{withDispatch:dispatch=>dispatchCourierItem(next.id,next.packet,dispatch,deliveryOptions)});
          await markCourierSent(next.id,next.packet);courierSent.add(next.id);changed();
        }
      }
    } catch(error){if(!stopped)onError(error);}
    finally{syncing=false;}
  }
  function wake(){void sync();}
  const timer=setInterval(wake,1500);addEventListener('lenz-delivery-ready',wake);
  return {
    contact,
    offer:()=>connection.offer(), answer:code=>connection.answer(code), finish:code=>connection.finish(code),
    get connected(){return connection.connected;},
    async pending(){const state=await readState();return state.messages.filter(r=>r.packet.from===initial.identity.profile.id&&r.packet.to===contactId&&!r.receivedReceipt).length;},
    async sendSaved(){const state=await readState();for(const p of savedPackets(state))if(p.to===contactId)allowed.add(p.id);await sync();},
    sendCouriers:()=>sync(),
    close:()=>connection.close(),
  };
}
