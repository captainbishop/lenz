export function loadWorkspace(target,{load,mount,label}){
  let workspace=null,module=null,pending=null,visible=false,pageActive=true,args=[];
  const status=document.createElement('p');status.className='quiet';status.setAttribute('role','status');
  function activate(){
    if(!visible||!pageActive)return;
    if(workspace){workspace.show(true,...args);return;}
    if(module){status.remove();workspace=mount(module);workspace.show(true,...args);return;}
    if(pending)return;
    status.textContent=`Loading ${label}…`;target.append(status);
    pending=load().then(value=>{module=value;pending=null;activate();},()=>{pending=null;if(visible&&pageActive)status.textContent=`Could not load ${label}. Refresh this page to try again.`;});
  }
  addEventListener('pagehide',()=>{pageActive=false;});
  addEventListener('pageshow',()=>{pageActive=true;activate();});
  return {
    show(value,...next){
      visible=value;target.hidden=!value;
      if(workspace){args=next;workspace.show(value,...next);return;}
      if(!value){args=[];return;}
      // Background data renders must retain a requested market until its screen loads.
      args=Array.from({length:Math.max(args.length,next.length)},(_,i)=>next[i]??args[i]);
      activate();
    },
    update(){workspace?.update?.();}
  };
}
