// Headless-browser checks: sample auto-load, quote preview layout, 404 page, existing URLs, no external requests.
// Serves the site like the static host does (under /gst-tools-demo/, with 404.html for missing paths).
// Needs the optional `playwright` package with Chromium (npm i playwright && npx playwright install chromium);
// skipped automatically when it isn't installed, so `npm test` still runs with zero dependencies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* optional */ }
const skip = chromium ? false : 'playwright not installed';

const root = fileURLToPath(new URL('..', import.meta.url));
const PREFIX = '/gst-tools-demo/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.png': 'image/png', '.md': 'text/markdown' };
let server, base, browser;

before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let rel = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : null;
    if (rel === '') rel = 'index.html';
    const file = rel === null ? null : normalize(join(root, rel));
    try {
      if (!file || !file.startsWith(root)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(await readFile(join(root, '404.html')));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function open(path, width = 1360) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const external = [], errors = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) external.push(u); });
  page.on('pageerror', (e) => errors.push(e.message));
  const resp = await page.goto(base + path);
  return { page, resp, external, errors };
}

const AUTO = [['recon.html', '#tbl tbody tr'], ['stock.html', '#tbl tr td'], ['renewals.html', '#tbl tr td']];

test('recon, stock and renewals auto-load the sample without a click', { skip }, async () => {
  for (const [p, sel] of AUTO) {
    const { page, external, errors } = await open(p);
    await page.waitForSelector(sel, { timeout: 5000 });
    assert.equal(await page.$eval('#out', (e) => e.hidden), false, `${p}: results visible`);
    assert.deepEqual(external, [], `${p}: no external requests`); assert.deepEqual(errors, [], `${p}: no JS errors`);
    await page.close();
  }
});

test('"Use sample data" still works, and ?sample=0 opens with no data', { skip }, async () => {
  for (const [p, sel] of AUTO) {
    const { page } = await open(`${p}?sample=0`);
    await page.waitForTimeout(400);
    assert.equal(await page.$eval('#out', (e) => e.hidden), true, `${p}?sample=0 starts empty`);
    await page.click('#sample'); await page.waitForSelector(sel, { timeout: 5000 });
    assert.equal(await page.$eval('#out', (e) => e.hidden), false, `${p}: sample button loads data`);
    await page.close();
  }
});

test('auto-load never overwrites a file the visitor picked before the sample arrived', { skip }, async () => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  // hold the sample fetch back so the visitor's file wins the race
  await page.route('**/samples/members.csv', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await page.goto(base + 'renewals.html');
  await page.setInputFiles('#fm', { name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from('name,plan,expiry,sessions_total,sessions_used,fee_total,fee_paid,renewal_price\nTest Person,Monthly,2026-10-20,10,2,1000,1000,1000\n') });
  await page.waitForFunction(() => document.getElementById('dm').textContent.includes('mine.csv'));
  await page.waitForTimeout(1200); // sample response has now arrived
  assert.match(await page.$eval('#dm', (e) => e.textContent), /mine\.csv: 1 people/);
  await page.close();
});

test('quote preview fits its card at 1360, 768 and 375 px for every preset (totals not clipped)', { skip }, async () => {
  for (const type of ['', '?type=steel', '?type=export', '?type=translation']) for (const w of [1360, 768, 375]) {
    const { page } = await open(`quote.html${type}`, w);
    await page.waitForSelector('#doc table');
    const m = await page.$eval('#doc', (d) => {
      const g = d.querySelector('.tot .g').getBoundingClientRect(), box = d.getBoundingClientRect();
      return { sw: d.scrollWidth, cw: d.clientWidth, totRight: g.right, boxRight: box.right, page: document.documentElement.scrollWidth, vw: innerWidth };
    });
    assert.ok(m.sw <= m.cw + 1, `quote${type} @${w}: doc scrollWidth ${m.sw} <= ${m.cw}`);
    assert.ok(m.totRight <= m.boxRight + 1, `quote${type} @${w}: total inside the preview`);
    assert.ok(m.page <= m.vw + 1, `quote${type} @${w}: no horizontal page scroll`);
    await page.close();
  }
});

test('quote prints as a normal table on A4 with no CTA or site chrome', { skip }, async () => {
  const { page } = await open('quote.html?type=steel', 794);
  await page.waitForSelector('#doc table'); await page.emulateMedia({ media: 'print' });
  const r = await page.evaluate(() => ({
    table: getComputedStyle(document.querySelector('#doc table')).display,
    head: getComputedStyle(document.querySelector('#doc table tr')).display,
    fits: document.getElementById('doc').scrollWidth <= document.getElementById('doc').clientWidth + 1,
    cta: getComputedStyle(document.getElementById('cta')).display, header: getComputedStyle(document.querySelector('header.top')).display,
  }));
  assert.deepEqual(r, { table: 'table', head: 'table-row', fits: true, cta: 'none', header: 'none' });
  await page.close();
});

test('CTA box is visible on every demo page at 375 px and contains no contact details', { skip }, async () => {
  for (const p of ['quote.html', 'stock.html', 'renewals.html', 'recon.html', 'einvoice.html']) {
    const { page } = await open(p, 375);
    const t = await page.$eval('#cta', (e) => ({ text: e.innerText, w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth }));
    assert.match(t.text, /Want this for your business\?/); assert.match(t.text, /Reply to the email that brought you here/);
    assert.ok(t.sw <= t.cw + 1, `${p}: CTA fits`);
    await page.close();
  }
});

test('missing paths return 404 with the styled page and working links, even when nested', { skip }, async () => {
  for (const path of ['no-such-page.html', 'a/b/c/missing']) {
    const { page, resp, external } = await open(path, 375);
    assert.equal(resp.status(), 404);
    assert.match(await page.textContent('h1'), /doesn't exist/);
    assert.equal(await page.$eval('body', (b) => getComputedStyle(b).backgroundColor), 'rgb(246, 248, 251)', 'site CSS applied');
    const hrefs = await page.$$eval('main a', (as) => as.map((a) => a.href));
    for (const p of ['quote.html', 'stock.html', 'renewals.html', 'recon.html', 'einvoice.html', 'tds.html', 'extract.html', 'index.html']) assert.ok(hrefs.includes(base + p), `${path}: links to ${p}`);
    assert.deepEqual(external, []);
    await page.close();
  }
});

test('every existing URL still returns 200', { skip }, async () => {
  const urls = ['', 'index.html', 'recon.html', 'einvoice.html', 'quote.html', 'quote.html?type=steel', 'quote.html?type=export', 'quote.html?type=translation',
    'stock.html', 'renewals.html', 'tds.html', 'extract.html', 'profile.json', 'css/style.css', 'css/extract.css', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'samples/extract/purchase_orders.csv', 'samples/extract/in_sahyadri_gst_cgst_sgst.pdf', 'samples/extract/us_bayline_sales_tax.pdf', 'samples/gstr2b_sample.json', 'samples/purchase_register.csv', 'samples/einvoice_rows.csv',
    'samples/stock_master.csv', 'samples/stock_movements.csv', 'samples/shopify_inventory.csv', 'samples/members.csv'];
  for (const u of urls) { const r = await fetch(base + u); assert.equal(r.status, 200, u); }
});

// The browser clock is mocked, so these runs are deterministic. They prove the pages follow the visitor's date.
async function kpisOn(path, iso) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.clock.setFixedTime(new Date(`${iso}T10:00:00`));
  await page.goto(base + path); await page.waitForSelector('#tbl tr td', { timeout: 5000 });
  const r = await page.evaluate(() => ({ today: (document.getElementById('today') || document.getElementById('asof')).value, kpis: document.getElementById('kpis').innerText, tabs: document.getElementById('tabs').innerText }));
  await page.close();
  return r;
}

test('stock and renewals use the visitor\'s date and the sample story is unchanged on another day', { skip }, async () => {
  for (const p of ['stock.html', 'renewals.html']) {
    const ref = await kpisOn(p, '2026-10-26');
    for (const d of ['2027-03-15', '2028-02-29']) {
      const r = await kpisOn(p, d);
      assert.equal(r.today, d, `${p}: date field shows the visitor's today`);
      assert.equal(r.kpis.replaceAll(d, 'TODAY'), ref.kpis.replaceAll('2026-10-26', 'TODAY'), `${p}: same KPIs on ${d}`);
      assert.equal(r.tabs, ref.tabs, `${p}: same tab counts on ${d}`);
    }
  }
});

test('no page-wide horizontal scroll at 320, 375, 768 and 1360 px (quote presets and every page)', { skip }, async () => {
  const pages = ['index.html', 'quote.html', 'quote.html?type=steel', 'quote.html?type=export', 'quote.html?type=translation', 'recon.html', 'einvoice.html', 'stock.html', 'renewals.html', 'tds.html', 'extract.html', '404.html'];
  for (const w of [320, 375, 768, 1360]) for (const p of pages) {
    const { page } = await open(p, w);
    await page.waitForLoadState('load'); await page.waitForTimeout(250);
    // extract.html parses its sample PDFs asynchronously: wait until the queue and the first page are rendered
    if (p === 'extract.html') await page.waitForFunction(() => document.body.dataset.ready === '6' && document.body.dataset.rendered, null, { timeout: 15000 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= w, `${p} at ${w}px: page is ${sw}px wide`);
    await page.close();
  }
});

test('quote page uses the visitor\'s date and the sample follow-up queue is unchanged on another day', { skip }, async () => {
  const read = async (iso) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await page.clock.setFixedTime(new Date(`${iso}T10:00:00`));
    await page.goto(base + 'quote.html'); await page.waitForSelector('#doc table');
    const r = await page.evaluate(() => ({ date: document.getElementById('qdate').value, kpis: document.getElementById('kpis').innerText, due: document.getElementById('due').innerText.replace(/Q\/\d{4}-\d{2}\//g, 'Q/FY/'), no: document.getElementById('doc').innerText.match(/Q\/\d{4}-\d{2}\/\d{4}/)[0] }));
    await page.close();
    return r;
  };
  const ref = await read('2026-10-26');
  assert.equal(ref.no, 'Q/2026-27/0046');
  for (const d of ['2027-03-15', '2028-02-29']) {
    const r = await read(d);
    assert.equal(r.date, d, 'quote date is the visitor\'s today');
    assert.equal(r.kpis, ref.kpis, `same KPIs on ${d}`);
    assert.equal(r.due, ref.due, `same follow-up queue on ${d}`);
    assert.match(r.no, /\/0046$/, `next quote number on ${d}`);
  }
});
