import qrcode from './qr-vendor/qrcode-generator.js';
import jsQR from './qr-vendor/jsqr.js';
import { CHAT_DOMAIN, validateProfile, digest, hex, unhex } from './peer-crypto.js';

const PREFIX = 'proof-u:contact:v1:';
qrcode.stringToBytes = text => Array.from(new TextEncoder().encode(text));
const base64 = value => btoa(String.fromCharCode(...unhex(value)));
function keyFromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{87}=$/.test(value)) throw new Error('This contact card has an invalid key.');
  const raw = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (btoa(String.fromCharCode(...raw)) !== value) throw new Error('This contact card has an invalid key.');
  return hex(raw);
}
export async function encodeContact(profile) {
  const p = await validateProfile(profile);
  const parts = [p.name, base64(p.signingPublic), base64(p.boxPublic)];
  if (p.avatar) parts.push(p.avatar);
  return PREFIX + JSON.stringify(parts);
}
export async function decodeContact(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > (text.trimStart().startsWith('{') ? 32000 : 2000)) throw new Error('This contact card is too large.');
  if (!text.startsWith(PREFIX)) return validateProfile(JSON.parse(text));
  const parts = JSON.parse(text.slice(PREFIX.length));
  if (!Array.isArray(parts) || ![3, 4].includes(parts.length)) throw new Error('This is not a supported contact card.');
  const [name, signing, box] = parts;
  const signingPublic = keyFromBase64(signing), boxPublic = keyFromBase64(box);
  return validateProfile({ type: CHAT_DOMAIN, name, signingPublic, boxPublic, ...(parts.length === 4 ? { avatar: parts[3] } : {}),
    id: await digest([CHAT_DOMAIN, signingPublic, boxPublic]) });
}
export async function drawContact(canvas, profile) {
  const qr = qrcode(0, 'M'); qr.addData(await encodeContact(profile)); qr.make();
  const count = qr.getModuleCount(), cell = 6, size = (count + 8) * cell;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#173f35';
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.isDark(row, col)) ctx.fillRect((col + 4) * cell, (row + 4) * cell, cell, cell);
  }
}
// Decode pixels locally. No image or contact is uploaded.
export function scanPixels(source, width, height) {
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
}
export async function readContactFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a contact image smaller than 10 MB.');
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file), image = new Image();
    try {
      image.src = url; await image.decode();
      const text = scanPixels(image, image.naturalWidth, image.naturalHeight);
      if (!text) throw new Error('No contact QR found. Choose a clear image of the whole card.');
      return decodeContact(text);
    } finally { URL.revokeObjectURL(url); }
  }
  if (file.size > 32000) throw new Error('This contact file is too large.');
  return decodeContact(await file.text());
}
