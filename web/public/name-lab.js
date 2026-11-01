import {validateNameResult,changedNameAddress} from './name-results.js';
const $=id=>document.getElementById(id),key='lenz-name-check-v1';
let busy=false,last=null;
const request=()=>{
  const name=$('name-input').value,selected=$('name-system').value;
  const system=selected==='auto'?(/\.(near|testnet)$/.test(name)?'near':'ens'):selected;
  const network=system==='near'?(name.endsWith('.near')?'mainnet':'testnet'):$('name-network').value;
  return {system,network,name};
};
const same=(a,b)=>a && a.system===b.system && a.network===b.network && a.name===b.name;
function status(message,error=false){$('name-status').textContent=message;$('name-status').dataset.error=String(error);}
function help(){const r=request();$('name-route').textContent=r.system==='near'?'NEAR · '+(r.network==='mainnet'?'Mainnet':'Testnet'):'ENS · Aurora '+(r.network==='mainnet'?'Mainnet':'Testnet');}
function render(record,saved=false,changed=false){
  const r=record.result,found=['address_found','account_found'].includes(r.state);
  $('name-result').hidden=false;$('name-address-wrap').hidden=!found;$('name-symbol').textContent=r.name[0].toUpperCase();
  const labels={address_found:'Address found',account_found:'Account found',not_found:r.system==='near'?'Account not found':'No address found',no_address:'No Aurora address',offchain_required:'Off-chain resolver',unavailable:'Unavailable',unverified:'Unverified'};
  $('name-state').textContent=labels[r.state];$('name-normalized').textContent=r.name;$('name-chain').textContent='Aurora '+(r.network==='mainnet'?'Mainnet':'Testnet');
  $('name-freshness').textContent=(saved?'Saved check · not refreshed · ':'Checked ') + (r.checkedAt?new Date(r.checkedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No verified observation.');
  $('name-address').value=r.auroraAddress??'No address confirmed';
  $('name-change').hidden=!changed;$('name-change').textContent='Address changed. Confirm it with the person before using it.';
  const meanings={address_found:'',account_found:'Derived caller address · not a payment destination.',not_found:r.system==='near'?'No account found. Check the spelling.':'No public resolver found. Check the spelling or try another name.',no_address:'No Aurora address is set for this network.',offchain_required:'This name needs a resolver we do not support yet.',unavailable:'Could not reach the name service. Try again.',unverified:'This result could not be verified.'};
  $('name-meaning').textContent=meanings[r.state];$('name-details').replaceChildren();
  for(const [label,value] of [['Naming authority',r.authority],['Final block',r.block?.height],['Block hash',r.block?.hash],['Resolver',r.resolver],['ENS coin type',r.coinType]]){
    if(value===undefined)continue;const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);div.append(dt,dd);$('name-details').append(div);
  }
}
function remember(record){
  if(!$('name-remember').checked || !record.result.block)return;
  try{localStorage.setItem(key,JSON.stringify(record));$('name-forget').hidden=false;}
  catch{status('Lookup finished, but this browser could not save the result.',true);}
}
for(const id of ['name-input','name-system','name-network'])$(id).addEventListener('input',()=>{$('name-result').hidden=true;status('');help();});
$('name-forget').onclick=()=>{try{localStorage.removeItem(key);$('name-forget').hidden=true;$('name-remember').checked=false;status('Saved check forgotten.');}catch{status('This browser could not remove the saved check.',true);}};
$('name-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;const input=request();
  if(!navigator.onLine){if(last && same(last.request,input))render(last,true);status('Offline. Reconnect to refresh this result.',true);return;}
  busy=true;$('main').setAttribute('aria-busy','true');for(const id of ['name-check','name-input','name-system','name-network','name-remember','name-forget'])$(id).disabled=true;
  if(last && same(last.request,input))render(last,true);else $('name-result').hidden=true;status('Looking up name…');
  try{
    const response=await fetch('/api/names/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('Could not check this name. Try again.');
    if(!response.body)throw Error('The name service returned no data.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw Error('The name response was too large.');chunks.push(value);}}
    finally{await reader.cancel();reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const result=validateNameResult(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),input);
    if(['unavailable','unverified'].includes(result.state))throw Error(result.state==='unavailable'?'Name service unavailable. Previous result not refreshed.':'Could not verify the reply. Previous result not refreshed.');
    const changed=last && changedNameAddress(last.result,result),record={request:input,result};render(record,false,changed);last=record;
    status('');remember(record);
  }catch(error){if(last && same(last.request,input))render(last,true);status(error.name==='TimeoutError'?'Lookup timed out. Previous result not refreshed.':error.message,true);$('name-status').focus();}
  finally{busy=false;$('main').setAttribute('aria-busy','false');for(const id of ['name-check','name-input','name-system','name-network','name-remember','name-forget'])$(id).disabled=false;}
};
try{
  const saved=localStorage.getItem(key);
  if(saved){const record=JSON.parse(saved);record.result=validateNameResult(record.result,record.request);if(!record.result.block)throw Error('No saved observation');last=record;
    $('name-system').value='auto';$('name-network').value=record.request.network;$('name-input').value=record.request.name;
    $('name-remember').checked=true;$('name-forget').hidden=false;render(record,true);status('');}
}catch{status('The saved check could not be read. Run a new lookup.',true);$('name-forget').hidden=false;}
help();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/chat-sw.js').catch(()=>status('Offline storage unavailable. Keep this page open.',true));
