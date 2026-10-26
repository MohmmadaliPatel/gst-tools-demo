// Headless smoke test + screenshots. Needs a local server on :8080 and the `playwright` package.
// Usage: python3 -m http.server 8080 &  then  node scripts/screenshots.mjs
import { chromium } from 'playwright';
const base = process.env.BASE_URL || 'http://localhost:8080';
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) errors.push(`external request: ${r.url()}`); });

await page.goto(`${base}/index.html`); await page.waitForSelector('#work-list .card');
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'screenshots/01-landing.png', fullPage: true });

await page.goto(`${base}/recon.html`); await page.click('#sample'); await page.waitForSelector('#tbl tbody tr');
const counts = await page.$eval('#tabs', (e) => e.textContent);
const dl = page.waitForEvent('download'); await page.click('#xls'); const xls = await dl;
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'screenshots/02-reconciliation.png', fullPage: true });

await page.goto(`${base}/einvoice.html`); await page.waitForSelector('#msgs li');
const goodMsg = await page.$eval('#msgs', (e) => e.textContent);
await page.click('#loadBad');
const badCount = await page.$$eval('#msgs li.e', (l) => l.length);
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'screenshots/03-einvoice-errors.png', fullPage: true });
await page.click('#loadGood');
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'screenshots/04-einvoice-valid.png', fullPage: false });

const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await m.goto(`${base}/index.html`); await m.waitForSelector('#work-list .card');
await m.screenshot({ path: 'screenshots/05-landing-mobile.png', fullPage: false });
await browser.close();

console.log(JSON.stringify({ reconTabs: counts, excelDownload: xls.suggestedFilename(), einvoiceValid: goodMsg.slice(0, 80), einvoiceBadErrors: badCount, errors }, null, 2));
if (errors.length) process.exit(1);
