import { readState, updateState } from './chat-store.js';
import { decodeContact, encodeLenzId, drawContact, readContactFile, scanPixels } from './contact-card.js';
import { paintAvatar } from './profile-display.js';

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
  let reviewed = null, stream = null, cameraSession = 0, timer = null;
  function feedback(text, error = false) { $('#contact-feedback').textContent = text; $('#contact-feedback').className = error ? 'error' : 'quiet'; }
  function resetReview() {
    reviewed = null; $('#contact-review').hidden = true; $('#verified').checked = false; $('#confirm-contact').disabled = true;
  }
  function stopCamera() {
    cameraSession++; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null;
    $('#contact-camera').srcObject = null; $('#camera-panel').hidden = true; $('#scan-contact').disabled = false;
  }
  async function review(profile) {
    const state = await readState();
    if (!state.identity) throw new Error('Choose your name first.');
    if (profile.id === state.identity.profile.id) throw new Error('This is your own Lenz ID.');
    const existing = state.contacts.find(p => p.id === profile.id);
    if (existing && selectExisting()) { await select(existing.id); $('#add-contact').close(); return; }
    if (existing && existing.name === profile.name && (existing.avatar ?? 'moon') === (profile.avatar ?? 'moon') && existing.photo === profile.photo) throw new Error('This person is already in your contacts.');
    reviewed = profile; $('#contact-name').textContent = profile.name; $('#contact-label').value = profile.name;
    paintAvatar($('#contact-avatar'), profile); $('#contact-code').textContent = safetyCode(profile);
    $('#confirm-contact').textContent = existing ? 'Update contact' : 'Add contact';
    $('#contact-review').hidden = false;
    feedback(existing ? `Updated profile for ${existing.name}. Confirm the new name or picture with them.` : state.contacts.some(p => p.name === profile.name)
      ? 'You already have someone with this name. Confirm who shared this new ID.'
      : 'Confirm this ID with the person before adding them.');
    $('#verified').focus();
  }
  $('#show-card').onclick = () => { $('#share-feedback').textContent = ''; $('#share-contact').showModal(); $('#share-contact').scrollTop = 0; };
  $('#save-qr').onclick = () => { if (cardFile) download(cardFile, cardFile.name); };
  async function copyId() {
    try { await navigator.clipboard.writeText($('#my-lenz-id').value); $('#share-feedback').textContent = 'Lenz ID copied.'; }
    catch { $('#my-lenz-id').focus(); $('#my-lenz-id').select(); $('#share-feedback').textContent = 'Select and copy your Lenz ID.'; }
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
  $('#contact-file').onchange = () => action(async () => {
    stopCamera(); resetReview(); const file = $('#contact-file').files[0]; if (!file) return;
    feedback('Reading this card on your device…'); await review(await readContactFile(file));
  });
  $('#review-contact').onclick = () => action(async () => {
    stopCamera(); resetReview(); await review(await decodeContact($('#contact-card').value));
  });
  $('#contact-card').oninput = resetReview;
  $('#verified').onchange = () => { $('#confirm-contact').disabled = !reviewed || !$('#verified').checked; };
  $('#confirm-contact').onclick = () => action(async () => {
    if (!reviewed || !$('#verified').checked) throw new Error('Confirm who shared this ID first.');
    const profile = {...structuredClone(reviewed),name:$('#contact-label').value.trim() || reviewed.name};
    await updateState(state => {
      const index = state.contacts.findIndex(p => p.id === profile.id);
      if (index === -1) state.contacts.push(profile); else state.contacts[index] = profile;
    });
    await select(profile.id); $('#add-contact').close(); status(`${profile.name} is ready for a conversation.`);
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
