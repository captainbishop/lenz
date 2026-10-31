const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
(async () => {
  const folder = path.join(__dirname, '../web/public/brand'), checks = [];
  for (const size of [16, 32, 180, 192, 512, 1024]) {
    const info = await sharp(path.join(folder, `icon-${size}.png`)).metadata();
    assert.equal(info.width, size); assert.equal(info.height, size);
  }
  checks.push('six icon exports have their stated dimensions, including 16 and 32 pixels');
  for (const name of ['logo', 'logo-reverse']) {
    const svg = await readFile(path.join(folder, name + '.svg'), 'utf8'); assert(svg.includes('Lenz')); assert(!svg.includes('Carrymesh'));
    const png = await sharp(path.join(folder, name + '.png')).metadata(); assert.equal(png.width, 720); assert.equal(png.height, 288); assert(png.hasAlpha);
  }
  checks.push('primary and reverse SVG/transparent PNG wordmarks carry Lenz');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    for (const [url, title] of [['/chat.html', 'Lenz'], ['/', 'Lenz'], ['/payment-demo.html', 'Lenz'], ['/brand/index.html', 'Lenz']]) {
      await page.goto('http://127.0.0.1:4173' + url); assert((await page.title()).includes(title));
      assert(!(await page.locator('body').innerText()).includes('Carrymesh'));
    }
    checks.push('chat, original payment demo and brand page use Lenz without old branding');
    for (const [name, width, height] of [['desktop', 1280, 960], ['narrow', 375, 812]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
      await page.screenshot({ path: path.join(__dirname, `../web/evidence/lenz-brand-${name}.png`), fullPage: true });
    }
    checks.push('brand page images load and layouts fit desktop and 375-pixel width');
    await page.goto('http://127.0.0.1:4173/');
    await page.evaluate(async () => {
      // Exercise a brand-shell worker update without downloading the proving keys.
      const cache = await caches.open('proof-u-web-demo-v1');
      await cache.put('/assets/brand-preservation-probe', new Response('keep this cached proof-asset sentinel'));
      const reg = await navigator.serviceWorker.register('/sw.js');
      const worker = reg.installing ?? reg.waiting ?? reg.active;
      if (worker.state !== 'activated') await new Promise((resolve, reject) => {
        worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); if (worker.state === 'redundant') reject(new Error('Worker installation failed')); });
      });
    });
    assert(await page.evaluate(async () => !!await (await caches.open('proof-u-web-demo-v1')).match('/assets/brand-preservation-probe')));
    await page.context().setOffline(true); await page.goto('http://127.0.0.1:4173/brand/index.html');
    assert.equal(await page.locator('h1').innerText(), 'Lenz');
    assert.equal(await page.locator('.specimens').evaluate(node => getComputedStyle(node).display), 'grid');
    assert(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
    checks.push('brand-shell worker update preserves existing cache entries and serves Lenz offline');
  } finally { await browser.close(); }
  await writeFile(path.join(__dirname, 'verification.json'), JSON.stringify({ checks, passed: checks.length, failed: 0 }, null, 2) + '\n');
  console.log(checks.map(c => 'PASS ' + c).join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
