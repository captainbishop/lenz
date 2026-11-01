// Bounded NEAR testnet failure exercise. Default: inspect existing profiles only.
// --run moves 0.01 existing tUSD A -> B and creates a deliberately conflicting
// signed branch A -> C -> D. Only the winning path may reach the relay.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), base = 'http://127.0.0.1:4173';
const privateRoot = path.join(root, 'contracts/.testnet/offline-social-live-2026-10-31');
const journalFile = path.join(privateRoot, 'payment-failure.json');
const reportFile = path.join(__dirname, 'near-payment-failure-live-results.json');
const sha = b => createHash('sha256').update(b).digest('hex');
const run = process.argv.includes('--run');
assert(process.argv.slice(2).every(x => ['--run', '--inspect'].includes(x)));
let journal, saveQueue = Promise.resolve(), currentStep = 'preflight';
async function save() {
  const bytes = JSON.stringify(journal, null, 2) + '\n';
  saveQueue = saveQueue.then(async () => {
    await fs.writeFile(journalFile + '.tmp', bytes, { flush: true });
    await fs.rename(journalFile + '.tmp', journalFile);
  });
  await saveQueue;
}
async function step(name, operation) {
  currentStep = name;
  if (journal.steps[name]) return journal.steps[name];
  console.log('RUN ' + name);
  const result = await operation(); journal.steps[name] = result ?? true;
  await save(); console.log('PASS ' + name); return result;
}
const idle = p => p.waitForFunction(() => document.querySelector('main').getAttribute('aria-busy') !== 'true', null, { timeout: 150000 });
async function go(p, view) {
  await p.goto(base + '/' + view + '.html');
  await p.waitForFunction(() => /is ready/.test(document.querySelector('#status').textContent)); await idle(p);
}
async function read(p, contract) {
  return p.evaluate(async contract => {
    const s = await (await import('/chat-store.js')).readState();
    if (!s.identity) return null;
    const n = await import('/near-protocol.js'), v = await n.readNearVault(s, contract), l = await n.nearLedger(v);
    const notes = l.available.filter(x => x.owner === n.compressed(s.identity.profile.signingPublic));
    return { profile: s.identity.profile, contacts: s.contacts, messages: s.messages.map(x => x.packet.id),
      vault: v, notes, blocked: [...l.blocked], total: notes.reduce((a, b) => a + BigInt(b.amount), 0n).toString() };
  }, contract);
}
async function receive(p, packet) {
  if (await p.evaluate(async id => (await (await import('/chat-store.js')).readState()).messages.some(x => x.packet.id === id), packet.id)) return;
  await p.locator('#receive-message').click();
  await p.locator('#incoming-file').setInputFiles({ name: 'test-payment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packet)) });
  await p.waitForFunction(() => document.querySelector('#status').textContent.includes('File loaded')); await idle(p);
  await p.locator('#open-message').click(); await idle(p);
  await p.locator('#handover').waitFor({ state: 'hidden' });
}
async function select(p, name) { await p.locator('#contact-list button').filter({ hasText: name }).click(); await idle(p); }
const card = p => p.locator('.near-chat-card').filter({ has: p.getByText('0.01 tUSD', { exact: true }) });
(async () => {
  try { journal = JSON.parse(await fs.readFile(journalFile)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (journal?.complete) { console.log('Completed exercise; refusing further signing/submission. Use the saved-evidence verifier.'); return; }
  const configBytes = await fs.readFile(path.join(__dirname, 'public/near-config.json'));
  const config = JSON.parse(configBytes), contract = config.contract;
  const previous = JSON.parse(await fs.readFile(path.join(__dirname, 'offline-social-live-results.json')));
  assert(config.ready && config.network === 'testnet'); assert.equal(contract, previous.reserve);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (u, i = {}) => nativeFetch(u, { ...i, signal: AbortSignal.any([AbortSignal.timeout(25000), ...(i.signal ? [i.signal] : [])]) });
  const { view, provider, finalReceipt } = await import('../contracts/client.mjs');
  const { digest } = await import('./public/peer-crypto.js');
  const { transferTerms } = await import('./public/near-protocol.js');
  assert.deepEqual(await (await fetch(base + '/api/testnet/status')).json(), config);
  const code = await provider.sendJsonRpc('query', { request_type: 'view_code', finality: 'final', account_id: contract });
  assert.equal(sha(Buffer.from(code.code_base64, 'base64')), config.wasmSha256);
  const contexts = [], pages = {}, requests = [], errors = [];
  let hideReads = !!journal?.submissionStarted && !journal?.steps.recovery, lock;
  if (run) lock = await fs.open(path.join(privateRoot, 'payment-failure.lock'), 'wx');
  try {
    for (const role of run ? ['a', 'b', 'c', 'd'] : ['a', 'b', 'c']) {
      const ctx = await chromium.launchPersistentContext(path.join(privateRoot, role === 'd' ? 'conflict-recipient' : role),
        { channel: 'msedge', headless: true, serviceWorkers: 'block', viewport: { width: 1100, height: 850 } });
      contexts.push(ctx); const p = ctx.pages()[0] || await ctx.newPage(); pages[role] = p;
      const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable');
      await cdp.send('Network.setBypassServiceWorker', { bypass: true });
      p.on('pageerror', e => errors.push(e.message));
      await p.route('**/api/**', async route => {
        const req = route.request(), name = new URL(req.url()).pathname;
        requests.push({ role, name, method: req.method() });
        try {
          assert.equal(req.method(), 'POST'); assert.equal(req.postDataJSON().contract, contract);
          if (name === '/api/testnet/check') {
            if (hideReads && role === 'b') return route.fulfill({ status: 503, json: { error: 'Injected temporary loss of status access' } });
            return route.continue();
          }
          assert(run && role === 'b' && name === '/api/testnet/settle', 'Forbidden live operation');
          assert.deepEqual(req.postDataJSON().path, journal.paths.winner.path);
          assert(!journal.submissionStarted, 'An earlier submission may have executed; read final state before any retry');
          journal.submissionStarted = new Date().toISOString(); await save();
          // Forward exactly once. Persist the real result before hiding it from
          // the browser. HTTP errors avoid Chromium socket-level POST retries.
          const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 150000 });
          const result = await response.json();
          journal.relayResponse = { status: response.status(), result }; await save();
          assert(response.ok() && result.finality === 'FINAL', 'Actual settlement did not return a successful final response');
          hideReads = true;
          return route.fulfill({ status: 502, json: { error: 'Injected loss of successful settlement response' } });
        } catch (e) {
          errors.push(e.message);
          await route.fulfill({ status: 500, json: { error: 'Live exercise guard stopped this request' } });
        }
      });
      await go(p, 'chat');
      if (role !== 'd') assert.deepEqual((await read(p, contract)).profile, previous.profiles[role]);
    }
    if (!journal) {
      const before = {};
      for (const role of ['a', 'b', 'c']) {
        const s = await read(pages[role], contract);
        for (const note of s.notes) {
          assert.deepEqual(await view(contract, 'get_note', { id: note.id }), note);
          assert.equal(await view(contract, 'spent_by', { id: note.id }), null);
        }
        before[role] = s; console.log(`${role}: ${s.total} backed base units; identity verified`);
      }
      if (!run) { console.log('Read-only inspection passed. No signing, funding or transaction.'); return; }
      journal = { startedAt: new Date().toISOString(), contract, configSha256: sha(configBytes), before,
        steps: {}, packets: {}, paths: {}, failures: [] };
      journal.backingBefore = { supply: await view(contract, 'ft_total_supply', {}),
        reserved: await view(contract, 'reserved_balance', {}), balance: await view(contract, 'ft_balance_of', { account_id: contract }) };
      await save();
    }
    assert.equal(journal.configSha256, sha(configBytes));
    if (!run) return;
    const { a, b, c, d } = pages;
    await step('contacts', async () => {
      if (!await read(d, contract)) {
        await d.locator('#name').fill('Dara'); await d.locator('#identity-form button[type=submit]').click(); await idle(d);
      }
      const dp = (await read(d, contract)).profile; journal.profiles = { ...previous.profiles, d: dp };
      assert.equal((await read(d, contract)).total, '0');
      for (const [p, contacts] of [[a, [previous.profiles.c]], [c, [previous.profiles.a, dp]], [d, [previous.profiles.c]]]) {
        await p.evaluate(async contacts => {
          const { validateProfile } = await import('/peer-crypto.js');
          await (await import('/chat-store.js')).updateState(async s => {
            for (const profile of contacts) if (!s.contacts.some(x => x.id === profile.id)) s.contacts.push(await validateProfile(profile));
          });
        }, contacts); await go(p, 'chat');
      }
      return { freshReceiver: dp.id, funded: false };
    });
    for (const p of Object.values(pages)) {
      await p.context().setOffline(true);
      assert(await p.evaluate(async () => { try { await fetch('/uncached-failure-probe'); return false; } catch { return !navigator.onLine; } }));
    }
    const offlineCount = requests.length;
    await step('signed-branches', async () => {
      // Journal the unsaved control branch first. No identity or vault rollback.
      if (!journal.packets.loser) {
        assert.equal((await read(a, contract)).vault.spends.length, journal.before.a.vault.spends.length);
        const alternate = await a.evaluate(async ({ contract, to }) => {
          const s = await (await import('/chat-store.js')).readState(), n = await import('/near-protocol.js');
          const result = await n.makeNearPayment(await n.readNearVault(s, contract), s.identity, to, '0.01');
          return { payload: result.payload, packet: await (await import('/peer-crypto.js')).sealMessage(s.identity, to, result.payload) };
        }, { contract, to: journal.profiles.c });
        journal.packets.loser = alternate.packet; journal.paths.loser = alternate.payload; await save();
      }
      const existing = (await read(a, contract)).vault.outbox.filter(x => !journal.before.a.vault.outbox.some(y => y.packet.id === x.packet.id));
      assert(existing.length <= 1, 'Unrelated new payment found');
      if (existing.length) journal.packets.winner = existing[0].packet;
      else {
        await select(a, journal.profiles.b.name); await a.locator('#pay-tusd').click();
        await a.locator('#chat-pay-amount').fill('0.01'); await a.locator('#chat-pay-submit').click(); await idle(a);
        journal.packets.winner = JSON.parse(await a.locator('#outgoing').inputValue());
        await a.locator('[data-close="handover"]').click();
      }
      journal.paths.winner = await b.evaluate(async ({ packet, sender }) => {
        const s = await (await import('/chat-store.js')).readState(); return (await import('/peer-crypto.js')).openMessage(s.identity, sender, packet);
      }, { packet: journal.packets.winner, sender: journal.profiles.a });
      assert.equal(journal.paths.winner.path.at(-1).input, journal.paths.loser.path.at(-1).input);
      for (const label of ['winner', 'loser']) journal.paths[label].id = await digest(transferTerms(contract, journal.paths[label].path.at(-1)));
      await save();
      await receive(b, journal.packets.winner); await receive(c, journal.packets.loser);
      assert.equal((await read(b, contract)).total, String(BigInt(journal.before.b.total) + 10000n));
      assert.equal((await read(c, contract)).total, String(BigInt(journal.before.c.total) + 10000n));
      return { input: journal.paths.winner.path.at(-1).input, amount: '10000', winner: journal.paths.winner.id, loser: journal.paths.loser.id };
    });
    await step('offline-onward', async () => {
      const existing = (await read(c, contract)).vault.outbox.filter(x => x.packet.to === journal.profiles.d.id);
      assert(existing.length <= 1);
      if (!existing.length) {
        await select(c, journal.profiles.d.name); await c.locator('#pay-tusd').click();
        await c.locator('#chat-pay-amount').fill('0.01'); await c.locator('#chat-pay-submit').click(); await idle(c);
        journal.packets.onward = JSON.parse(await c.locator('#outgoing').inputValue()); await c.locator('[data-close="handover"]').click();
      } else journal.packets.onward = existing[0].packet;
      const payload = await d.evaluate(async ({ packet, sender }) => {
        const s = await (await import('/chat-store.js')).readState(); return (await import('/peer-crypto.js')).openMessage(s.identity, sender, packet);
      }, { packet: journal.packets.onward, sender: journal.profiles.c });
      assert.equal(payload.path.at(-1).input, journal.paths.loser.id + ':0');
      journal.paths.onward = { ...payload, id: await digest(transferTerms(contract, payload.path.at(-1))) }; await save();
      await receive(d, journal.packets.onward); await select(d, journal.profiles.c.name);
      assert.equal((await read(d, contract)).total, '10000');
      assert((await card(d).innerText()).includes('awaiting online confirmation'));
      assert.equal(requests.length, offlineCount);
      return { amount: '10000', input: payload.path.at(-1).input, offlineApiRequests: 0 };
    });
    await step('interrupted-confirmation', async () => {
      await select(b, journal.profiles.a.name);
      const count = requests.length; await b.context().setOffline(false);
      await b.waitForFunction(() => navigator.onLine); assert.equal(requests.length, count);
      if (!journal.submissionStarted) {
        await card(b).getByRole('button', { name: 'Confirm payment', exact: true }).click(); await idle(b);
      }
      if (!journal.submissionStarted) {
        journal.preSubmitDiagnostic = await b.evaluate(async contract => {
          try { await (await import('/near-payment-status.js')).refreshNearPayments(contract); return 'Read succeeded; submission was not reached'; }
          catch (e) { return e.message; }
        }, contract);
        journal.preSubmitFeedback = await card(b).innerText(); await save();
        throw Error('No settlement sent: ' + journal.preSubmitDiagnostic);
      }
      assert(journal.relayResponse?.result.finality === 'FINAL', 'Submission is uncertain; inspect saved path and chain without resubmitting');
      const bv = (await read(b, contract)).vault, note = journal.paths.winner.id + ':0';
      assert.equal(bv.confirmations[note].attempts, 1); assert(!bv.receipts[journal.paths.winner.id]);
      assert((await card(b).innerText()).includes('Confirmation pending'));
      const beforeReload = requests.length;
      await go(b, 'money'); assert((await b.locator('#near-payments').innerText()).includes('Confirmation pending'));
      await go(b, 'chat'); await select(b, journal.profiles.a.name);
      assert((await card(b).innerText()).includes('Confirmation pending')); assert.equal(requests.length, beforeReload);
      return { persistedAttempts: 1, reloadApiRequests: 0, injectedFaults: ['HTTP 502 after actual FINAL settlement', 'HTTP 503 on immediate reconciliation'] };
    });
    await step('recovery', async () => {
      await b.context().setOffline(false); hideReads = false;
      await go(b, 'chat'); await select(b, journal.profiles.a.name);
      const before = requests.length; await card(b).getByRole('button', { name: 'Check status', exact: true }).click(); await idle(b);
      assert((await card(b).innerText()).includes('Payment confirmed on NEAR'));
      assert(requests.slice(before).every(r => r.name.endsWith('/check')));
      assert(!(await read(b, contract)).vault.confirmations[journal.paths.winner.id + ':0']);
      await go(b, 'money'); assert((await b.locator('#near-payments').innerText()).includes('Confirmed'));
      return { status: 'confirmed', readOnlyRecovery: true };
    });
    await step('conflict-display', async () => {
      const result = {};
      for (const [role, p, from, label, expected] of [['c', c, 'a', 'loser', journal.before.c.total], ['d', d, 'c', 'onward', '0']]) {
        await p.context().setOffline(false); await go(p, 'chat'); await select(p, journal.profiles[from].name);
        await card(p).getByRole('button', { name: 'Check status', exact: true }).click(); await idle(p);
        assert((await card(p).innerText()).includes('could not be confirmed'));
        const s = await read(p, contract); assert.equal(s.total, expected); assert(s.blocked.includes(journal.paths[label].id + ':0'));
        await go(p, 'money'); assert((await p.locator('#near-payments').innerText()).includes('could not be confirmed'));
        assert(!requests.some(r => r.role === role && r.name.endsWith('/settle')));
        result[role] = { total: s.total, blockedNote: journal.paths[label].id + ':0' };
      }
      return result;
    });
    await step('final-evidence', async () => {
      journal.transaction = await provider.viewTransactionStatus({ txHash: journal.relayResponse.result.txHash,
        accountId: previous.recipient, waitUntil: 'FINAL' }); finalReceipt(journal.transaction);
      journal.receipts = [];
      for (const spend of journal.paths.winner.path) {
        const id = await digest(transferTerms(contract, spend));
        const receipt = await view(contract, 'get_receipt', { id }); assert(receipt);
        assert.equal(await view(contract, 'spent_by', { id: spend.input }), id); journal.receipts.push(receipt);
      }
      for (const label of ['loser', 'onward']) assert.equal(await view(contract, 'get_receipt', { id: journal.paths[label].id }), null);
      const after = { supply: await view(contract, 'ft_total_supply', {}), reserved: await view(contract, 'reserved_balance', {}),
        balance: await view(contract, 'ft_balance_of', { account_id: contract }) };
      assert.deepEqual(after, journal.backingBefore);
      journal.after = {};
      for (const role of ['a', 'b', 'c', 'd']) {
        const s = await read(pages[role], contract), original = journal.before[role];
        if (original) {
          assert.deepEqual(s.profile, original.profile);
          assert(original.messages.every(id => s.messages.includes(id)));
          assert(original.contacts.every(p => s.contacts.some(c => JSON.stringify(c) === JSON.stringify(p))));
          assert.deepEqual(s.vault.rheaOrders, original.vault.rheaOrders);
        }
        for (const note of s.notes) {
          assert.deepEqual(await view(contract, 'get_note', { id: note.id }), note);
          assert.equal(await view(contract, 'spent_by', { id: note.id }), null);
        }
        journal.after[role] = { total: s.total, notes: s.notes };
      }
      assert.equal(journal.after.a.total, String(BigInt(journal.before.a.total) - 10000n));
      assert.equal(journal.after.b.total, String(BigInt(journal.before.b.total) + 10000n));
      assert.deepEqual(errors, []); return { backing: after, originalProfilesHistoryAndReservationsPreserved: true };
    });
    journal.completedAt = new Date().toISOString(); journal.requests = [...(journal.requests ?? []), ...requests]; await save();
    const sourceHashes = {};
    for (const file of ['web/near-payment-failure-live.cjs', 'web/public/near-payment-status.js', 'web/public/near-protocol.js',
      'web/public/near-chat.js', 'web/public/near-wallet.js', 'web/testnet-relay.mjs', 'web/public/near-config.json']) sourceHashes[file] = sha(await fs.readFile(path.join(root, file)));
    const evidence = { schema: 1, contract, startedAt: journal.startedAt, completedAt: journal.completedAt,
      scope: 'Existing funded NEAR testnet notes and four isolated Windows Edge profiles. Actual signed conflicting paths; only the winner is submitted. Injected HTTP failures hide its real final response and block immediate recovery. No new grant, deployment, real funds, user profile or physical-device test.',
      steps: journal.steps, paths: journal.paths, receipts: journal.receipts, transaction: journal.transaction,
      before: Object.fromEntries(Object.entries(journal.before).map(([k, v]) => [k, { total: v.total, notes: v.notes }])),
      after: journal.after, backingBefore: journal.backingBefore, requests: journal.requests, failures: journal.failures, sourceHashes };
    await fs.writeFile(reportFile, JSON.stringify(evidence, null, 2) + '\n');
    journal.complete = true; await save();
    console.log(JSON.stringify({ complete: true, checks: Object.keys(journal.steps).length, txHash: journal.transaction.transaction.hash,
      totals: Object.fromEntries(Object.entries(journal.after).map(([k, v]) => [k, v.total])) }));
  } catch (e) {
    if (journal && run) { journal.requests = [...(journal.requests ?? []), ...requests]; journal.failures.push({ step: currentStep, error: e.message, diagnostics: errors, at: new Date().toISOString() }); await save(); }
    throw e;
  } finally {
    for (const ctx of contexts) await ctx.close();
    if (lock) { await lock.close(); await fs.unlink(path.join(privateRoot, 'payment-failure.lock')); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
