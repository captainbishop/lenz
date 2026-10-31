import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, validateProfile, sealMessage, openMessage, signValue, verifyValue } from './public/peer-crypto.js';
import { privateName, avatarSource, validPhoto, PHOTO_LIMIT } from './public/profile-display.js';
import { encodeContact, decodeContact } from './public/contact-card.js';

test('profile edits keep the keys that authenticate and decrypt existing conversations', async () => {
  const a = await createIdentity('Amina'), b = await createIdentity('Bola');
  const original = structuredClone(a.profile), packet = await sealMessage(a, b.profile, { kind: 'chat', text: 'Still here' });
  a.profile = await validateProfile({ ...a.profile, name: 'Quiet Finch', avatar: 'moon' });
  assert.deepEqual(await openMessage(a, b.profile, packet), { kind: 'chat', text: 'Still here' });
  const signature = await signValue(a, ['after editing']);
  assert(await verifyValue(original.signingPublic, ['after editing'], signature));
  assert.equal(a.profile.id, original.id);
  assert.equal(a.signingPrivate.extractable, false); assert.equal(a.boxPrivate.extractable, false);
});
test('private defaults use readable names and a local fixed symbol, never a remote avatar service', () => {
  for (let n = 0; n < 30; n++) assert.match(privateName(), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.match(avatarSource(), /^data:image\/svg\+xml,/);
  assert.equal(avatarSource({ avatar: '<script>' }), avatarSource());
  assert.equal(avatarSource({ photo: 'https://example.com/track' }), avatarSource());
});
test('profile presentation has strict bounds and rejects active/remote image formats', async () => {
  const { profile } = await createIdentity('River Otter');
  for (const photo of ['https://example.com/photo.jpg', 'data:image/svg+xml,<svg onload="alert(1)"/>', 'data:image/jpeg;base64,YWJj', 'x'.repeat(PHOTO_LIMIT + 1)]) {
    assert.equal(validPhoto(photo), false);
    await assert.rejects(validateProfile({ ...profile, photo }), /photo/);
  }
  await assert.rejects(validateProfile({ ...profile, avatar: 'tracking-id' }), /avatar/);
  await assert.rejects(validateProfile({ ...profile, invisible: true }), /Invalid contact/);
  await assert.rejects(validateProfile({ ...profile, name: '   ' }), /name/);
});
test('compact contact cards carry chosen symbols and remain compatible with legacy profiles', async () => {
  const { profile } = await createIdentity('Moss Wren');
  assert.deepEqual(await decodeContact(await encodeContact(profile)), profile);
  const edited = { ...profile, avatar: 'leaf' };
  assert.deepEqual(await decodeContact(await encodeContact(edited)), edited);
  const invalid = (await encodeContact(edited)).replace('"leaf"', '"unknown"');
  await assert.rejects(decodeContact(invalid), /avatar/);
});
