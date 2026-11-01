import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';

export async function testRelay() {
  const server = new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:34000});
  await new Promise(resolve=>server.once('listening',resolve));
  const events=new Map(),received=[],controls={refuse:false,drop:false,wrongAck:false,extra:null},connections=new Set();
  server.on('connection',ws=>{
    connections.add(ws);ws.on('close',()=>connections.delete(ws));
    ws.on('message',data=>{
      const msg=JSON.parse(data.toString());
      if(msg[0]==='EVENT') {
        const e=msg[1];received.push(e);
        if(controls.drop){ws.close();return;}
        const valid=!controls.refuse&&verifyEvent(JSON.parse(JSON.stringify(e)));
        if(valid)events.set(e.id,e);
        ws.send(JSON.stringify(['OK',controls.wrongAck?'f'.repeat(64):e.id,valid,valid?'':'blocked: test refusal']));
      }else if(msg[0]==='REQ') {
        const [_,id,f]=msg;
        const selected=[...events.values()].filter(e=>f.kinds.includes(e.kind)&&e.tags.some(t=>t[0]==='p'&&f['#p'].includes(t[1]))&&e.created_at>=f.since&&e.created_at<=f.until)
          .sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit);
        for(const event of selected.reverse())ws.send(JSON.stringify(['EVENT',id,event]));
        if(controls.extra)ws.send(controls.extra);
        ws.send(JSON.stringify(['EOSE',id]));
      }
    });
  });
  return {origin:'ws://127.0.0.1:'+server.address().port,events,received,controls,connections,
    close:async()=>{for(const ws of connections)ws.terminate();await new Promise(r=>server.close(r));}};
}
