import { readState, updateState } from './chat-store.js';
import { readNearVault, saveNearVault, compressed } from './near-protocol.js';
import { checkRheaConfig, checkRheaPacket } from './rhea-protocol.js';
import { prepareRefundReturn } from './near-deposit.js';
import { refundDepositTransaction } from './near-signer.js';
const $=s=>document.querySelector(s),config=await(await fetch('/rhea-config.json')).json();checkRheaConfig(config);
const run=async fn=>{try{await fn();await render();}catch(e){$('#tools-status').textContent=e.message;}};
function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`lenz-deposit-${value.expectedRoot}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#swap-file').onchange=()=>run(async()=>{
  const file=$('#swap-file').files[0];if(!file)return;if(file.size>50000)throw Error('Swap file is too large');const packet=JSON.parse(await file.text());await checkRheaPacket(config,packet);
  await updateState(async state=>{if(!state.identity)throw Error('Create a Lenz profile in the wallet first');const v=await readNearVault(state,config.reserve);v.rheaOrders??=[];if(!v.rheaOrders.some(o=>o.packet.id===packet.id)){if(v.rheaOrders.length>=64)throw Error('Swap file limit reached');v.rheaOrders.push({packet,status:null});}await saveNearVault(state,v);});
  $('#tools-status').textContent='Verified packet saved. Open the wallet to submit or check it. The signed recipient is unchanged.';
});
async function render(){const s=await readState();if(!s.identity)return;const v=await readNearVault(s,config.reserve);$('#tools-orders').replaceChildren();
  for(const o of v.rheaOrders??[]){
    const diagnostic=document.createElement('p'),check=document.createElement('button');check.textContent='Inspect receipts: '+o.packet.id;
    check.onclick=()=>run(async()=>{const r=await fetch('/api/rhea/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapter:config.adapter,id:o.packet.id}),signal:AbortSignal.timeout(30000)});const result=await r.json();if(!r.ok)throw Error(result.error??'Receipt check failed');$('#receipt-result').textContent=JSON.stringify(result,null,2);});diagnostic.append(check);$('#tools-orders').append(diagnostic);
    if(o.status?.stage!=='refunded'||o.returnReceipt||o.packet.instruction.owner!==compressed(s.identity.profile.signingPublic))continue;
    const row=document.createElement('p'),button=document.createElement('button');button.textContent='Export deposit action: '+o.packet.id;
    button.onclick=()=>run(async()=>{const action=await updateState(async state=>{const vault=await readNearVault(state,config.reserve),entry=vault.rheaOrders.find(e=>e.packet.id===o.packet.id);entry.returnRequest??=await prepareRefundReturn(vault,state.identity,entry);const tx=await refundDepositTransaction(entry.returnRequest,{config,entry,identity:state.identity});await saveNearVault(state,vault);const call=tx.actions[0].params;return {network:tx.network,signerId:tx.signerId,receiverId:tx.receiverId,...call,expectedRoot:entry.returnRequest.id};});download(action);});row.append(button);$('#tools-orders').append(row);
  }
}
await run(async()=>{});
