const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const checks = [], errors = [];
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true'); }
async function status(page, text) { await page.waitForFunction(t => document.querySelector('#status').textContent.includes(t), text); await idle(page); }
async function create(page, name) {
  await page.goto('http://127.0.0.1:4173/chat.html'); await status(page, 'Private chat is ready');
  await page.locator('#name').fill(name); await page.locator('#identity-form button[type=submit]').click(); await status(page, 'Identity saved');
  return JSON.parse(await page.locator('#my-card').inputValue());
}
async function add(page, profile) {
  await page.locator('#show-add-contact').click(); await page.locator('#contact-advanced > summary').click();
  await page.locator('#contact-card').fill(JSON.stringify(profile)); await page.locator('#review-contact').click();
  await page.locator('#contact-review').waitFor({ state: 'visible' }); await idle(page);
  await page.locator('#verified').check(); await page.locator('#confirm-contact').click(); await status(page, 'ready for a conversation');
}
async function downloadLatest(page) {
  if (await page.locator('#handover').isVisible()) await page.locator('#handover').evaluate(n => n.close());
  const pending = page.waitForEvent('download'); await page.locator('.financial > button').last().click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
async function receive(page, packet) {
  await page.locator('#handover').evaluate(n => { if (!n.open) n.showModal(); });
  await page.locator('#incoming-file').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) });
  await status(page, 'File loaded'); await page.locator('#open-message').click(); await status(page, 'Message opened');
}
async function fill(page, mode, amount, asset = 'DEMO-USD') {
  if (!await page.locator('#chat-earlier').evaluate(n => n.open)) await page.locator('#chat-earlier > summary').click();
  await page.locator(mode === 'swap' ? '#offer-trade' : '#send-money').click(); await idle(page);
  await page.locator('#trade-give').fill(amount); await page.locator('#trade-give-asset').selectOption(asset);
  if (mode === 'swap') await page.locator('#trade-get').fill('10');
}
async function balance(page, asset) { if (!await page.locator("#chat-earlier").evaluate(n => n.open)) await page.locator("#chat-earlier > summary").click(); return page.locator(`.balance-row[data-asset="${asset}"] strong`).innerText(); }
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1280, height: 960 } })));
    const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [a, b, c]) page.on('pageerror', e => errors.push(e.message));
    let pa, pb, pc, offer, reply, payment;
    await check('three independent identities exchange contacts without resetting existing keys', async () => {
      [pa, pb, pc] = await Promise.all([create(a, 'Amina'), create(b, 'Bola'), create(c, 'Chidi')]);
      await add(a, pb); await add(a, pc); await add(b, pa); await add(c, pa);
      await a.locator('#contact-list button').filter({ hasText: 'Bola' }).click(); await idle(a);
    });
    await check('all three pages reload offline before any money is created', async () => {
      for (const page of [a, b, c]) { await page.locator('#prepare-offline').click(); await status(page, 'Conversation files saved'); }
      await Promise.all(contexts.map(context => context.setOffline(true)));
      for (const page of [a, b, c]) {
        await page.reload(); await status(page, 'Private chat is ready');
        assert(await page.evaluate(async () => { try { await fetch('/offline-probe-' + Date.now()); return false; } catch { return true; } }));
        await page.locator('#chat-earlier > summary').click(); await page.locator('#enable-demo').click(); await status(page, 'Demo money is ready');
        assert.equal(await balance(page, 'DEMO-USD'), '100');
      }
    });
    await check('an offer holds the source balance and shows exact signed amounts', async () => {
      await fill(a, 'swap', '20'); await a.locator('#trade-submit').click(); await status(a, 'Offer saved');
      assert.equal(await balance(a, 'DEMO-USD'), '0');
      assert((await a.locator('#money-balances').innerText()).includes('100 held for an offer'));
      assert((await a.locator('.trade-card').innerText()).includes('20 demo dollars'));
      assert((await a.locator('.trade-card').innerText()).includes('10 demo coins'));
      offer = await downloadLatest(a);
      await a.reload(); await status(a, 'Private chat is ready');
      assert.deepEqual(await downloadLatest(a), offer);
    });
    await check('recipient reviews the inverse amounts before agreeing', async () => {
      await receive(b, offer);
      assert.equal(await balance(b, 'DEMO-COIN'), '50');
      await b.locator('.review-offer').click(); await idle(b);
      const review = await b.locator('#trade-review-card').innerText();
      assert.match(review, /You give\s+10 demo coins/); assert.match(review, /You get\s+20 demo dollars/);
      await mkdir(path.join(__dirname, 'evidence'), { recursive: true });
      await b.screenshot({ path: path.join(__dirname, 'evidence/trade-review.png') });
      await b.locator('#agree-trade').click(); await status(b, 'Trade agreed locally');
      assert.equal(await balance(b, 'DEMO-USD'), '120'); assert.equal(await balance(b, 'DEMO-COIN'), '40');
      reply = await downloadLatest(b);
    });
    await check('reply updates the original offer and releases change after reload', async () => {
      await receive(a, reply); assert.equal(await balance(a, 'DEMO-USD'), '80'); assert.equal(await balance(a, 'DEMO-COIN'), '60');
      assert((await a.locator('.trade-card').first().innerText()).includes('Agreed locally'));
      await a.reload(); await status(a, 'Private chat is ready'); assert.equal(await balance(a, 'DEMO-USD'), '80');
      assert.equal(JSON.parse(await a.locator('#my-card').inputValue()).id, pa.id);
    });
    await check('received value is sent onward to a third offline browser through the UI', async () => {
      await a.locator('#contact-list button').filter({ hasText: 'Chidi' }).click(); await idle(a);
      await fill(a, 'payment', '6', 'DEMO-COIN'); await a.locator('#trade-submit').click(); await status(a, 'Payment saved');
      payment = await downloadLatest(a); await receive(c, payment);
      assert.equal(await balance(a, 'DEMO-COIN'), '54'); assert.equal(await balance(c, 'DEMO-COIN'), '56');
      assert((await c.locator('.trade-card').innerText()).includes('Received locally · ready to pass on'));
      const ancestry = await c.evaluate(async packet => {
        const { readState } = await import('/chat-store.js'); const { openMessage } = await import('/peer-crypto.js');
        const s = await readState(); const p = await openMessage(s.identity, s.contacts[0], packet);
        return { parents: p.parents.length, input: p.agreement.body.inputs[0], parent: p.parents[0].id };
      }, payment);
      assert.equal(ancestry.parents, 1); assert.equal(ancestry.input, ancestry.parent + ':0');
    });
    await check('repeat delivery cannot credit an onward payment twice', async () => {
      await c.locator('#receive-message').click();
      await c.locator('#incoming-file').setInputFiles({ name: 'repeat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payment)) });
      await status(c, 'File loaded'); await c.locator('#open-message').click(); await status(c, 'already opened');
      assert.equal(await balance(c, 'DEMO-COIN'), '56'); assert.equal(await c.locator('.trade-card').count(), 1);
    });
    await check('trade histories and reservations are encrypted at rest', async () => {
      const saved = await a.evaluate(async () => {
        const { readState } = await import('/chat-store.js'); const s = await readState();
        return { text: JSON.stringify(s), keyExtractable: s.tradeKey.extractable };
      });
      for (const field of ['"journal"', '"roots"', '"trade-offer"', '"trade-payment"']) assert(!saved.text.includes(field));
      assert.equal(saved.keyExtractable, false);
    });
    await check('trade and payment cards fit desktop and narrow layouts without clipping', async () => {
      await a.locator('#contact-list button').filter({ hasText: 'Bola' }).click(); await idle(a);
      await a.locator('#handover').evaluate(n => n.close());
      for (const [name, width, height] of [['desktop', 1280, 960], ['narrow', 375, 812]]) {
        await a.setViewportSize({ width, height });
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const card of await a.locator('.bubble.financial').all()) assert(await card.evaluate(n => n.scrollHeight <= n.clientHeight + 1), 'Financial card was clipped by flex shrink');
        await a.screenshot({ path: path.join(__dirname, `evidence/trade-${name}.png`), fullPage: true });
      }
      await a.setViewportSize({ width: 1280, height: 960 });
    });
    await check('phone navigation returns to people, filters names and reopens the chosen thread', async () => {
      await a.setViewportSize({ width: 375, height: 812 });
      await a.locator('#back-people').click(); assert(await a.locator('.contacts').isVisible());
      await a.locator('#contact-search').fill('chid'); await idle(a);
      assert.equal(await a.locator('#contact-list button').count(), 1);
      await a.locator('#contact-list button').click(); await idle(a);
      assert.equal(await a.locator('#conversation-name').innerText(), 'Chidi');
      assert(!await a.locator('.contacts').isVisible());
      await a.locator('#back-people').click(); await a.locator('#contact-search').fill(''); await idle(a);
      await a.locator('#contact-list button').filter({ hasText: 'Bola' }).click(); await idle(a);
      await a.setViewportSize({ width: 1280, height: 960 });
    });
    await check('a failed state commit exposes no payment and leaves balances and locks intact', async () => {
      const before = await a.evaluate(async () => JSON.stringify(await (await import('/chat-store.js')).readState()));
      const handoverBefore = await a.locator('#outgoing').inputValue();
      await a.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { this.transaction.abort(); throw new Error('Injected state commit failure'); }; });
      await fill(a, 'payment', '5'); await a.locator('#trade-submit').click(); await status(a, 'Injected state commit failure');
      assert.equal(await a.locator('#outgoing').inputValue(), handoverBefore);
      await a.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
      const after = await a.evaluate(async () => JSON.stringify(await (await import('/chat-store.js')).readState())); assert.equal(after, before);
      await a.locator('[data-close="trade-dialog"]').click();
    });
    await check('simultaneous payment forms in two tabs cannot reuse the same balance', async () => {
      const second = await contexts[0].newPage(); await second.goto('http://127.0.0.1:4173/chat.html'); await status(second, 'Private chat is ready');
      await Promise.all([fill(a, 'payment', '60'), fill(second, 'payment', '60')]);
      await Promise.all([a.locator('#trade-submit').click(), second.locator('#trade-submit').click()]);
      await Promise.all([idle(a), idle(second)]);
      const messages = await Promise.all([a.locator('#status').innerText(), second.locator('#status').innerText()]);
      assert.equal(messages.filter(t => t.includes('Payment saved')).length, 1);
      assert.equal(messages.filter(t => t.includes('unavailable')).length, 1);
      await second.close();
    });
    await check('no unhandled browser errors during the complete flow', async () => assert.deepEqual(errors, []));
    await writeFile(path.join(__dirname, 'trade-browser-results.json'), JSON.stringify({ browser: await browser.version(), passed: checks.length, failed: 0, checks, scope: 'Three isolated Windows Edge contexts, offline network emulation, real file handover and synthetic assets. No chain or physical-device test.' }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
