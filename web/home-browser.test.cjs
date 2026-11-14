const {chooseTheme}=require('./theme-test-ui.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const checks = [], errors = [];
  try {
    const context = await browser.newContext(), page = await context.newPage();
    await context.addInitScript(()=>localStorage.setItem('lenz-home-motion','off'));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173')+'/');
    await page.waitForFunction(() => document.querySelector('#home-cache-status').dataset.offlineState==='ready'||document.querySelector('#home-cache-status').textContent.startsWith('Homepage saved'));
    for (const [name, width, height] of [['desktop', 1280, 960], ['narrow', 375, 812]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
      await page.screenshot({ path: path.join(__dirname, `evidence/home-${name}.png`), fullPage: true });
    }
    checks.push('restored homepage and real interface previews fit desktop and narrow layouts');
    assert.equal(await page.locator('#motion-toggle').count(),0);
    assert(!await page.locator('html').evaluate(n=>n.classList.contains('motion-off')));
    assert(await page.locator('.appearance a[href="/money.html"]').isVisible());
    assert.equal(await page.locator('.section-nav a[href="/money.html"]').count(),0);
    await page.locator('#view-chat').click(); assert.equal(await page.locator('#product-preview').getAttribute('src'),'/previews/chat-light.mp4');
    await page.locator('#view-chat').press('ArrowDown'); assert.equal(await page.locator('#view-profile').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#product-preview').getAttribute('src'),'/previews/profile-light.mp4');
    await page.locator('#view-profile').press('Home'); assert.equal(await page.locator('#view-wallet').getAttribute('aria-selected'),'true');
    await chooseTheme(page,'dark'); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await chooseTheme(page,'light');
    await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForFunction(()=>document.documentElement.classList.contains('motion-off'));
    assert(await page.locator('video').evaluateAll(nodes=>nodes.every(n=>n.paused)));
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>!document.documentElement.classList.contains('motion-off'));
    checks.push('feature panels support keyboard navigation; click-cycle theme and device reduced-motion preference work; Open wallet is at the right');
    await page.locator('.how-steps summary').nth(1).click(); assert(await page.locator('.how-steps details').nth(1).evaluate(node=>node.open));
    await page.getByText('Do I need to chat before I pay?',{exact:true}).click(); assert((await page.locator('#questions').innerText()).includes('Open Wallet to send and receive directly'));
    checks.push('sections respond to interaction throughout the page');
    await page.getByRole('link', { name: 'Try Lenz' }).click();
    await page.locator('.account-entry').waitFor({ state: 'visible' });
    await page.locator('.identity').click(); assert.equal(new URL(page.url()).pathname, '/');
    await page.getByRole('link', { name: 'Proof experiment', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/payment-demo.html');
    checks.push('homepage links to wallet and original proof experiment');
    await context.setOffline(true); await page.goto((process.env.LENZ_STYLE_TEST_BASE??'http://127.0.0.1:4173')+'/');
    assert((await page.locator('h1').innerText()).includes('without internet'));
    assert(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
    assert(await page.locator('.hero').evaluate(node => getComputedStyle(node).display === 'grid'));
    await page.locator('#view-profile').click(); assert.equal(await page.locator('#product-preview').getAttribute('src'),'/previews/profile-light.mp4');
    assert(await page.evaluate(async () => { try { await fetch('/uncached-home-probe'); return false; } catch { return true; } }));
    checks.push('complete homepage opens from cache while an uncached request fails');
    assert.deepEqual(errors, []);
    await writeFile(path.join(__dirname, 'home-browser-results.json'), JSON.stringify({ browser: await browser.version(), passed: checks.length, failed: 0, checks }, null, 2) + '\n');
    console.log(checks.map(c => 'PASS ' + c).join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
