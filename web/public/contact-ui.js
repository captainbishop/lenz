import { readState } from './chat-store.js';
import { decodeContact, encodeLenzId, drawContact, readContactFile, scanPixels } from './contact-card.js';
import { paintAvatar } from './profile-display.js';
import { addContactRequest } from './contact-requests.js';
import { prepareChatDelivery, requestAutomaticDelivery } from './delivery-mode.js';

const $ = selector => document.querySelector(selector);
const safetyCode = profile => profile.id.match(/.{8}/g).join(' ');
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function png(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create your card image.')), 'image/png'));
}
let profileKey = null, cardFile = null;
export async function renderProfile(profile) {
  $('#show-add-contact').disabled = !profile;
  if (!profile) return;
  $('#my-name').textContent = $('#share-name').textContent = profile.name;
  paintAvatar($('#my-avatar'), profile); paintAvatar($('#share-avatar'), profile);
  $('#photo-sharing-note').hidden = !profile.photo;
  $('#my-card').value = JSON.stringify(profile);
  $('#my-lenz-id').value = await encodeLenzId(profile);
  $('#my-code').textContent = safetyCode(profile);
  if (profileKey === JSON.stringify(profile)) return;
  const qr = $('#contact-qr'); await drawContact(qr, profile);
  const card = document.createElement('canvas'); card.width = Math.max(480, qr.width); card.height = qr.height + 150;
  const ctx = card.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, card.width, card.height);
  ctx.fillStyle = '#173f35'; ctx.textAlign = 'center'; ctx.font = 'bold 26px Segoe UI, sans-serif';
  // Fit long names without dropping characters from a shared card.
  for (let size = 26; ctx.measureText(profile.name).width > card.width - 40 && size > 12; size--) ctx.font = `bold ${size}px Segoe UI, sans-serif`;
  ctx.fillText(profile.name, card.width / 2, 44, card.width - 40);
  ctx.drawImage(qr, (card.width - qr.width) / 2, 60);
  ctx.font = '16px Segoe UI, sans-serif'; ctx.fillText('Scan my Lenz ID', card.width / 2, card.height - 32);
  cardFile = new File([await png(card)], 'lenz-id.png', { type: 'image/png' });
  profileKey = JSON.stringify(profile);
}

export function setupContacts({ action, status, select, selectExisting = () => false }) {
  let reviewed = null, reviewedOwner=null, reviewedRecovery=null, revision=0, stream = null, cameraSession = 0, timer = null;
  function feedback(text, error = false) { $('#contact-feedback').textContent = text; $('#contact-feedback').className = error ? 'error' : 'quiet'; }
  function resetReview() {
    revision++;reviewedRecovery=null;$('#contact-label').disabled=false;
    reviewed = null; reviewedOwner=null; $('#contact-review').hidden = true; $('#verified').checked = false; $('#confirm-contact').disabled = true;
  }
  function stopCamera() {
    cameraSession++; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null;
    $('#contact-camera').srcObject = null; $('#camera-panel').hidden = true; $('#scan-contact').disabled = false;
  }
  async function review(profile,update=false,expectedRevision=revision) {
    const state = await readState();
    if(expectedRevision!==revision)return false;
    if (!state.identity) throw new Error('Choose your name first.');
    if (profile.id === state.identity.profile.id) throw new Error('This is your own Lenz ID.');
    const existing = state.contacts.find(p => p.id === profile.id);
    if (existing && selectExisting()&&!update) { await select(existing.id); $('#add-contact').close(); return; }
    if (existing && !update && existing.name === profile.name && (existing.avatar ?? 'moon') === (profile.avatar ?? 'moon') && existing.photo === profile.photo) throw new Error('This person is already in your contacts.');
    reviewed = profile; reviewedOwner=state.identity.profile.id; $('#contact-name').textContent = profile.name; $('#contact-label').value = profile.name;
    paintAvatar($('#contact-avatar'), profile); $('#contact-code').textContent = safetyCode(profile);
    $('#confirm-contact').textContent = existing ? 'Update contact' : 'Send request';
    $('#contact-review').hidden = false;
    feedback(existing ? `Updated profile for ${existing.name}. Confirm the new name or picture with them.` : state.contacts.some(p => p.name === profile.name)
      ? 'You already have someone with this name. Confirm who shared this new ID.'
      : 'Confirm this ID with the person. Adding them sends a message request.');
    $('#verified').focus();
    return true;
  }
  async function reviewText(text,own){
    let link;try{if(text.trimStart().startsWith('{')){const value=JSON.parse(text);if(value.type==='lenz/chat-recovery-link/v1')link=value;}}catch{}
    if(link){const result=await(await import('./contact-recovery.js')).reviewContactRecovery(link);if(own!==revision)return;
      if(!await review(result.link.to,true,own))return;
      reviewedRecovery=result.link;$('#contact-label').value=result.previousName;$('#contact-label').disabled=true;$('#confirm-contact').textContent='Use updated ID';
      feedback(`Signed update for ${result.previousName}. Confirm it with them. This enables chat; the earlier ID and payment records stay saved.`);
    }else{const profile=await decodeContact(text);if(own===revision)await review(profile,false,own);}
  }
  const shareUpdate=document.createElement('button');shareUpdate.id='share-recovery-link';shareUpdate.type='button';shareUpdate.className='secondary';shareUpdate.textContent='Save updated ID';shareUpdate.hidden=true;$('#share-contact .dialog-actions').after(shareUpdate);
  $('#show-card').onclick = () => action(async()=>{const state=await readState();shareUpdate.hidden=!state.recoveredChat;$('#share-feedback').textContent=state.recoveredChat?'Share the signed update with contacts who know your earlier ID.':'';$('#share-contact').showModal();$('#share-contact').scrollTop=0;});
  shareUpdate.onclick=()=>action(async()=>{const state=await readState();if(!state.recoveredChat)return;
    const link=await(await import('./legacy-recovery.js')).validateRecoveryLink(state.recoveredChat.link,state.recoveredChat.sourceId);
    if(link.to.id!==state.identity.profile.id)throw Error('The saved update does not match this account.');
    download(new Blob([JSON.stringify(link)],{type:'application/json'}),'lenz-updated-id.json');$('#share-feedback').textContent='Signed ID update downloaded.';
  });
  $('#save-qr').onclick = () => { if (cardFile) download(cardFile, cardFile.name); };
  async function copyId() {
    try { await navigator.clipboard.writeText($('#my-lenz-id').value); $('#share-feedback').textContent = 'Lenz ID copied.'; }
    catch { $('#my-lenz-id').closest('details').open=true; $('#my-lenz-id').focus(); $('#my-lenz-id').select(); $('#share-feedback').textContent = 'Select and copy your Lenz ID.'; }
  }
  $('#copy-lenz-id').onclick = copyId;
  $('#share-card').onclick = async () => {
    try {
      if (navigator.share) { await navigator.share({title:'My Lenz ID',text:$('#my-lenz-id').value}); $('#share-feedback').textContent = 'Lenz ID shared.'; }
      else await copyId();
    } catch (error) { $('#share-feedback').textContent = error.name === 'AbortError' ? 'Sharing cancelled.' : 'Use Copy ID to share your address.'; }
  };
  $('#save-card').onclick = () => action(async () => {
    const state = await readState(); download(new Blob([JSON.stringify(state.identity.profile)], { type: 'application/json' }), 'proof-u-contact.json');
  });
  $('#show-add-contact').onclick = () => {
    resetReview(); feedback(''); $('#contact-file').value = ''; $('#contact-card').value = '';
    $('#contact-advanced').open = false; $('#add-contact').showModal();
  };
  for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => document.getElementById(button.dataset.close).close();
  $('#add-contact').addEventListener('close', () => { stopCamera(); resetReview(); });
  $('#contact-file').onchange = () => {stopCamera();resetReview();const own=revision,file=$('#contact-file').files[0];return action(async () => {
    if(!file)return;feedback('Reading this card on your device…');
    if(!file.type.startsWith('image/')){if(file.size>65536)throw Error('This ID file is too large.');await reviewText(await file.text(),own);}
    else{const profile=await readContactFile(file);if(own===revision)await review(profile,false,own);}
  });};
  $('#review-contact').onclick = () => action(async () => {
    stopCamera(); resetReview(); await reviewText($('#contact-card').value,revision);
  });
  $('#contact-card').oninput = resetReview;
  $('#verified').onchange = () => { $('#confirm-contact').disabled = !reviewed || !$('#verified').checked; };
  $('#confirm-contact').onclick = () => action(async () => {
    if (!reviewed || !$('#verified').checked) throw new Error('Confirm who shared this ID first.');
    const owner=reviewedOwner;
    if((await readState()).identity?.profile.id!==owner)throw Error('Your account changed. Open this contact again.');
    if(reviewedRecovery){const id=await(await import('./contact-recovery.js')).acceptContactRecovery(reviewedRecovery);await select(id);$('#add-contact').close();status('Updated chat ID saved. Earlier messages and payments are unchanged.');return;}
    const profile = {...structuredClone(reviewed),name:$('#contact-label').value.trim() || reviewed.name};
    await prepareChatDelivery(owner);
    const result=await addContactRequest(profile,{owner});
    await select(profile.id); $('#add-contact').close();
    if(result.packet&&!await requestAutomaticDelivery(result.packet))throw Error('Your account changed. The original request stays saved.');
    status(result.created?`Request saved for ${profile.name}. It will send when connected.`:`${profile.name}’s contact saved.`);
  });
  $('#scan-contact').onclick = async () => {
    stopCamera(); resetReview(); const session = cameraSession;
    $('#scan-contact').disabled = true; $('#camera-panel').hidden = false;
    feedback('Allow the camera, then point it at their QR.');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (session !== cameraSession) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened; const video = $('#contact-camera'); video.srcObject = stream; await video.play();
      if (session !== cameraSession) return;
      const scan = async () => {
        if (session !== cameraSession) return;
        try {
          const text = video.readyState >= 2 ? scanPixels(video, video.videoWidth, video.videoHeight) : null;
          if (text) { stopCamera(); await action(async () => { resetReview(); await review(await decodeContact(text)); }); return; }
          timer = setTimeout(scan, 250);
        } catch { stopCamera(); feedback('Could not read the camera. Choose a card image instead.', true); }
      }; scan();
    } catch {
      if (session !== cameraSession) return;
      stopCamera(); feedback('Camera unavailable or permission declined. Paste a Lenz ID or open a QR image.', true);
    }
  };
  $('#stop-camera').onclick = () => { stopCamera(); feedback('Camera stopped. You can choose a card image instead.'); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);
}
