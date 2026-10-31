const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const base = 'http://127.0.0.1:4173';
const checks = [], errors = [];
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true'); }
async function status(page, text) { await page.waitForFunction(t => document.querySelector('#status').textContent.includes(t), text); await idle(page); }
async function create(page, name) {
  await page.goto(base + '/money.html'); await status(page, 'Your wallet is ready');
  await page.locator('#wallet-name').fill(name); await page.locator('#wallet-identity-form button[type=submit]').click(); await status(page, 'Profile saved');
  await page.locator('#wallet-mode').click();
  await page.locator('#wallet-enable-demo').click(); await status(page, 'Demo money is ready');
  return JSON.parse(await page.locator('#my-card').inputValue());
}
async function add(page, profile) {
  await page.locator('#show-add-contact').click();
  await page.locator('#contact-file').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
  await page.locator('#contact-review').waitFor({ state: 'visible' }); await idle(page);
  await page.locator('#verified').check(); await page.locator('#confirm-contact').click(); await status(page, 'ready for a conversation');
}
async function send(page, recipient, amount) {
  await page.locator('#wallet-send').click(); await page.locator('#wallet-recipient').selectOption(recipient.id);
  await page.locator('#wallet-amount').fill(amount); await page.locator('#wallet-send-form button[type=submit]').click(); await status(page, 'Payment prepared');
  const pending = page.waitForEvent('download'); await page.locator('#wallet-save-payment').click();
  const packet = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  await page.locator('[data-close="wallet-handover"]').click(); return packet;
}
async function load(page, packet) {
  await page.locator('#wallet-open-file').click();
  await page.locator('#wallet-incoming').setInputFiles({ name: 'payment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) });
  await page.waitForFunction(() => !document.querySelector('#wallet-import').disabled); await idle(page); await page.locator('#wallet-import').click();
}
async function balance(page) { return page.locator('[data-asset="DEMO-USD"] strong').innerText(); }
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext({ viewport: { width: 1280, height: 900 } })));
    const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
    for (const p of [a, b, c]) p.on('pageerror', e => errors.push(e.message));
    const pa = await create(a, 'Amina'), pb = await create(b, 'Bola'), pc = await create(c, 'Chidi');
    await check('wallet profiles and recipient cards work without opening Conversations', async () => {
      await add(a, pb); await add(b, pa); await add(b, pc); await add(c, pb);
      for (const p of [a, b, c]) assert.equal(new URL(p.url()).pathname, '/money.html');
      await c.locator('#wallet-receive').click(); await c.locator('#wallet-share-receive').click();
      assert(await c.locator('#contact-qr').isVisible()); await c.locator('[data-close="share-contact"]').click();
    });
    await check('wallets reload offline with the complete account and payment modules cached', async () => {
      for (const p of [a, b, c]) { await p.locator('#prepare-money-offline').click(); await status(p, 'files saved for offline'); await p.context().setOffline(true); await p.reload(); await status(p, 'Your wallet is ready'); await p.locator('#wallet-mode').click(); }
    });
    let first, second;
    await check('a standalone payment changes both balances after encrypted file handover', async () => {
      first = await send(a, pb, '20'); assert.equal(await balance(a), '80'); assert.equal(await balance(b), '100');
      await load(b, first); await status(b, 'Payment checked and saved'); assert.equal(await balance(b), '120');
    });
    await check('the recipient can pass received value onward from the wallet while offline', async () => {
      second = await send(b, pc, '8'); assert.equal(await balance(b), '112');
      const ancestors = await b.evaluate(async () => {
        const state = await (await import('/chat-store.js')).readState(), record = state.messages.at(-1);
        const peer = state.contacts.find(p => p.id === record.packet.to);
        return (await (await import('/peer-crypto.js')).openMessage(state.identity, peer, record.packet)).parents.length;
      }); assert.equal(ancestors, 1);
      await load(c, second); await status(c, 'Payment checked and saved'); assert.equal(await balance(c), '108');
    });
    await check('duplicate or altered payment files cannot increase the received balance', async () => {
      await load(c, second); await status(c, 'already opened'); assert.equal(await balance(c), '108');
      const bad = { ...second, signature: '0'.repeat(128) }; await load(c, bad); await status(c, 'signature was rejected');
      assert.equal(await balance(c), '108'); await c.locator('[data-close="wallet-receive-dialog"]').click();
    });
    await check('failed payment save leaves no new outgoing file or reduced balance', async () => {
      await a.evaluate(() => { window.savedPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { this.transaction.abort(); throw new Error('Wallet commit failed'); }; });
      await a.locator('#wallet-send').click(); await a.locator('#wallet-recipient').selectOption(pb.id); await a.locator('#wallet-amount').fill('5');
      await a.locator('#wallet-send-form button[type=submit]').click(); await status(a, 'Wallet commit failed');
      assert.equal(await balance(a), '80'); assert(!await a.locator('#wallet-handover').isVisible());
      await a.evaluate(() => { IDBObjectStore.prototype.put = window.savedPut; }); await a.locator('[data-close="wallet-send-dialog"]').click();
    });
    await check('chat reads the same identity and balances after wallet use without a reset', async () => {
      await a.goto(base + '/chat.html'); await status(a, 'Private chat is ready');
      assert.equal(JSON.parse(await a.locator('#my-card').inputValue()).id, pa.id);
      assert.equal(await balance(a), '80'); assert((await a.locator('.bubble').innerText()).includes('20 demo dollars'));
      await a.goto(base + '/money.html'); await status(a, 'Your wallet is ready');
      await a.locator('#wallet-mode').click();
    });
    await check('wallet layouts fit desktop and narrow screens with Send and Receive visible', async () => {
      for (const [name, width, height] of [['desktop', 1280, 900], ['narrow', 375, 812]]) {
        await a.setViewportSize({ width, height }); assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await a.locator('#wallet-send').isVisible()); assert(await a.locator('#wallet-receive').isVisible());
        await a.screenshot({ path: path.join(__dirname, `evidence/wallet-${name}.png`), fullPage: true });
      }
    });
    assert.deepEqual(errors, []);
    await writeFile(path.join(__dirname, 'money-browser-results.json'), JSON.stringify({ browser: await browser.version(), passed: checks.length, failed: 0, checks, scope: 'Three isolated Windows Edge contexts with offline emulation; synthetic money, no settlement.' }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
