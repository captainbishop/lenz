import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity } from './public/peer-crypto.js';
import { encodeContact, decodeContact } from './public/contact-card.js';
import qrcode from './public/qr-vendor/qrcode-generator.js';
import jsQR from './public/qr-vendor/jsqr.js';

test('compact QR round trip preserves full keys and Unicode names through real pixels', async () => {
  const { profile } = await createIdentity('Jọhnson 🌿');
  const text = await encodeContact(profile), qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const count = qr.getModuleCount(), cell = 5, size = (count + 8) * cell;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < count * cell; y++) for (let x = 0; x < count * cell; x++) {
    if (!qr.isDark(Math.floor(y / cell), Math.floor(x / cell))) continue;
    const pos = ((y + 4 * cell) * size + x + 4 * cell) * 4;
    pixels[pos] = pixels[pos + 1] = pixels[pos + 2] = 0;
  }
  const scanned = jsQR(pixels, size, size); assert(scanned);
  assert.deepEqual(await decodeContact(scanned.data), profile);
});
test('legacy files retain their key binding; corrupt and oversized cards fail', async () => {
  const { profile } = await createIdentity('Amina');
  assert.deepEqual(await decodeContact(JSON.stringify(profile)), profile);
  await assert.rejects(decodeContact(JSON.stringify({ ...profile, id: '0'.repeat(64) })), /fingerprint/);
  await assert.rejects(decodeContact('x'.repeat(2001)), /too large/);
  await assert.rejects(decodeContact('proof-u:contact:v1:["A", "bad", "bad"]'), /invalid key/);
  await assert.rejects(decodeContact('proof-u:contact:v1:["A"]'), /not a supported/);
  const valid = await encodeContact(profile), parts = JSON.parse(valid.slice('proof-u:contact:v1:'.length));
  parts[1] = btoa(String.fromCharCode(...new Uint8Array(65).fill(4)));
  await assert.rejects(decodeContact('proof-u:contact:v1:' + JSON.stringify(parts)));
});

test('Lenz ID round trip preserves both keys and stays stable across profile edits',async()=>{
  const {encodeLenzId,decodeLenzId}=await import('./public/contact-card.js');
  const {profile}=await createIdentity('Amina');
  const id=await encodeLenzId(profile),decoded=await decodeLenzId(id);
  assert.equal(decoded.id,profile.id);assert.equal(decoded.signingPublic,profile.signingPublic);assert.equal(decoded.boxPublic,profile.boxPublic);
  assert.equal(await encodeLenzId({...profile,name:'Bola',avatar:'moon'}),id);
  assert.equal((await decodeContact('  '+id+'  ')).id,profile.id);
  assert.equal(id.length,193);
});
test('Lenz IDs reject typos, missing keys, wrong checksums and bare fingerprints',async()=>{
  const {encodeLenzId,decodeLenzId}=await import('./public/contact-card.js');
  const {profile}=await createIdentity('Amina'),id=await encodeLenzId(profile);
  await assert.rejects(decodeLenzId(id.slice(0,-1)));
  await assert.rejects(decodeLenzId(id.slice(0,-12)+'0'.repeat(12)));
  await assert.rejects(decodeLenzId(id.slice(0,9)+(id[9]==='a'?'b':'a')+id.slice(10)));
  await assert.rejects(decodeContact(profile.id),/full Lenz ID/);
});
