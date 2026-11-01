const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    await page.goto('http://127.0.0.1:4173/');
    for (const selector of ['.hero-art', '.product-screen-wrap']) {
      const area = page.locator(selector), screen = area.locator('[data-tilt-surface]');
      await area.scrollIntoViewIfNeeded();
      // IntersectionObserver starts the parent's entrance on the next frame.
      await page.waitForTimeout(750);
      assert.equal(await screen.count(), 1, 'Each preview needs a pointer-responsive surface');
      const box = await area.boundingBox();
      const before = await screen.evaluate(n => getComputedStyle(n).transform);
      await page.mouse.move(box.x + box.width * .85, box.y + box.height * .4);
      await page.waitForTimeout(250);
      assert.notEqual(await screen.evaluate(n => getComputedStyle(n).transform), before, 'Pointer movement must change the screen transform');
      const control = area.locator('.video-caption');
      const controlBefore = await control.boundingBox();
      await page.mouse.move(box.x + box.width * .15, box.y + box.height * .6);
      await page.waitForTimeout(250);
      assert.deepEqual(await control.boundingBox(), controlBefore, 'Captions must remain still');
      await page.mouse.move(1, 1); await page.waitForTimeout(250);
      assert.equal(await screen.evaluate(n => n.style.getPropertyValue('--rx')), '0deg');
    }
    checks.push('both screens respond to pointer movement and reset on exit; captions remain still');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      for (const [width, height] of [[320,740], [375,812], [768,1024], [844,390], [1280,900], [1536,960]]) {
        await page.setViewportSize({ width, height });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow: ${theme} ${width}`);
        for (const selector of ['.app-preview', '.product-screen']) {
          const box = await page.locator(selector).boundingBox();
          assert(box.width > Math.min(width - 60, 260), `Preview too small at ${width}`);
          assert(box.x >= 0 && box.x + box.width <= width, `Preview clipped at ${width}`);
        }
      }
    }
    checks.push('both themes fit six phone/tablet/desktop and landscape viewport sizes');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.hero-art').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.documentElement.classList.contains('motion-off'));
    const area = await page.locator('.hero-art').boundingBox();
    await page.mouse.move(area.x + area.width * .8, area.y + area.height * .3);
    assert.equal(await page.locator('.app-preview').evaluate(n => getComputedStyle(n).transform), 'none');
    assert(await page.locator('#hero-preview').evaluate(v => v.paused));
    checks.push('reduced motion disables tilt and autoplay');
    const result = { checkedAt: new Date().toISOString(), browser: await browser.version(), checks, passed: checks.length, failed: 0 };
    await writeFile(path.join(__dirname, 'home-screen-response-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
