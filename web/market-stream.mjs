import {readMarketTape} from '../integrations/market-tape.mjs';
import {tapeRequest} from './public/market-tape.js';
import {checkedMarketEvent} from './public/market-stream-data.js';

// Public reads only; the caller cannot supply an upstream URL or an account.
export function createMarketStream({read=readMarketTape,Socket=WebSocket,clock=Date.now}={}){
  let active=0;const starts=[];
  return {subscribe(input,accept,end=()=>{}){
    const request=tapeRequest(input),coin=request.marketId.split(':').slice(2).join(':');
    while(starts.length&&starts[0]<=clock()-60000)starts.shift();
    if(active>=8||starts.length>=24)throw Error('Market stream busy');
    starts.push(clock());
    active++;let stopped=false,socket,timer,lastMessage=clock();const abort=new AbortController();
    const stop=()=>{if(stopped)return;stopped=true;active--;abort.abort();clearInterval(timer);socket?.close();};
    const fail=()=>{if(stopped)return;stop();end();};
    Promise.resolve().then(()=>read(request,{signal:abort.signal})).then(tape=>{
      if(stopped)return;
      accept(checkedMarketEvent({kind:'snapshot',tape},request,{now:clock()}));
      socket=new Socket('wss://api.hyperliquid.xyz/ws');
      socket.addEventListener('open',()=>{
        if(stopped)return;
        for(const subscription of [{type:'candle',coin,interval:request.interval},{type:'l2Book',coin}])socket.send(JSON.stringify({method:'subscribe',subscription}));
      });
      socket.addEventListener('message',({data})=>{
        if(stopped)return;
        try{
          if(typeof data!=='string'||data.length>262144)throw Error('Oversized market event');
          const message=JSON.parse(data);lastMessage=clock();let event;
          if(message.channel==='error')throw Error('Source error');
          if(message.channel==='l2Book'){const b=message.data;event={kind:'book',coin:b.coin,time:b.time,levels:b.levels?.map(side=>side.map(l=>({price:l.px,size:l.sz,orders:l.n})))};}
          else if(message.channel==='candle'){const c=message.data;event={kind:'candle',coin:c.s,candle:{coin:c.s,interval:c.i,time:c.t,open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v,trades:c.n}};}
          if(event)accept(checkedMarketEvent(event,request,{now:clock()}));
        }catch{fail();}
      });
      socket.addEventListener('error',fail);socket.addEventListener('close',fail);
      timer=setInterval(()=>{if(clock()-lastMessage>45000){fail();return;}if(socket.readyState===1)socket.send(JSON.stringify({method:'ping'}));},15000);
      timer.unref?.();
    }).catch(fail);
    return stop;
  }};
}
