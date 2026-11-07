const {chooseTheme}=require('./theme-test-ui.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const checks = [], errors = [], requests = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1040 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push({ method: r.method(), url: r.url() }));
    await page.goto((process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173')+'/');
    await page.waitForFunction(() => document.querySelector('#home-cache-status').textContent.startsWith('Homepage saved'));
    const video = page.locator('#defi-preview');
    await page.waitForFunction(() => document.querySelector('#defi-preview').readyState >= 2);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await video.getAttribute('src'), '/previews/defi-dark.mp4');
    assert.equal(await video.evaluate(v => v.duration), 30);
    assert(await page.evaluate(() => document.querySelector('#hero-preview').closest('.hero') && document.querySelector('#defi').offsetTop >= document.querySelector('.hero').offsetTop + document.querySelector('.hero').offsetHeight));
    checks.push('hero placement preserved; five-scene DeFi gallery loads in system dark theme');
    for (const [index, time] of [0,6,12,18,24].entries()) {
      const button = page.locator(`[data-defi-time="${time}"]`);
      await button.click();
      assert.equal(await button.getAttribute('aria-current'), 'true');
      assert.equal(await page.locator('#chapter-number').textContent(), String(index+1).padStart(2, '0'));
      await page.waitForFunction(t => Math.abs(document.querySelector('#defi-preview').currentTime-t-.05)<.12, time);
    }
    checks.push('all five chapter controls seek and update selected context immediately');
    await video.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#chapter-number').textContent === '01');
    await video.press('ArrowLeft'); assert.equal(await page.locator('#chapter-number').textContent(), '01');
    await page.locator('[data-defi-time="12"]').click();
    await chooseTheme(page,'light');
    await page.waitForFunction(() => document.querySelector('#defi-preview').readyState >= 2 && Math.abs(document.querySelector('#defi-preview').currentTime-12.05)<.12);
    assert(await video.evaluate(v => v.paused));
    assert.equal(await page.locator('#hero-preview').getAttribute('src'), '/previews/chat-light.mp4');
    checks.push('keyboard wrapping/clamping and theme changes preserve the chapter and reduced-motion pause');
    for (const theme of ['light','dark']) {
      if (theme === 'dark') await chooseTheme(page,'dark');
      await page.waitForFunction(() => document.querySelector('#defi-preview').readyState >= 2);
      await video.evaluate(v => new Promise(resolve => { v.addEventListener('seeked', resolve, { once:true }); v.currentTime=16.8; }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (const [width,height] of [[320,740],[375,812],[844,390],[1024,768],[1360,1040]]) {
        await page.setViewportSize({ width,height });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} overflow at ${width}`);
        assert(await page.locator('[data-defi-time]').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44)));
      }
      assert(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor === getComputedStyle(document.querySelector('#defi')).backgroundColor));
      await page.locator('#defi').screenshot({ path: path.join(__dirname, `evidence/home-defi-${theme}.png`) });
    }
    await page.setViewportSize({ width:375,height:812 });
    await page.locator('#defi').screenshot({ path: path.join(__dirname, 'evidence/home-defi-phone.png') });
    checks.push('both themes share page/gallery background and fit phone, landscape, tablet and desktop; targets remain at least 44px');
    await page.emulateMedia({ reducedMotion:'no-preference' });
    await page.setViewportSize({ width:1360, height:1040 });
    await video.scrollIntoViewIfNeeded();
    const area=page.locator('#defi .recording'), box=await area.boundingBox();
    await page.mouse.move(box.x+box.width*.85,box.y+box.height*.3);
    await page.waitForFunction(() => parseFloat(document.querySelector('#defi [data-tilt-surface]').style.getPropertyValue('--ry'))>1);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#defi-preview').paused);
    await page.waitForTimeout(350); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('#defi-preview').paused);
    await page.emulateMedia({ reducedMotion:'reduce' });
    checks.push('gallery responds to pointer tilt and hold-to-pause, then resumes on release');
    await context.setOffline(true); await page.reload();
    await page.locator('[data-defi-time="18"]').click();
    await page.waitForFunction(() => document.querySelector('#defi-preview').readyState >= 2 && Math.abs(document.querySelector('#defi-preview').currentTime-18.05)<.12);
    await chooseTheme(page,'light');
    await page.waitForFunction(() => document.querySelector('#defi-preview').readyState >= 2 && Math.abs(document.querySelector('#defi-preview').currentTime-18.05)<.12);
    assert(await page.evaluate(async () => { try { await fetch('/uncached-defi-probe'); return false; } catch { return true; } }));
    checks.push('cached offline reload, chapter selection and both media themes work while an uncached request fails');
    assert.deepEqual(errors, []);
    assert(requests.every(r => r.method === 'GET' && new URL(r.url).origin === (process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173')));
    checks.push('no script errors, external requests or financial submissions');
    fs.writeFileSync(path.join(__dirname, 'home-defi-browser-results.json'), JSON.stringify({ browser: await browser.version(), passed:checks.length, failed:0, checks }, null, 2)+'\n');
    console.log(checks.map(c => 'PASS '+c).join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
