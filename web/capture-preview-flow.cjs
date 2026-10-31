// A bounded recording run using the existing isolated, funded testnet profiles.
// --inspect is read-only. --capture moves ONE existing tUSD A → B → C.
// Never funds, deploys, restores a profile or retries an ambiguous submission.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:4173';
const privateRoot = path.join(root, 'contracts/.testnet/offline-social-live-2026-10-31');
const checkpoint = path.join(privateRoot, 'preview-capture.json');
const output = path.join(__dirname, 'evidence/preview-capture');
const hash = b => createHash('sha256').update(b).digest('hex');
const idle = p => p.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true', null, { timeout: 120000 });
async function go(p, view) { await p.goto(base + '/' + view + '.html'); await p.waitForFunction(() => /is ready/.test(document.querySelector('#status').textContent)); await idle(p); }
async function read(p, contract) { return p.evaluate(async contract => {
  const s = await (await import('/chat-store.js')).readState();
  const n = await import('/near-protocol.js'), v = await n.readNearVault(s, contract), l = await n.nearLedger(v);
  return { profile: s.identity.profile, vault: v, notes: l.available.filter(x => x.owner === n.compressed(s.identity.profile.signingPublic)) };
}, contract); }
async function receive(p, packet) {
  const present = await p.evaluate(async id => (await (await import('/chat-store.js')).readState()).messages.some(x => x.packet.id === id), packet.id);
  if (present) return;
  await p.locator('#receive-message').click();
  await p.locator('#incoming-file').setInputFiles({ name: 'lenz-message.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) });
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('File loaded')); await idle(p);
  await p.locator('#open-message').click(); await idle(p);
  await p.locator('#handover').waitFor({ state: 'hidden' });
}
const frameCSS = `
  .topbar,.contacts,.composer,#status,#back-people {display:none!important}
  .chat-shell {padding:0!important;height:auto!important;max-width:none!important}
  .workspace {display:block!important;border:0!important;box-shadow:none!important;border-radius:0!important}
  .conversation {display:flex!important;width:520px!important;height:350px!important;border:0!important;border-radius:0!important;padding:0!important}
  .conversation-top {padding:22px!important} .conversation-top h2 {font-size:22px!important}
  .messages {padding:24px!important;overflow:hidden!important;justify-content:center!important}
  #messages>:not(:last-child) {display:none!important} #messages>* {max-width:100%!important;width:100%!important}
  #messages .near-chat-card {width:100%!important} #messages p {font-size:17px!important}
  #messages .message-meta {font-size:12px!important}
`;
(async () => {
  const { view, provider, finalReceipt } = await import('../contracts/client.mjs');
  const { digest } = await import('./public/peer-crypto.js');
  const { transferTerms } = await import('./public/near-protocol.js');
  const previous = JSON.parse(await fs.readFile(path.join(__dirname, 'offline-social-live-results.json')));
  const config = JSON.parse(await fs.readFile(path.join(__dirname, 'public/near-config.json')));
  assert.equal(config.contract, previous.reserve); assert.equal(config.network, 'testnet');
  let ev; try { ev = JSON.parse(await fs.readFile(checkpoint)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (ev?.complete && process.argv.includes('--capture')) { console.log('Capture is complete; render saved frames without repeating transfers.'); return; }
  const contexts = [], pages = [], sourceFiles = new Set(['web/capture-preview-flow.cjs']), api = [];
  const save = () => fs.writeFile(checkpoint, JSON.stringify(ev, null, 2) + '\n');
  try {
    for (const role of ['a', 'b', 'c']) {
      const ctx = await chromium.launchPersistentContext(path.join(privateRoot, role), { channel: 'msedge', headless: true, viewport: { width: 900, height: 760 }, reducedMotion: 'reduce' });
      contexts.push(ctx); const p = ctx.pages()[0] || await ctx.newPage(); pages.push(p);
      await p.route('**/api/**', async route => {
        const name = new URL(route.request().url()).pathname; api.push(name);
        if (!['/api/testnet/check', '/api/testnet/settle'].includes(name) || (!process.argv.includes('--capture') && name.endsWith('/settle'))) { await route.abort(); throw Error('Unexpected API action: ' + name); }
        await route.continue();
      });
      ctx.on('request', r => { const u = new URL(r.url()); if (u.origin === base && /\.(js|css|html|json)$/.test(u.pathname)) sourceFiles.add('web/public' + u.pathname); });
      await go(p, 'money'); const s = await read(p, config.contract);
      assert.equal(s.profile.id, previous.profiles[role].id, 'Existing isolated profile must match');
      if (!ev) for (const note of s.notes) {
        assert.deepEqual(await view(config.contract, 'get_note', { id: note.id }), note);
        assert.equal(await view(config.contract, 'spent_by', { id: note.id }), null);
      }
      console.log(`${role}: ${s.notes.reduce((v,n) => v + BigInt(n.amount), 0n)} base units; existing identity verified`);
    }
    if (!process.argv.includes('--capture')) { console.log('Read-only preflight complete. No payment or funding submitted.'); return; }
    ev ??= { startedAt: new Date().toISOString(), reserve: config.contract, captures: {}, packets: {}, checks: [], api: [] };
    await fs.mkdir(output, { recursive: true }); await save();
    const [a, b, c] = pages;
    async function shot(p, name) {
      if (ev.captures[name]) return;
      const style = await p.addStyleTag({ content: frameCSS });
      ev.captures[name] = {};
      for (const theme of ['light', 'dark']) {
        await p.evaluate(t => document.documentElement.dataset.theme = t, theme);
        const file = `web/evidence/preview-capture/${name}-${theme}.png`;
        const data = await p.locator('.conversation').screenshot(); await fs.writeFile(path.join(root, file), data);
        ev.captures[name][theme] = { file, sha256: hash(data) };
      }
      await style.evaluate(s => s.remove()); await save();
    }
    for (const p of pages) {
      await p.evaluate(async () => (await import('/save-offline.js')).saveOffline());
      await p.context().setOffline(true); await go(p, 'chat');
      assert(await p.evaluate(async () => { if (navigator.onLine) return false; try { await fetch('/preview-uncached-probe'); return false; } catch { return true; } }));
    }
    const before = api.length;
    await a.locator('#contact-list button').filter({ hasText: previous.profiles.b.name }).click(); await idle(a);
    if (!ev.packets.message) {
      await a.locator('#message').fill('Meet by the bookshop. I can pay you offline.');
      await a.locator('#prepare-message').click(); await idle(a);
      ev.packets.message = JSON.parse(await a.locator('#outgoing').inputValue()); await save();
      await a.locator('[data-close="handover"]').click();
    }
    assert(!JSON.stringify(ev.packets.message).includes('Meet by the bookshop'));
    await shot(a, 'private-send');
    const rejected = await c.evaluate(async ({ packet, sender }) => {
      const s = await (await import('/chat-store.js')).readState();
      try { await (await import('/peer-crypto.js')).openMessage(s.identity, sender, packet); return false; }
      catch (e) { return e.message.includes('different conversation'); }
    }, { packet: ev.packets.message, sender: previous.profiles.a }); assert(rejected);
    await receive(b, ev.packets.message);
    await b.locator('#contact-list button').filter({ hasText: previous.profiles.a.name }).click(); await idle(b);
    assert((await b.locator('#messages').innerText()).includes('Meet by the bookshop'));
    await shot(b, 'private-read');
    async function pay(p, to, key) {
      await p.locator('#contact-list button').filter({ hasText: to.name }).click(); await idle(p);
      if (!ev.packets[key]) {
        const v = (await read(p, config.contract)).vault;
        const matching = v.outbox.filter(x => x.packet.to === to.id && x.amount === '1000000');
        // A prior recording interrupted after local signing must be recovered explicitly.
        assert(!matching.some(x => !previous.packets || !Object.values(previous.packets).some(y => y.id === x.packet.id)), 'Uncheckpointed matching payment: inspect before continuing');
        await p.locator('#pay-tusd').click(); await p.locator('#chat-pay-amount').fill('1');
        await p.locator('#chat-pay-submit').click(); await idle(p);
        assert(await p.locator('#handover').isVisible());
        ev.packets[key] = JSON.parse(await p.locator('#outgoing').inputValue()); await save();
        await p.locator('[data-close="handover"]').click();
      }
      return ev.packets[key];
    }
    await receive(b, await pay(a, previous.profiles.b, 'first'));
    await b.locator('#contact-list button').filter({ hasText: previous.profiles.a.name }).click(); await idle(b);
    await shot(b, 'payment-received');
    const first = (await read(b, config.contract)).vault.spends.at(-1), firstId = await digest(transferTerms(config.contract, first));
    await receive(c, await pay(b, previous.profiles.c, 'onward'));
    const last = (await read(c, config.contract)).vault.spends.at(-1), lastId = await digest(transferTerms(config.contract, last));
    assert.equal(last.input, firstId + ':0', 'Onward payment must spend the newly received note');
    await c.locator('#contact-list button').filter({ hasText: previous.profiles.b.name }).click(); await idle(c);
    assert((await c.locator('#messages').innerText()).includes('awaiting online confirmation'));
    await shot(c, 'payment-onward');
    assert.equal(api.length, before, 'Offline capture made an API request');
    ev.checks = ['three existing isolated profiles matched; original inputs checked against final NEAR state', 'all three cached browsers reloaded offline; uncached fetch failed', 'message packet contains no plaintext; intended recipient decrypted it; wrong recipient rejected it', 'one backed tUSD received offline and its exact output passed onward offline', 'zero API calls while offline'];
    await save();
    await c.context().setOffline(false); await go(c, 'money');
    const final = await view(config.contract, 'get_receipt', { id: lastId });
    if (!final) {
      assert(!ev.submissionStarted, 'Submission may be ambiguous; inspect receipts instead of blindly resubmitting');
      ev.submissionStarted = new Date().toISOString(); await save();
      const row = c.locator('#near-payments .near-payment').filter({ has: c.getByText('1 tUSD', { exact: true }) }).filter({ has: c.getByRole('button', { name: 'Confirm payment', exact: true }) });
      assert.equal(await row.count(), 1); await row.getByRole('button', { name: 'Confirm payment', exact: true }).click(); await idle(c);
    } else { await c.locator('#near-refresh').click(); await idle(c); }
    ev.receipts = [];
    for (const [id, spend] of [[firstId, first], [lastId, last]]) {
      const receipt = await view(config.contract, 'get_receipt', { id }); assert(receipt); assert.equal(receipt.input, spend.input);
      assert.equal(receipt.outputs[0].amount, '1000000'); assert.equal(receipt.outputs[0].owner, spend.recipient);
      assert.equal(await view(config.contract, 'spent_by', { id: spend.input }), id); ev.receipts.push(receipt);
    }
    const cv = (await read(c, config.contract)).vault, savedReceipt = cv.receipts[lastId]; assert(savedReceipt);
    if (savedReceipt.txHash) ev.finalTransaction = finalReceipt(await provider.viewTransactionStatus({ txHash: savedReceipt.txHash, accountId: 'lenz-dev-1792984696547.testnet', waitUntil: 'FINAL' }));
    await go(c, 'chat'); await c.locator('#contact-list button').filter({ hasText: previous.profiles.b.name }).click(); await idle(c);
    assert((await c.locator('#messages').innerText()).includes('Payment confirmed on NEAR'));
    await shot(c, 'payment-confirmed');
    ev.checks.push('both new transfers match final NEAR receipts; onward confirmation captured after reconnection');
    ev.api = api; ev.sourceFiles = {};
    for (const file of [...sourceFiles].sort()) ev.sourceFiles[file] = hash(await fs.readFile(path.join(root, file)));
    ev.complete = true; ev.completedAt = new Date().toISOString(); await save();
    const { packets, submissionStarted, ...publicEvidence } = ev;
    publicEvidence.scope = 'Existing testnet tUSD, one new A→B→C onward payment. No funding, deployment, swap or user profile access. Cropped actual UI states captured in both themes; animation/timing added separately. Private chat is distinct from public NEAR settlement. Windows Edge offline emulation only.';
    await fs.writeFile(path.join(__dirname, 'preview-flow-results.json'), JSON.stringify(publicEvidence, null, 2) + '\n');
    console.log(JSON.stringify({ complete: true, checks: ev.checks, transaction: ev.finalTransaction?.txHash }));
  } finally { for (const c of contexts) await c.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
