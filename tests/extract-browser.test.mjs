// Headless-browser checks for extract.html: sample auto-load with pdf.js, zero network requests once the visitor
// picks their own files, review edits re-validate totals, PO fix button, exports, layout at 320/375/768/1360 px.
// Skipped automatically when the optional `playwright` package is not installed.
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
let server, base, browser;
const sample = (f) => join(root, 'samples/extract', f);
const PDFS = ['in_sahyadri_gst_cgst_sgst.pdf', 'in_kaveri_gst_igst.pdf', 'us_bayline_sales_tax.pdf', 'uk_hartwell_vat.pdf', 'au_southern_cross_gst.pdf', 'us_bayline_resent_copy.pdf'];

before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(PREFIX) ? path.slice(PREFIX.length) || 'index.html' : null;
    const file = rel === null ? null : normalize(join(root, rel));
    try {
      if (!file || !file.startsWith(root)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(await readFile(join(root, '404.html'))); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function open(path, width = 1360) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const requests = [], external = [], errors = [];
  page.on('request', (r) => { const u = r.url(); requests.push(u); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) external.push(u); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + path);
  return { page, ctx, requests, external, errors };
}
const ready = (page, n = 6) => page.waitForFunction((k) => document.body.dataset.ready === String(k) && document.body.dataset.rendered, n, { timeout: 15000 });
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);

test('extract.html auto-loads 6 sample PDFs: queue, PO flags, duplicate, rendered page, no external requests or JS errors', { skip }, async () => {
  const { page, ctx, external, errors } = await open('extract.html');
  await ready(page);
  assert.match(await page.title(), /Invoice &|Invoice & PO PDF Extractor/);
  assert.match(await text(page, '#privacy'), /Files never leave this tab\./);
  assert.equal((await page.$$('#qtbl tr[data-i]')).length, 6);
  const k = await text(page, '#kpis');
  assert.match(k, /6invoices read/); assert.match(k, /2ready to export/); assert.match(k, /4PO problems/); assert.match(k, /1possible duplicates/);
  assert.match(await text(page, '#qtbl'), /Duplicate\?/);
  assert.match(await text(page, '#po'), /billed at 4\.35, PO price 4\.10/);
  assert.match(await text(page, '#po'), /billed 120, PO ordered 100/);
  assert.ok(await page.$('#po [data-sug]'), 'missing-PO suggestion button');
  assert.ok((await page.$$('#boxes b')).length >= 10, 'confidence boxes drawn over the PDF');
  assert.equal(await page.$eval('#f-invoiceNo', (e) => e.value), 'SPP/26-27/0412');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await ctx.close();
});

test('zero network requests after the visitor picks their own PDFs and PO file', { skip }, async () => {
  const { page, ctx, requests, external, errors } = await open('extract.html?sample=0');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const before = requests.length;
  await page.setInputFiles('#fpo', sample('purchase_orders.csv'));
  await page.setInputFiles('#fpdf', PDFS.slice(0, 5).map(sample));
  await ready(page, 5);
  await page.click('#next'); await page.waitForFunction(() => document.body.dataset.rendered === '1:1');
  await page.click('#dl').catch(() => {});
  await page.waitForTimeout(300);
  assert.deepEqual(requests.slice(before).filter((u) => !/^(blob|data):/.test(u)), [], 'no request of any kind after picking files');
  assert.equal((await page.$$('#qtbl tr[data-i]')).length, 5);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await ctx.close();
});

test('review: editing a line amount re-validates totals; fixing it clears the error; PO suggestion fills the field', { skip }, async () => {
  const { page, ctx, errors } = await open('extract.html');
  await ready(page);
  assert.doesNotMatch(await text(page, '#checks'), /Line items add up to 4/);
  await page.fill('[data-l="0"][data-c="amount"]', '19000'); await page.press('[data-l="0"][data-c="amount"]', 'Tab');
  await page.waitForFunction(() => /but the subtotal is/.test(document.getElementById('checks').textContent));
  assert.match(await text(page, '#checks'), /Line items add up to 47,980\.00, but the subtotal is 48,230\.00/);
  assert.match(await text(page, '#checks'), /500 × 38\.50 = 19,250\.00, but the line shows 19,000\.00/);
  assert.match(await text(page, '#kpis'), /1ready to export/);
  await page.click('#fixamt');
  await page.waitForFunction(() => !/but the subtotal is/.test(document.getElementById('checks').textContent));
  // total edit
  await page.fill('#f-total', '56,000'); await page.press('#f-total', 'Tab');
  await page.waitForFunction(() => /but the total is 56,000\.00/.test(document.getElementById('checks').textContent));
  assert.ok(await page.$('.f.err #f-total'), 'total field flagged');
  await page.click('#reset');
  await page.waitForFunction(() => document.getElementById('f-total').value === '56911');
  // missing PO on the AU invoice
  await page.click('#po [data-sug]');
  await page.waitForFunction(() => /PO-AU-5520/.test(document.getElementById('po').textContent) && !document.querySelector('#po [data-sug]'));
  assert.match(await text(page, "#kpis"), /3PO problems/);
  // mark reviewed advances
  await page.click('#markrev'); await page.waitForFunction(() => document.getElementById('docsel').value === '1');
  assert.match(await text(page, '#kpis'), /1 \/ 6reviewed/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('exports: each target downloads; flagged bills held back unless included; IIF balances', { skip }, async () => {
  const { page, ctx, errors } = await open('extract.html');
  await ready(page);
  const files = {};
  for (const t of ['qbo', 'xero', 'qbd', 'tally', 'zoho']) {
    await page.selectOption('#target', t);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
    files[t] = { name: dl.suggestedFilename(), body: await readFile(await dl.path(), 'utf8') };
  }
  assert.equal(files.qbo.name, 'quickbooks_online_bills.csv');
  assert.match(files.qbo.body, /^\uFEFFBill No\.,Supplier,Bill Date,Due Date,Account,Line Amount,Line Tax Code/);
  assert.match(files.xero.body, /^\uFEFF\*ContactName,EmailAddress,POAddressLine1/);
  assert.equal(files.xero.body.split('\r\n')[0].split(',').length, 26);
  assert.match(files.qbd.body, /^!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT/);
  assert.match(files.tally.body, /Sahyadri Packaging Pvt Ltd/);
  assert.match(files.zoho.body, /Bill Number/);
  // held back: Kaveri (qty over PO), both Bayline (PO + duplicate), AU (missing PO) -> 2 bills by default
  assert.doesNotMatch(files.qbo.body, /Bayline|Kaveri|Southern Cross/);
  assert.match(files.qbo.body, /Hartwell/);
  // IIF: each TRNS..ENDTRNS block sums to zero
  for (const block of files.qbd.body.split('ENDTRNS').slice(1, -1)) {
    const amts = block.split('\r\n').filter((l) => /^(TRNS|SPL)\t/.test(l)).map((l) => Number(l.split('\t')[5]));
    assert.ok(amts.length > 1 && Math.abs(amts.reduce((a, b) => a + b, 0)) < 0.005, 'transaction balances');
  }
  await page.check('#incl');
  await page.selectOption('#target', 'qbo');
  assert.match(await text(page, '#dlinfo'), /^6 bills/);
  assert.ok((await page.$$('#xcols .u')).length > 0 && (await page.$$('#xcols .v')).length > 0, 'verified / unverified column badges');
  await page.selectOption('#target', 'xero');
  assert.equal((await page.$$('#xcols .t')).length, 26, 'Xero headers labelled third-party');
  assert.match(await text(page, '#xhid'), /empty column\(s\) hidden/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const w of [320, 375, 768, 1360]) {
  test(`extract.html at ${w}px: no horizontal page overflow, no JS errors`, { skip }, async () => {
    const { page, ctx, errors, external } = await open('extract.html', w);
    await ready(page);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(o.sw <= o.cw, `page ${o.sw} wider than viewport ${o.cw}`);
    const canvasW = await page.$eval('#cv', (c) => c.getBoundingClientRect().right);
    assert.ok(canvasW <= w, 'rendered page fits');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await ctx.close();
  });
}
