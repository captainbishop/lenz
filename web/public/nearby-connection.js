import { assert, digest, keysAre } from './peer-crypto.js';
import { NEARBY, CHUNK, MAX_PACKET, makeSignal, checkSignal, createAssembly } from './nearby-protocol.js';

export function createNearbyConnection({identity,contact,onPacket,onState=()=>{},onError=()=>{}}) {
  const pc=new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'}), assembly=createAssembly();
  let channel, offer, closed=false, ready=false, inbound=Promise.resolve(), outbound=Promise.resolve(), received=0, queuedBytes=0;
  const pending=new Map();
  let timer=setTimeout(()=>fail(Error('Pairing timed out. Start again.')),180000);
  function close() {
    if(closed)return;closed=true;ready=false;clearTimeout(timer);assembly.clear();
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Nearby disconnected. Your files stay saved.'));}pending.clear();
    channel?.close();pc.close();onState('closed');
  }
  function fail(error){if(closed)return;onError(error);close();}
  function attach(next) {
    if(channel || next.label!==NEARBY || !next.ordered || next.maxRetransmits!==null || next.maxPacketLifeTime!==null){next.close();fail(Error('Invalid nearby data channel.'));return;}
    channel=next;
    channel.onopen=()=>{if(closed)return;ready=true;clearTimeout(timer);timer=setTimeout(()=>fail(Error('Nearby session ended. Pair again to continue.')),30*60*1000);onState('connected');};
    channel.onclose=close;channel.onerror=()=>fail(Error('Nearby connection failed. Your files stay saved.'));
    channel.onmessage=event=>{
      if(typeof event.data!=='string' || event.data.length>10000 || queuedBytes+event.data.length>262144 || ++received>10000){fail(Error('Nearby connection exceeded its limits.'));return;}
      const text=event.data;queuedBytes+=text.length;
      inbound=inbound.then(async()=>{
        if(closed)return;const frame=JSON.parse(text);
        if(frame.kind==='ack') {
          assert(keysAre(frame,['kind','hash']) && pending.has(frame.hash),'Unexpected nearby acknowledgement.');
          const item=pending.get(frame.hash);clearTimeout(item.timer);pending.delete(frame.hash);item.resolve();return;
        }
        const complete=await assembly.accept(frame);if(!complete)return;
        assert(complete.packet.from===contact.id && complete.packet.to===identity.profile.id,'Nearby packet belongs to another conversation.');
        await onPacket(complete.packet); // The application authenticates and commits before acknowledging.
        if(!closed)channel.send(JSON.stringify({kind:'ack',hash:complete.hash}));
      }).catch(fail).finally(()=>{queuedBytes-=text.length;});
    };
  }
  pc.ondatachannel=e=>attach(e.channel);
  pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState))close();};
  async function gather(description) {
    await pc.setLocalDescription(description);
    if(pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
      const t=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(Error('No local connection found. Check Wi-Fi or hotspot.'));},10000);
      function check(){if(pc.iceGatheringState==='complete'){clearTimeout(t);pc.removeEventListener('icegatheringstatechange',check);resolve();}}
      pc.addEventListener('icegatheringstatechange',check);check();
    });
    assert(!closed,'Nearby connection is closed.');return pc.localDescription.sdp;
  }
  async function send(packet,{withDispatch}={}) {
    assert(ready && !closed && channel?.readyState==='open','Pair with your contact first.');
    assert(packet.from===identity.profile.id && packet.to===contact.id,'Choose the connected contact.');
    const text=JSON.stringify(packet);assert(text.length<=MAX_PACKET && /^[\x20-\x7e]+$/.test(text),'Nearby packet is too large or invalid.');
    const hash=await digest(packet);
    const dispatch=()=>new Promise((resolve,reject)=>{
      assert(ready && !closed && channel?.readyState==='open','Pair with your contact first.');
      const t=setTimeout(()=>{pending.delete(hash);reject(Error('No nearby acknowledgement. Reconnect to retry the saved file.'));close();},15000);
      pending.set(hash,{resolve,reject,timer:t});
      try { channel.send(JSON.stringify({kind:'start',hash,size:text.length}));
        for(let index=0,offset=0;offset<text.length;index++,offset+=CHUNK)channel.send(JSON.stringify({kind:'part',hash,index,data:text.slice(offset,offset+CHUNK)}));
      }catch(error){clearTimeout(t);pending.delete(hash);reject(error);fail(error);}
    });
    // Authorization and frame enqueue share the store lock; remote ACKs never hold it.
    return withDispatch?(await withDispatch(dispatch)).delivery:dispatch();
  }
  return {
    get connected(){return ready&&!closed;},
    async offer(){assert(!offer&&!closed,'Start a new connection.');attach(pc.createDataChannel(NEARBY,{ordered:true}));offer=await makeSignal(identity,contact,'offer',await gather(await pc.createOffer()));return offer;},
    async answer(input){assert(!offer&&!closed,'Start a new connection.');offer=await checkSignal(input,identity,contact);await pc.setRemoteDescription({type:'offer',sdp:offer.sdp});return makeSignal(identity,contact,'answer',await gather(await pc.createAnswer()),offer);},
    async finish(input){assert(offer?.from===identity.profile.id&&!ready&&!closed,'Create a connection first.');const answer=await checkSignal(input,identity,contact,offer);await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});},
    send(packet,options){const job=outbound.then(()=>send(packet,options));outbound=job.catch(()=>{});return job;},
    close,
  };
}
