import {tapeRequest} from './market-tape.js';
import {checkedMarketEvent} from './market-stream-data.js';

export function marketStream({request,accept,status=()=>{},allowed=()=>navigator.onLine&&!document.hidden,fetcher=fetch}){
  let enabled=false,generation=0,controller=null,timer=null,failures=0;
  function cancel(){generation++;clearTimeout(timer);controller?.abort();controller=null;}
  async function run(){
    if(!enabled||!allowed()||controller)return;
    const ticket=++generation,abort=new AbortController();controller=abort;
    let watchdog,reader;status('connecting');
    const arm=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>abort.abort(),45000);};
    try{
      const expected=tapeRequest(request());arm();
      const response=await fetcher('/api/markets/stream',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(expected),signal:abort.signal});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('application/x-ndjson')||!response.body)throw Error('Stream unavailable');
      reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='';
      while(true){
        const {done,value}=await reader.read();if(ticket!==generation||!enabled||!allowed())return;
        if(done)throw Error('Stream ended');
        arm();buffer+=decoder.decode(value,{stream:true});if(buffer.length>524288)throw Error('Oversized stream');
        let newline;while((newline=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
          const event=checkedMarketEvent(JSON.parse(line),expected);accept(event);
          if(event.kind!=='snapshot'){failures=0;status('streaming');}
        }
      }
    }catch{if(ticket===generation){failures++;status('retrying');}}
    finally{
      clearTimeout(watchdog);await reader?.cancel().catch(()=>{});reader?.releaseLock();abort.abort();
      if(ticket===generation){controller=null;if(enabled&&allowed())timer=setTimeout(run,Math.min(30000,1000*2**Math.min(failures,5)));}
    }
  }
  return {
    setEnabled(value){enabled=Boolean(value);cancel();failures=0;if(enabled&&allowed())void run();else status(enabled?'paused':'off');},
    wake(){cancel();if(enabled&&allowed())void run();else status(enabled?'paused':'off');},
    stop(){enabled=false;cancel();status('off');},
  };
}
