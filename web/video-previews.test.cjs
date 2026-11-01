const { chromium } = require('playwright');
const sharp = require('sharp');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const base = 'http://127.0.0.1:4173';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const checks = [], errors = [], api = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
    context.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
    const account = await context.newPage(); await account.goto(base + '/money.html');
    await account.locator('#wallet-private').click(); await account.locator('#wallet-content').waitFor();
    const snapshot = () => account.evaluate(async () => JSON.stringify(await (await import('/chat-store.js')).readState()));
    const before = await snapshot();
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/');
    await page.waitForFunction(() => document.querySelector('#home-cache-status').textContent.startsWith('Homepage saved'));
    await page.waitForFunction(() => document.querySelector('#hero-preview').readyState >= 2);
    assert.equal(await page.locator('iframe').count(), 0);
    assert(await page.locator('#hero-preview').evaluate(v => v.paused && v.muted && v.loop && !v.controls && v.videoWidth === 600 && v.videoHeight === 660));
    await page.locator('[data-video="hero-preview"]').click();
    await page.waitForFunction(() => document.querySelector('#hero-preview').currentTime > .3);
    await page.locator('[data-video="hero-preview"]').click();
    assert(await page.locator('#hero-preview').evaluate(v => v.paused));
    // The status pill uses actual application styles, including the dark fix.
    const contrast = await account.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const pill = document.createElement('p'); pill.className = 'trade-state'; pill.textContent = 'Awaiting online confirmation'; document.body.append(pill);
      const css = getComputedStyle(pill), result = { color: css.color, background: css.backgroundColor }; pill.remove(); return result;
    });
    assert.deepEqual(contrast, { color: 'rgb(237, 243, 233)', background: 'rgb(43, 68, 50)' });
    checks.push('actual MP4 decodes at 600×660; reduced motion starts paused; play/pause works; dark payment status uses readable contrast');
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
      assert((await page.locator('#hero-preview').getAttribute('src')).endsWith(`chat-${theme}.mp4`));
      for (const view of ['chat', 'profile', 'wallet']) {
        await page.locator('#view-' + view).click();
        await page.locator('#product-preview').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('#product-preview').readyState >= 2);
        assert((await page.locator('#product-preview').getAttribute('src')).endsWith(`${view}-${theme}.mp4`));
        assert(await page.locator('#product-preview').evaluate(v => v.duration > 5 && !v.error));
        await page.locator('[data-video="product-preview"]').click();
        await page.waitForFunction(() => document.querySelector('#product-preview').currentTime > .25);
        if (!(await page.locator('#product-preview').evaluate(v => v.paused))) await page.locator('[data-video="product-preview"]').click();
        const pixel = async input => [...await sharp(input).resize(600,660).extract({left:300,top:20,width:1,height:1}).removeAlpha().raw().toBuffer()];
        const actual = await pixel(await page.locator('#product-preview').screenshot());
        const expected = await pixel(path.join(__dirname, `public/previews/${view}-${theme}.webp`));
        assert(actual.every((value,i)=>Math.abs(value-expected[i])<=6), `Video color differs from its source poster: ${view} ${theme}`);
      }
      await page.setViewportSize({ width: 375, height: 812 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('#product-preview').locator('..').screenshot({ path: path.join(__dirname, `evidence/video-preview-${theme}.png`) });
      await page.setViewportSize({ width: 1280, height: 960 });
    }
    checks.push('all six light/dark videos play and retain source background colors; narrow layouts fit');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Motion on', exact: true }).waitFor();
    await page.locator('[data-video="product-preview"]').click();
    await page.waitForFunction(() => !document.querySelector('#product-preview').paused);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('#product-preview').paused);
    checks.push('playing video pauses when it leaves the viewport');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await account.reload(); await account.locator('#wallet-content').waitFor();
    assert.equal(await account.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await account.locator('#near-total').textContent(), '0');
    assert.equal(await snapshot(), before);
    await account.locator('#show-profile').click(); await account.locator('#edit-profile[open]').waitFor();
    assert(await account.locator('dialog[open]').evaluate(n => getComputedStyle(n).backgroundColor === 'rgb(32, 56, 43)'));
    await account.getByRole('button', { name: 'Close profile', exact: true }).click();
    await account.evaluate(async () => (await import('/save-offline.js')).saveOffline());
    checks.push('actual wallet/profile follows the chosen theme without changing identity or balances');
    await context.setOffline(true); await page.reload();
    await page.locator('#view-profile').click(); await page.locator('#product-preview').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#product-preview').readyState >= 2);
    await page.locator('#product-preview').evaluate(v => { v.currentTime = 3; });
    await page.waitForFunction(() => !document.querySelector('#product-preview').seeking);
    if (await page.locator('#product-preview').evaluate(v => v.paused)) await page.locator('[data-video="product-preview"]').click();
    await page.waitForFunction(() => document.querySelector('#product-preview').currentTime > 3.2);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.locator('#view-chat').click(); await page.waitForFunction(() => document.querySelector('#product-preview').readyState >= 2);
    assert((await page.locator('#product-preview').getAttribute('src')).endsWith('chat-light.mp4'));
    await account.reload(); await account.locator('#wallet-content').waitFor(); assert.equal(await snapshot(), before);
    assert.deepEqual(api, []); assert.deepEqual(errors, []);
    checks.push('offline video playback, seeking and theme switching work; cached wallet identity remains unchanged');
    const result = { checkedAt: new Date().toISOString(), browser: await browser.version(), passed: checks.length, failed: 0, apiRequests: api.length, checks };
    await writeFile(path.join(__dirname, 'video-preview-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
