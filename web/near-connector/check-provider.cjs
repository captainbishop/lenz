// Read-only provider check in a fresh browser; never imports or creates a wallet.
const { chromium } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const result = { checkedAt: new Date().toISOString(), scope: 'Read-only Meteor testnet connection page in isolated Edge. No account creation, imported key, signature or transaction.' };
  try {
    const context = await browser.newContext({ viewport: { width: 480, height: 820 } }), page = await context.newPage();
    const url = new URL('https://wallet.meteorwallet.app/connect/testnet/login');
    url.search = new URLSearchParams({ source: 'wpm', connectionUid: crypto.randomUUID(), pageUri: encodeURIComponent('http://127.0.0.1:4173/wallet-lab.html') });
    try {
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
      result.httpStatus = response?.status();
      result.httpOk = response?.ok() === true;
      if (!result.httpOk) process.exitCode = 1;
      await page.locator('body').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction(() => document.body.innerText.trim().length > 30, { }, { timeout: 10000 });
      result.pageText = (await page.locator('body').innerText()).slice(0, 8000);
      result.url = page.url().split('?')[0];
      await page.screenshot({ path: path.join(__dirname, '../evidence/meteor-provider.png'), fullPage: true, timeout: 10000 });
    } catch (error) { result.error = error.message; process.exitCode = 1; }
    await fs.writeFile(path.join(__dirname, 'meteor-page-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
