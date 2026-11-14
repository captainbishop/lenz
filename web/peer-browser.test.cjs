// Runs only against this project's local page, in fresh isolated browser contexts.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const evidence = path.join(__dirname, 'evidence');
const checks = [];
const appErrors = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true'); }
async function status(page, text) {
  await page.waitForFunction(text => document.querySelector('#status').textContent.includes(text), text);
  await idle(page);
}
async function create(page, name) {
  await page.goto('http://127.0.0.1:4173/chat.html');
  await status(page, 'Private chat is ready');
  await page.locator('#device-profile > summary').click();await page.locator('#name').fill(name); await page.locator('#identity-form button[type=submit]').click();
  await status(page, 'Identity saved');
  return JSON.parse(await page.locator('#my-card').inputValue());
}
async function add(page, profile) {
  await page.locator('#show-add-contact').click();
  await page.locator('#contact-advanced > summary').click();
  await page.locator('#contact-card').fill(JSON.stringify(profile)); await page.locator('#review-contact').click();
  await page.locator('#contact-review').waitFor({ state: 'visible' }); await idle(page);
  assert.equal((await page.locator('#contact-code').textContent()).replaceAll(' ', ''), profile.id);
  assert(await page.locator('#confirm-contact').isDisabled());
  await page.locator('#verified').check(); await page.locator('#confirm-contact').click();
  await status(page, 'ready for a conversation');
}
async function send(page, text) {
  await page.locator('#message').fill(text); await page.locator('#prepare-message').click();
  await status(page, 'Message saved. Choose how to share it.');
  return JSON.parse(await page.locator('#outgoing').inputValue());
}
async function receive(page, packet, file = false) {
  await page.locator('#handover').evaluate(node => { if (!node.open) node.showModal(); });
  if (file) {
    await page.locator('#incoming-file').setInputFiles({ name: 'message.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) });
    await status(page, 'File loaded');
  } else { await page.locator('#message-details').evaluate(node => { node.open = true; }); await page.locator('#incoming').fill(JSON.stringify(packet)); }
  await page.locator('#open-message').click();
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PEER_BROWSER_CHANNEL ?? 'msedge' });
  try {
    await mkdir(evidence, { recursive: true });
    const ca = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const cb = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) page.on('pageerror', error => appErrors.push(error.message));
    let pa, pb, first, qrImage;
    await check('separate browser contexts create independent persisted identities', async () => {
      pa = await create(a, 'Amina'); pb = await create(b, 'Bola'); assert.notEqual(pa.id, pb.id);
    });
    await check('names and avatars replace raw identifiers in the default interface', async () => {
      assert.equal(await a.locator('#my-name').innerText(), 'Amina');
      assert.equal(await a.locator('#my-avatar img').count(), 1);
      assert(!await a.locator('#my-code').isVisible()); assert(!await a.locator('#my-card').isVisible());
      assert(!(await a.locator('body').innerText()).includes(pa.id));
    });
    await check('a real downloaded QR card adds a contact without entering a key', async () => {
      await b.locator('#show-card').click();
      assert(await b.locator('#contact-qr').isVisible()); assert(!await b.locator('#my-code').isVisible());
      const pending = b.waitForEvent('download'); await b.locator('#save-qr').click();
      const download = await pending; qrImage = await readFile(await download.path());
      await b.locator('[data-close="share-contact"]').click();
      await a.locator('#show-add-contact').click();
      await a.locator('#contact-file').setInputFiles({ name: 'contact-card.png', mimeType: 'image/png', buffer: qrImage });
      await a.locator('#contact-review').waitFor({ state: 'visible' }); await idle(a);
      assert.equal(await a.locator('#contact-name').innerText(), pb.name);
      assert.equal((await a.locator('#contact-code').textContent()).replaceAll(' ', ''), pb.id);
      assert(!await a.locator('#contact-code').isVisible()); assert(await a.locator('#confirm-contact').isDisabled());
      await a.locator('#verified').check(); await a.locator('#confirm-contact').click(); await status(a, 'ready for a conversation');
    });
    await check('legacy contact cards still import with explicit source confirmation', async () => { await add(b, pa); });
    await check('camera denial gives an image/file fallback without changing identity', async () => {
      await a.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
      await a.locator('#show-add-contact').click(); await a.locator('#scan-contact').click();
      await a.waitForFunction(() => document.querySelector('#contact-feedback').textContent.includes('permission declined'));
      assert(await a.locator('label[for="contact-file"]').isVisible()); assert(!await a.locator('#camera-panel').isVisible());
      await a.locator('[data-close="add-contact"]').click();
      assert.equal(JSON.parse(await a.locator('#my-card').inputValue()).id, pa.id);
    });
    await check('closing while camera permission is pending stops a late stream', async () => {
      await a.evaluate(() => { window.trackStopped = false; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.cameraResolve = () => resolve({ getTracks: () => [{ stop: () => { window.trackStopped = true; } }] }); }); });
      await a.locator('#show-add-contact').click(); await a.locator('#scan-contact').click();
      await a.locator('[data-close="add-contact"]').click();
      await a.evaluate(() => window.cameraResolve()); await a.waitForFunction(() => window.trackStopped);
    });
    await check('a tampered contact file is rejected and cannot enable Add contact', async () => {
      await a.locator('#show-add-contact').click();
      await a.locator('#contact-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...pb, id: pa.id })) });
      await a.waitForFunction(() => document.querySelector('#contact-feedback').textContent.includes('does not match'));
      assert(await a.locator('#confirm-contact').isDisabled()); assert(!await a.locator('#contact-review').isVisible());
      await a.locator('[data-close="add-contact"]').click();
    });
    await check('encrypted chat crosses isolated stores by file, with safe text rendering', async () => {
      const text = 'Bola, ready to trade? ₦42 <img src=x onerror=alert(1)>';
      first = await send(a, text); assert(!JSON.stringify(first).includes(text));
      await receive(b, first, true); await status(b, 'Message opened');
      assert((await b.locator('.bubble').innerText()).includes(text)); assert.equal(await b.locator('.bubble img').count(), 0);
    });
    await check('duplicate delivery adds no second message', async () => {
      await receive(b, first); await status(b, 'already opened'); assert.equal(await b.locator('.bubble').count(), 1);
    });
    await check('reordered JSON fields remain the same authenticated message', async () => {
      await receive(b, Object.fromEntries(Object.entries(first).reverse())); await status(b, 'already opened'); assert.equal(await b.locator('.bubble').count(), 1);
    });
    await check('tampered ciphertext is rejected without changing message history', async () => {
      const bad = { ...first, ciphertext: (first.ciphertext[0] === '0' ? '1' : '0') + first.ciphertext.slice(1) };
      await receive(b, bad); await status(b, 'signature was rejected'); assert.equal(await b.locator('.bubble').count(), 1);
    });
    await check('message content is stored as ciphertext and private keys remain nonextractable', async () => {
      const stored = await a.evaluate(async () => {
        const { readState } = await import('/chat-store.js'); const s = await readState();
        return { text: JSON.stringify(s.messages), extractable: [s.identity.signingPrivate.extractable, s.identity.boxPrivate.extractable] };
      });
      assert(!stored.text.includes('ready to trade')); assert.deepEqual(stored.extractable, [false, false]);
    });
    await check('the chat-only service worker caches and controls both pages', async () => {
      for (const page of [a, b]) {
        if (await page.locator('#handover').isVisible()) await page.locator('[data-close="handover"]').click();
        await page.locator('#prepare-offline').click(); await status(page, 'Conversation files saved');
        await page.reload(); await status(page, 'Private chat is ready');
        assert((await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).endsWith('/chat-sw.js'));
      }
    });
    await ca.setOffline(true); await cb.setOffline(true);
    await check('uncached server requests fail in both browser contexts', async () => {
      for (const page of [a, b]) assert(await page.evaluate(async () => { try { await fetch('/network-probe-' + Date.now(), { cache: 'no-store' }); return false; } catch { return true; } }));
    });
    await check('offline reload retains separate keys and decrypts saved conversations', async () => {
      for (const page of [a, b]) { await page.reload(); await status(page, 'Private chat is ready'); assert.equal(await page.locator('.bubble').count(), 1); }
      assert.equal(JSON.parse(await a.locator('#my-card').inputValue()).id, pa.id);
      assert.equal(JSON.parse(await b.locator('#my-card').inputValue()).id, pb.id);
    });
    await check('QR decoding and contact matching work after an offline reload', async () => {
      await a.locator('#show-add-contact').click();
      await a.locator('#contact-file').setInputFiles({ name: 'contact-card.png', mimeType: 'image/png', buffer: qrImage });
      await a.waitForFunction(() => document.querySelector('#contact-feedback').textContent.includes('already in your contacts'));
      await idle(a); await a.locator('[data-close="add-contact"]').click();
    });
    await check('an earlier outgoing packet can be saved again after offline reload', async () => {
      const pending = a.waitForEvent('download'); await a.locator('.bubble.outgoing button').click();
      const file = await pending; assert(file.suggestedFilename().includes(first.id)); assert.equal(await file.failure(), null);
    });
    await check('a reply can be created and opened while both browser contexts are offline', async () => {
      const reply = await send(b, 'Yes. Let’s agree the amount privately.');
      await receive(a, reply); await status(a, 'Message opened'); assert.equal(await a.locator('.bubble').count(), 2);
    });
    await check('the actual exchange scenario executes in the offline browser', async () => {
      const report = await a.evaluate(async () => (await import('/peer-scenario.js')).runExchangeScenario());
      assert(report.balances.some(row => row.person === 'Chidi' && row.value === '6' && row.asset === 'DEMO-COIN'));
      assert.equal(await a.locator('#run-exchange').count(), 0);
    });
    await check('saved message file contains the encrypted packet', async () => {
      const downloadPromise = b.waitForEvent('download'); await b.locator('#save-message').click();
      const download = await downloadPromise; assert(download.suggestedFilename().startsWith('proof-u-message-'));
      assert.equal(await download.failure(), null);
    });
    await a.locator('#handover').evaluate(node => node.close());
    await check('desktop, narrow and landscape layouts have no horizontal overflow', async () => {
      for (const [label, width, height] of [['desktop', 1280, 900], ['narrow', 375, 812], ['landscape', 812, 375]]) {
        await a.setViewportSize({ width, height });
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
        await a.screenshot({ path: path.join(evidence, `private-chat-${label}.png`), fullPage: true });
        if (width <= 760) await a.locator('#back-people').click();
        await a.locator('#show-card').click();
        assert(await a.locator('#share-contact').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), `Card overflow at ${width}`);
        await a.screenshot({ path: path.join(evidence, `contact-card-${label}.png`) });
        await a.locator('[data-close="share-contact"]').click();
      }
    });
    await check('no unhandled browser errors', async () => { assert.deepEqual(appErrors, []); });
    const report = { browser: await browser.version(), platform: process.platform, separateContexts: 2, networkCondition: 'Playwright offline emulation after cache preparation; uncached requests rejected in both contexts', checks, passed: checks.length, failed: 0, scope: 'Windows desktop Chromium only; manual packet handover, no physical phones or BLE.' };
    await writeFile(path.join(__dirname, 'peer-browser-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
