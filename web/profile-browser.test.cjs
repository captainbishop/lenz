// Fresh, isolated browser stores only. Never connects to the user's live profile.
const { chromium } = require('playwright');
const sharp = require('sharp');
const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const checks = [], errors = [];
const base = 'http://127.0.0.1:4173';
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true'); }
async function status(page, text) { await page.waitForFunction(text => document.querySelector('#status').textContent.includes(text), text); await idle(page); }
async function profile(page) { return JSON.parse(await page.locator('#my-card').inputValue()); }
async function importCard(page, value, confirm = true) {
  await page.locator('#show-add-contact').click();
  await page.locator('#contact-file').setInputFiles({ name: 'contact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.locator('#contact-review').waitFor({ state: 'visible' }); await idle(page);
  assert(await page.locator('#confirm-contact').isDisabled());
  if (confirm) { await page.locator('#verified').check(); await page.locator('#confirm-contact').click(); await status(page, 'ready for a conversation'); }
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const state = await (await import('/chat-store.js')).readState();
    const { id, signingPublic, boxPublic } = state.identity.profile;
    return { id, signingPublic, boxPublic, messages: JSON.stringify(state.messages), contacts: JSON.stringify(state.contacts), tradeBox: JSON.stringify(state.tradeBox) };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const ca = await browser.newContext({ viewport: { width: 1280, height: 900 } }), cb = await browser.newContext();
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) { page.on('pageerror', error => errors.push(error.message)); await page.goto(base + '/chat.html'); await status(page, 'Private chat is ready'); }
    let original, before, photoProfile;
    await check('private onboarding creates a readable alias and default avatar without personal input', async () => {
      await a.locator('#continue-private').click(); await status(a, 'Identity saved'); original = await profile(a);
      assert.match(original.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/); assert.equal(original.avatar, 'moon');
      assert(await a.locator('#my-avatar img').evaluate(img => img.complete && img.naturalWidth > 0));
      await b.locator('#name').fill('Bola'); await b.locator('#identity-form button[type=submit]').click(); await status(b, 'Identity saved');
      await importCard(a, await profile(b)); await importCard(b, original);
      await a.evaluate(async () => { const { updateState } = await import('/chat-store.js'); const { enableDemoMoney } = await import('/trade-service.js'); await updateState(enableDemoMoney); });
      await a.locator('#message').fill('Keep this conversation through my profile change.');
      await a.locator('#prepare-message').click(); await status(a, 'Message saved and encrypted');
      await a.locator('[data-close="handover"]').click(); before = await snapshot(a);
    });
    await check('name and symbol edits preserve account keys, encrypted history and an archived demo vault exactly', async () => {
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' }); await a.locator('#profile-name').fill('River Wren');
      await a.getByRole('button', { name: 'Wave avatar', exact: true }).click(); await a.locator('#save-profile').click(); await status(a, 'Profile saved');
      assert.deepEqual(await snapshot(a), before); assert.equal((await profile(a)).name, 'River Wren');
      assert((await a.locator('.bubble').innerText()).includes('Keep this conversation'));
      assert(await a.evaluate(async original => {
        const { signValue, verifyValue } = await import('/peer-crypto.js');
        const { identity } = await (await import('/chat-store.js')).readState();
        return verifyValue(original.signingPublic, ['same account'], await signValue(identity, ['same account']));
      }, original));
    });
    await check('cancel and generated-name preview do not save unwanted changes', async () => {
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' }); await a.locator('#new-private-name').click();
      assert.match(await a.locator('#profile-name').inputValue(), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
      await a.keyboard.press('Escape'); assert.equal((await profile(a)).name, 'River Wren');
    });
    await check('photo upload resizes locally, removes source metadata, and makes no network request', async () => {
      const file = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#386655' } }).withMetadata({ exif: { IFD0: { Artist: 'LENZ_TEST_METADATA' } } }).png().toBuffer();
      assert(file.includes(Buffer.from('LENZ_TEST_METADATA')));
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' }); const requests = []; const track = req => requests.push(req.url()); a.on('request', track);
      await a.locator('#profile-photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: file });
      await a.waitForFunction(() => document.querySelector('#profile-feedback').textContent.includes('Photo ready'));
      await a.locator('#save-profile').click(); await status(a, 'Profile saved'); a.off('request', track);
      assert(requests.every(url => url.startsWith('blob:')), `Unexpected network request: ${requests.join(', ')}`); photoProfile = await profile(a);
      const encoded = Buffer.from(photoProfile.photo.split(',')[1], 'base64'), info = await sharp(encoded).metadata();
      assert.equal(info.width, 128); assert.equal(info.height, 128); assert(!info.exif); assert(!encoded.includes(Buffer.from('LENZ_TEST_METADATA')));
      assert.deepEqual(await snapshot(a), before);
    });
    await check('contact file carries the photo and an existing contact update requires confirmation', async () => {
      await a.locator('#show-card').click(); assert(await a.locator('#photo-sharing-note').isVisible());
      await a.locator('#share-contact details').evaluate(n=>n.open=true); const pending = a.waitForEvent('download'); await a.locator('#save-card').click();
      assert.deepEqual(JSON.parse(await readFile(await (await pending).path(), 'utf8')), photoProfile);
      const qr = await a.evaluate(async p => (await import('/contact-card.js')).decodeContact(await (await import('/contact-card.js')).encodeContact(p)), photoProfile);
      assert.equal(qr.id, original.id); assert.equal(qr.avatar, 'wave'); assert(!qr.photo);
      await a.locator('[data-close="share-contact"]').click(); await importCard(b, photoProfile, false);
      assert.equal(await b.locator('#confirm-contact').innerText(), 'Update contact');
      assert.equal(await b.locator('#conversation-name').innerText(), original.name);
      await b.locator('#verified').check(); await b.locator('#confirm-contact').click(); await status(b, 'ready for a conversation');
      assert.equal(await b.locator('#contact-list button').count(), 1); assert.equal(await b.locator('#conversation-name').innerText(), 'River Wren');
      assert.equal(await b.locator('#conversation-avatar img').getAttribute('src'), photoProfile.photo);
    });
    await check('invalid photos fail visibly without changing the saved profile', async () => {
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' });
      await a.locator('#profile-photo').setInputFiles({ name: 'remote.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
      await a.waitForFunction(() => document.querySelector('#profile-feedback').textContent.includes('Choose a JPG'));
      assert.deepEqual(await profile(a), photoProfile); assert(await a.locator('#save-profile').isEnabled()); await a.locator('[data-close="edit-profile"]').click();
    });
    await check('failed storage commit leaves the original name and complete saved state intact', async () => {
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' }); await a.locator('#profile-name').fill('Not saved');
      await a.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { this.transaction.abort(); throw new Error('Injected profile save failure'); }; });
      await a.locator('#save-profile').click(); await status(a, 'Injected profile save failure');
      assert((await a.locator('#profile-feedback').innerText()).includes('Injected profile save failure'));
      assert.deepEqual(await snapshot(a), before); assert.deepEqual(await profile(a), photoProfile);
      await a.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; }); await a.keyboard.press('Escape');
    });
    await check('offline reload retains the photo, messages and balance; profile editing works offline', async () => {
      await a.locator('#prepare-offline').click(); await status(a, 'Conversation files saved'); await ca.setOffline(true);
      await a.reload(); await status(a, 'Private chat is ready'); assert.deepEqual(await profile(a), photoProfile); assert.deepEqual(await snapshot(a), before);
      await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' }); await a.locator('#remove-photo').click(); await a.locator('#save-profile').click(); await status(a, 'Profile saved');
      assert(!(await profile(a)).photo); assert.equal((await profile(a)).avatar, 'wave'); assert.deepEqual(await snapshot(a), before);
    });
    await check('profile editor fits narrow and desktop screens with visible labelled controls', async () => {
      for (const [name, width, height] of [['desktop', 1280, 900], ['narrow', 375, 812]]) {
        await a.setViewportSize({ width, height });
        if (width < 761) await a.locator('#back-people').click();
        await a.locator('#show-profile').click(); await a.locator('#edit-profile').waitFor({ state: 'visible' });
        await a.locator('#edit-profile').waitFor({ state: 'visible' });
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await a.locator('#edit-profile').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        assert(await a.getByLabel('Display name', { exact: true }).isVisible());
        await a.screenshot({ path: path.join(__dirname, `evidence/profile-${name}.png`) }); await a.keyboard.press('Escape');
      }
    });
    assert.deepEqual(errors, []);
    await writeFile(path.join(__dirname, 'profile-browser-results.json'), JSON.stringify({ browser: await browser.version(), passed: checks.length, failed: 0, checks, scope: 'Isolated Windows Edge contexts; offline emulation. No phone or physical camera test.' }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
