import { readState } from './chat-store.js';
import { nearbySession } from './nearby-client.js';
import { encodeSignal, decodeSignal } from './nearby-protocol.js';
import { scanPixels } from './contact-card.js';
import qrcode from './qr-vendor/qrcode-generator.js';

const $=s=>dialog.querySelector(s), button=document.createElement('button');
button.type='button';button.className='secondary';button.id='nearby-open';button.textContent='Nearby';
document.querySelector('header nav')?.append(button);
const dialog=document.createElement('dialog');dialog.id='nearby-dialog';dialog.setAttribute('aria-labelledby','nearby-title');
dialog.innerHTML=`<div class="dialog-top"><h2 id="nearby-title">Nearby</h2><button class="secondary" type="button" id="nearby-close">Close</button></div>
<p id="nearby-status" role="status" aria-live="polite">Pair on the same Wi-Fi or hotspot.</p>
<div id="nearby-setup"><label for="nearby-person">Person</label><select id="nearby-person"></select><p class="quiet" id="nearby-empty" hidden>Add and verify their Lenz ID first.</p>
<div class="nearby-actions"><button type="button" id="nearby-create">Create code</button><button class="secondary" type="button" id="nearby-scan">Scan code</button></div></div>
<div id="nearby-code-panel" hidden><h3 id="nearby-code-title"></h3><canvas id="nearby-qr" role="img" aria-label="Nearby pairing QR code"></canvas><p class="quiet" id="nearby-code-hint"></p><button class="secondary" type="button" id="nearby-copy">Copy code</button><details><summary>View code</summary><textarea id="nearby-output" readonly rows="3" aria-label="Your nearby pairing code"></textarea></details></div>
<div id="nearby-camera-panel" hidden><video id="nearby-camera" muted autoplay playsinline></video><button class="secondary" type="button" id="nearby-camera-stop">Stop camera</button></div>
<details id="nearby-paste"><summary>Paste a code instead</summary><label for="nearby-input">Their pairing code</label><textarea id="nearby-input" rows="3" maxlength="6013" autocomplete="off" spellcheck="false"></textarea><button type="button" id="nearby-use">Use code</button></details>
<div id="nearby-connected" hidden><p>New messages and payments to this person send directly while both keep Lenz open.</p><button type="button" id="nearby-send-saved">Send saved items</button><p class="quiet">A received file is separate from payment confirmation.</p></div>
<button class="secondary" type="button" id="nearby-disconnect" hidden>Disconnect</button>
<details><summary>Connection details</summary><p class="quiet">No internet relay is used. Pairing codes expire in three minutes and reveal connection details to the person scanning them. Keep the codes private. Both devices need a reachable local network; some guest Wi-Fi networks block this.</p></details>`;
document.body.append(dialog);
let session=null,phase='start',stream=null,frame=0,cameraRun=0,busy=false,contract=null,problem='';
const status=(message,error=false)=>{$('#nearby-status').textContent=message;$('#nearby-status').className=error?'error':'';};
function cameraStop(){cameraRun++;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;$('#nearby-camera').srcObject=null;$('#nearby-camera-panel').hidden=true;}
function reset(){problem='';cameraStop();session?.close();session=null;phase='start';$('#nearby-setup').hidden=false;$('#nearby-person').disabled=false;$('#nearby-create').hidden=false;$('#nearby-code-panel').hidden=true;$('#nearby-connected').hidden=true;$('#nearby-paste').hidden=false;$('#nearby-paste').open=false;$('#nearby-disconnect').hidden=true;$('#nearby-input').value='';$('#nearby-output').value='';button.title='Connect to someone nearby';}
async function action(operation){if(busy)return;busy=true;for(const id of ['#nearby-create','#nearby-use','#nearby-scan'])$(id).disabled=true;try{await operation();}catch(error){status(error.message,true);}finally{busy=false;for(const id of ['#nearby-create','#nearby-use','#nearby-scan'])$(id).disabled=!$('#nearby-person').value;}}
async function refresh(){if(!session?.connected)return;const count=await session.pending();$('#nearby-send-saved').disabled=!count;$('#nearby-send-saved').textContent=count?`Send ${count} saved item${count===1?'':'s'}`:'No saved items waiting';}
async function start(){
  if(session)return;
  const config=await(await fetch('/near-config.json')).json();
  contract=config.ready&&config.network==='testnet'&&typeof config.contract==='string'&&config.contract.endsWith('.testnet')?config.contract:null;
  session=await nearbySession($('#nearby-person').value,{contract,onError:error=>{problem=error.message;status(problem,true);},onUpdate:()=>{void refresh();},onState:(state,contact)=>{
    if(state==='connected'){cameraStop();phase='connected';$('#nearby-setup').hidden=true;$('#nearby-code-panel').hidden=true;$('#nearby-paste').hidden=true;$('#nearby-connected').hidden=false;status(`Connected to ${contact.name}.`);button.title=`Nearby: connected to ${contact.name}`;void refresh();}
    else{cameraStop();$('#nearby-connected').hidden=true;status(problem?'Disconnected. '+problem:'Disconnected. Your files stay saved.',!!problem);$('#nearby-disconnect').textContent='Start again';button.title='Nearby disconnected';}
  }});$('#nearby-person').disabled=true;$('#nearby-create').hidden=true;$('#nearby-disconnect').hidden=false;$('#nearby-disconnect').textContent='Disconnect';
}
async function showCode(signal){
  const code=await encodeSignal(signal);$('#nearby-output').value=code;$('#nearby-code-panel').hidden=false;
  $('#nearby-code-title').textContent=phase==='offer'?`Let ${session.contact.name} scan this`:'Show them your reply';
  $('#nearby-code-hint').textContent=phase==='offer'?'Then scan or paste their reply.':'They scan this once to finish connecting.';
  const canvas=$('#nearby-qr');
  try{const qr=qrcode(0,'M');qr.addData(code);qr.make();const count=qr.getModuleCount(),cell=5;canvas.width=canvas.height=(count+8)*cell;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#173f35';for(let r=0;r<count;r++)for(let c=0;c<count;c++)if(qr.isDark(r,c))ctx.fillRect((c+4)*cell,(r+4)*cell,cell,cell);canvas.hidden=false;}
  catch{canvas.hidden=true;$('#nearby-code-hint').textContent='This connection code is too large for a QR. Copy and share it with your contact.';}
}
async function useCode(code){
  const signal=await decodeSignal(code);
  if(phase==='offer'){await session.finish(signal);phase='connecting';$('#nearby-input').value='';status('Connecting directly…');}
  else if(phase==='start'){await start();try{const answer=await session.answer(signal);phase='answer';await showCode(answer);$('#nearby-input').value='';status('Show your reply to finish pairing.');}catch(error){reset();throw error;}}
  else throw Error('Start a new connection to use another code.');
}
button.onclick=()=>{void action(async()=>{
  if(!session){reset();const state=await readState(),select=$('#nearby-person');select.replaceChildren();for(const p of state.contacts){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option);}$('#nearby-empty').hidden=!!state.contacts.length;status(state.identity?'Pair on the same Wi-Fi or hotspot.':'Create your Lenz profile first.');}
  dialog.showModal();if(!globalThis.RTCPeerConnection||!globalThis.CompressionStream)status('Nearby transfer is unavailable in this browser. File sharing still works.',true);await refresh();
});};
$('#nearby-create').onclick=()=>action(async()=>{await start();try{const offer=await session.offer();phase='offer';await showCode(offer);status('Share this code with the selected person.');}catch(error){reset();throw error;}});
$('#nearby-use').onclick=()=>action(()=>useCode($('#nearby-input').value));
$('#nearby-copy').onclick=()=>action(async()=>{try{await navigator.clipboard.writeText($('#nearby-output').value);status('Pairing code copied.');}catch{$('#nearby-output').closest('details').open=true;$('#nearby-output').select();status('Select and copy the pairing code.');}});
$('#nearby-send-saved').onclick=()=>action(async()=>{await session.sendSaved();await refresh();});
$('#nearby-disconnect').onclick=()=>{reset();status('Disconnected. Create a fresh code to reconnect.');};
$('#nearby-close').onclick=()=>dialog.close();dialog.addEventListener('close',cameraStop);$('#nearby-camera-stop').onclick=cameraStop;
$('#nearby-scan').onclick=()=>action(async()=>{
  cameraStop();const run=cameraRun;
  try{const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});if(run!==cameraRun){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;$('#nearby-camera-panel').hidden=false;const video=$('#nearby-camera');video.srcObject=stream;await video.play();
    const scan=()=>{if(run!==cameraRun)return;if(video.readyState>=2){const code=scanPixels(video,video.videoWidth,video.videoHeight);if(code){cameraStop();void action(()=>useCode(code));return;}}frame=requestAnimationFrame(scan);};frame=requestAnimationFrame(scan);
  }catch{cameraStop();throw Error('Camera unavailable. Paste the pairing code instead.');}
});
addEventListener('pagehide',()=>{cameraStop();session?.close();});
