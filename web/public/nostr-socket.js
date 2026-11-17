import { assert, bytes } from './peer-crypto.js';
import { relayOrigin, MAX_EVENT_BYTES, RUMOR_KIND } from './nostr-protocol.js';

// One bounded exchange; all sockets close on completion, timeout, or opt-out.
export async function openRelay(origin, {signal, allowed, WebSocketImpl = WebSocket, timeout = 10000} = {}) {
  relayOrigin(origin);
  assert(!signal?.aborted && await allowed(), 'Public delivery is off.');
  assert(!signal?.aborted, 'Public delivery is off.');
  const ws = new WebSocketImpl(origin), pending = new Map();
  let closed = false, serial = 0, totalBytes = 0;
  const abort = () => close(new Error('Relay connection closed.'));
  function close(error = new Error('Relay connection closed.')) {
    if (closed) return;
    closed = true; signal?.removeEventListener('abort',abort);
    for (const item of pending.values()) item.reject(error);
    pending.clear(); ws.close();
  }
  signal?.addEventListener('abort',abort,{once:true});
  const ready = new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{reject(Error('Relay connection timed out.'));close();},timeout);
    ws.addEventListener('open',()=>{clearTimeout(timer);closed?reject(Error('Relay connection closed.')):resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Relay connection failed.'));close();},{once:true});
    ws.addEventListener('close',()=>{clearTimeout(timer);reject(Error('Relay connection closed.'));close();},{once:true});
  });
  ws.addEventListener('message',message=>{
    try {
      assert(typeof message.data === 'string' && message.data.length <= MAX_EVENT_BYTES+1024, 'Oversized relay reply.');
      const length = new TextEncoder().encode(message.data).length;
      assert(length <= MAX_EVENT_BYTES+1024, 'Oversized relay reply.');
      totalBytes += length;
      assert(totalBytes <= 8*1024*1024, 'Relay exchange byte limit reached.');
      const reply = JSON.parse(message.data);
      assert(Array.isArray(reply) && typeof reply[0] === 'string', 'Invalid relay reply.');
      const item = pending.get(reply[1]);
      if (reply[0] === 'OK' && item?.type === 'publish') {
        assert(reply.length === 4 && typeof reply[2] === 'boolean' && typeof reply[3] === 'string', 'Invalid relay acknowledgement.');
        reply[2] ? item.resolve(true) : item.reject(Error('Relay refused the encrypted file.'));
      } else if (reply[0] === 'EVENT' && item?.type === 'read') {
        assert(reply.length === 3 && bytes(reply[2]).length <= MAX_EVENT_BYTES && item.events.length < item.limit, 'Relay page exceeded its limit.');
        item.events.push(reply[2]);
      } else if (reply[0] === 'EOSE' && item?.type === 'read') {
        assert(reply.length === 2, 'Invalid relay page ending.');item.resolve(item.events);
      } else if (reply[0] === 'CLOSED' && item?.type === 'read') item.reject(Error('Relay refused the inbox request.'));
      else if (reply[0] === 'AUTH') close(Error('This relay requires authentication.'));
    } catch (error) { close(error); }
  });
  await ready;
  async function request(key,type,body,limit=0) {
    assert(!closed && !signal?.aborted && await allowed(), 'Public delivery is off.');
    assert(!closed && !signal?.aborted, 'Public delivery is off.');
    return new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>finish(reject,Error('Relay request timed out.')),timeout);
      function finish(done,value) {
        clearTimeout(timer);pending.delete(key);
        if (type === 'read' && !closed) ws.send(JSON.stringify(['CLOSE',key]));
        done(value);
      }
      pending.set(key,{type,limit,events:[],resolve:v=>finish(resolve,v),reject:e=>finish(reject,e)});
      try { ws.send(JSON.stringify(body)); } catch(error) { finish(reject,error); }
    });
  }
  return {
    publish: event => request(event.id,'publish',['EVENT',event]),
    read: filter => {const id='lenz-'+(++serial);return request(id,'read',['REQ',id,filter],filter.limit);},
    close,
  };
}

// Inclusive time boundaries avoid skipping events tied at a page boundary.
// Saturation is reported instead of advancing past unseen events.
export async function readMailbox(relay, publicKey, cursor, accept, now = Date.now()) {
  const since = Math.floor((now-86400000)/1000)-172800-60;
  let until = cursor?.until ?? Math.floor(now/1000)+60, limit = cursor?.limit ?? 128;
  for (let page = 0; page < 2; page++) {
    const events = await relay.read({kinds:[1059],'#p':[publicKey],since,until,limit});
    const ids = new Set(); let oldest = until;
    for (const event of events) {
      assert(typeof event?.id === 'string' && !ids.has(event.id) && Number.isSafeInteger(event.created_at) &&
        event.created_at >= since && event.created_at <= until, 'Invalid relay page ordering or duplicates.');
      ids.add(event.id);oldest=Math.min(oldest,event.created_at);
      await accept(event);
    }
    if (events.length < limit) return null;
    if (oldest === until) {
      assert(limit < 512, 'Relay inbox is saturated at one timestamp. Delivery is incomplete; use file sharing.');
      limit *= 2;
    } else { until = oldest; limit = 128; }
  }
  return {until,limit};
}

export async function readContactRequestInbox(relay, recipientId, cursor, accept, now = Date.now()) {
  assert(typeof recipientId==='string'&&/^[0-9a-f]{64}$/.test(recipientId),'Invalid request inbox.');
  const since=Math.floor((now-86400000)/1000);
  let until=cursor?.until??Math.floor(now/1000)+60,limit=cursor?.limit??64;
  for(let page=0;page<2;page++){
    const events=await relay.read({kinds:[RUMOR_KIND],'#p':[recipientId],since,until,limit});
    assert(Array.isArray(events)&&events.length<=limit,'Contact request inbox exceeded its limit.');
    const ids=new Set();let oldest=until;
    for(const event of events){
      assert(typeof event?.id==='string'&&!ids.has(event.id)&&Number.isSafeInteger(event.created_at)&&
        event.created_at>=since&&event.created_at<=until,'Invalid contact request page or duplicates.');
      ids.add(event.id);oldest=Math.min(oldest,event.created_at);await accept(event);
    }
    if(events.length<limit)return null;
    if(oldest===until){assert(limit<128,'Contact request inbox is saturated. Some requests remain undelivered.');limit*=2;}
    else{until=oldest;limit=64;}
  }
  return {until,limit};
}
