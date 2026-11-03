// One bounded read at a time; revoked, hidden and offline replies cannot land.
export function liveRead({read,accept,status=()=>{},allowed=()=>navigator.onLine&&!document.hidden,period=20000,setTimer=setTimeout,clearTimer=clearTimeout}){
  let enabled=false,generation=0,timer=null,controller=null,failures=0;
  function cancel(){generation++;clearTimer(timer);timer=null;controller?.abort();controller=null;}
  async function run(){
    if(!enabled||!allowed()||controller)return;
    const ticket=++generation;controller=new AbortController();status('updating');
    try{
      const value=await read(controller.signal);
      if(ticket!==generation||!enabled||!allowed())return;
      accept(value);failures=0;status('live');
    }catch{if(ticket===generation){failures++;status('retrying');}}
    finally{if(ticket===generation){controller=null;if(enabled&&allowed())timer=setTimer(run,Math.min(60000,period*2**Math.min(failures,2)));}}
  }
  return {
    setEnabled(value){enabled=Boolean(value);cancel();failures=0;if(enabled&&allowed())void run();else status(enabled?'paused':'off');},
    wake(){cancel();if(enabled&&allowed())void run();else status(enabled?'paused':'off');},
    stop(){enabled=false;cancel();status('off');},
  };
}
