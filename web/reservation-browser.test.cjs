// Synthetic keys/value only, inside a fresh disposable browser context.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const checks = [];
  try {
    const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage();
    if (process.env.RESERVATION_MUTANT) {
      const source = await readFile(path.join(__dirname, 'public/exchange-reservations.js'), 'utf8');
      const replacements = {
        conflict: ["assert(!saved.some(row => row.agreement.body.network", "assert(true || !saved.some(row => row.agreement.body.network"],
        persistence: ['await journal(owner, saved);', '/* deliberately omit persistence */'],
      };
      const pair = replacements[process.env.RESERVATION_MUTANT]; assert(pair && source.includes(pair[0]));
      await context.route('**/exchange-reservations.js', route => route.fulfill({ contentType: 'text/javascript', body: source.replace(...pair) }));
    }
    await a.goto('http://127.0.0.1:4173/chat.html'); await b.goto('http://127.0.0.1:4173/chat.html');
    await a.evaluate(async () => {
      const { createIdentity } = await import('/peer-crypto.js');
      const { updateState } = await import('/chat-store.js');
      const { makeAgreement, swapOutputs } = await import('/peer-exchange.js');
      const [one, two] = await Promise.all(['Reservation test A', 'Reservation test B'].map(createIdentity));
      const roots = [{ id: 'root:one', owner: one.profile.signingPublic, asset: 'DEMO-A', value: '100' }, { id: 'root:two', owner: two.profile.signingPublic, asset: 'DEMO-B', value: '50' }];
      const terms = { network: 'reservation-test', pool: 'synthetic', kind: 'swap', inputs: roots.map(n => n.id), outputs: swapOutputs(...roots, '20', '10'), deadline: 100 };
      const drafts = await Promise.all([makeAgreement(terms), makeAgreement(terms)]);
      await updateState(state => { state.identity = one; state.reservationTest = { roots, drafts }; });
    });
    async function authorize(page, index, now = 50) {
      return page.evaluate(async ({ index, now }) => {
        const { readState } = await import('/chat-store.js'); const { authorizeReserved } = await import('/exchange-reservations.js');
        const s = await readState();
        try { return { agreement: await authorizeReserved(s.identity, s.reservationTest.drafts[index], new Map(s.reservationTest.roots.map(n => [n.id, n])), { network: 'reservation-test', pool: 'synthetic', now }) }; }
        catch (error) { return { error: error.message }; }
      }, { index, now });
    }
    const outcomes = await Promise.all([authorize(a, 0), authorize(b, 1)]);
    assert.equal(outcomes.filter(r => r.agreement).length, 1);
    assert(outcomes.find(r => r.error).error.includes('already reserved'));
    checks.push('simultaneous conflicting offers in two tabs expose only one authorization');
    const winner = outcomes.findIndex(r => r.agreement), loser = 1 - winner;
    await a.locator('#prepare-offline').click();
    await a.waitForFunction(() => document.querySelector('#status').textContent.includes('Conversation files saved'));
    await context.setOffline(true);
    await a.reload();
    const retry = await authorize(a, winner, 200);
    assert.deepEqual(retry.agreement, outcomes[winner].agreement);
    checks.push('offline reload and retry recover the exact saved authorization, even after its deadline');
    assert((await authorize(b, loser, 50)).error.includes('already reserved'));
    checks.push('changing the local clock cannot release an existing reservation');
    const journal = await a.evaluate(async () => {
      const { readState } = await import('/chat-store.js'); const { readAuthorizations } = await import('/exchange-reservations.js');
      return readAuthorizations((await readState()).identity.profile.signingPublic);
    });
    assert.equal(journal.length, 1); assert.deepEqual(journal[0].inputs, ['root:one']);
    checks.push('only the authorizing owner’s input is reserved');
    const edgeCases = await a.evaluate(async () => {
      const { readState } = await import('/chat-store.js'); const { createIdentity } = await import('/peer-crypto.js');
      const { makeAgreement } = await import('/peer-exchange.js'); const { authorizeReserved, readAuthorizations } = await import('/exchange-reservations.js');
      const identity = await createIdentity('Storage failure fixture');
      const note = { id: 'root:failure', owner: identity.profile.signingPublic, asset: 'DEMO-A', value: '10' };
      const notes = new Map([[note.id, note]]);
      const config = { network: 'reservation-test', pool: 'synthetic', now: 50 };
      const candidate = await makeAgreement({ ...config, kind: 'transfer', inputs: [note.id], outputs: [{ owner: (await readState()).identity.profile.signingPublic, asset: note.asset, value: note.value }], deadline: 100 });
      let wrongDomain, expired, failed, exposed = false;
      try { await authorizeReserved(identity, candidate, notes, { ...config, pool: 'other' }); } catch (e) { wrongDomain = e.message; }
      try { await authorizeReserved(identity, candidate, notes, { ...config, now: 101 }); } catch (e) { expired = e.message; }
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'owners') { this.transaction.abort(); throw new Error('Injected storage failure'); } return put.apply(this, args); };
      try { await authorizeReserved(identity, candidate, notes, config); exposed = true; } catch (e) { failed = e.message; }
      finally { IDBObjectStore.prototype.put = put; }
      const countAfterFailure = (await readAuthorizations(identity.profile.signingPublic)).length;
      const recovered = await authorizeReserved(identity, candidate, notes, config);
      return { wrongDomain, expired, failed, exposed, countAfterFailure, recovered: recovered.id === candidate.id };
    });
    assert.match(edgeCases.wrongDomain, /Wrong network/); assert.match(edgeCases.expired, /expired/);
    checks.push('wrong domains and fresh expired offers are rejected');
    assert.match(edgeCases.failed, /Injected storage failure/); assert.equal(edgeCases.exposed, false); assert.equal(edgeCases.countAfterFailure, 0); assert.equal(edgeCases.recovered, true);
    checks.push('storage failure exposes no signature; a later successful save recovers');
    await writeFile(path.join(__dirname, 'reservation-browser-results.json'), JSON.stringify({ browser: await browser.version(), checks, passed: checks.length, failed: 0, scope: 'Synthetic browser-local authorization journal; not rollback-resistant storage or global uniqueness.' }, null, 2) + '\n');
    console.log(checks.map(name => 'PASS ' + name).join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
