// Headless-browser checks for tds.html: sample auto-load, zero network calls with the visitor's own files,
// layout at phone/tablet/desktop widths, exports, print view, PAN masking, copy-only follow-ups, clear-all.
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain; charset=utf-8' };
let server, base, browser;
const sample = (f) => join(root, 'samples/tds', f);
const AT_RISK = '₹73,100.00';

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

async function open(path, width = 1360, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  const requests = [], external = [], errors = [];
  page.on('request', (r) => { const u = r.url(); requests.push(u); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) external.push(u); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + path);
  return { page, ctx, requests, external, errors };
}
const kpi = (page) => page.$eval('#kpis', (e) => e.textContent);

test('tds.html auto-loads the sample: results, privacy line, no external requests, no JS errors', { skip }, async () => {
  const { page, ctx, external, errors } = await open('tds.html');
  await page.waitForSelector('#out:not([hidden])', { timeout: 8000 });
  assert.equal(await page.title(), 'TDS Credit Check: 26AS/Form 168 vs Books');
  assert.match(await page.$eval('#privacy', (e) => e.textContent), /Files never leave this tab\./);
  assert.ok((await kpi(page)).includes(AT_RISK), 'credit at risk from the golden sample');
  assert.ok((await page.$$('#tbl tbody tr')).length > 40);
  assert.ok((await page.$$('#fu article')).length >= 6, 'one follow-up card per deductor');
  assert.ok((await page.$$('#dtbl tbody tr')).length >= 12, 'statement review lists deductors');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await ctx.close();
});

test('own files (Form 168 CSV + Tally-style books): zero network requests after the page has loaded', { skip }, async () => {
  const { page, ctx, requests, external, errors } = await open('tds.html?sample=0');
  await page.waitForLoadState('networkidle');
  assert.equal(await page.$eval('#out', (e) => e.hidden), true, '?sample=0 starts empty');
  const before = requests.length;
  await page.setInputFiles('#fst', [sample('form168_sample.csv'), sample('form26as_prev_sample.txt')]);
  await page.selectOption('#preset', 'tally');
  await page.setInputFiles('#fbk', sample('books_tally_style.csv'));
  await page.setInputFiles('#fpm', sample('party_tan_map.csv'));
  await page.waitForFunction(() => !document.getElementById('run').disabled);
  await page.click('#run');
  await page.waitForSelector('#out:not([hidden])');
  assert.ok((await kpi(page)).includes(AT_RISK), 'same credit at risk from Tally-style books + Form 168 CSV');
  await page.click('#xls').catch(() => {}); // export also stays local (blob:)
  await page.waitForTimeout(300);
  const after = requests.slice(before).filter((u) => !/^(data|blob):/.test(u));
  assert.deepEqual(after, [], 'no requests at all once files are picked');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await ctx.close();
});

test('no horizontal scroll and no JS errors at 320, 375, 768 and 1360 px; nav fits', { skip }, async () => {
  for (const w of [320, 375, 768, 1360]) {
    const { page, ctx, errors } = await open('tds.html', w);
    await page.waitForSelector('#out:not([hidden])', { timeout: 8000 });
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw, `${w}px: page ${sw} > viewport ${iw}`);
    const navRight = await page.$eval('header.top nav', (n) => n.getBoundingClientRect().right);
    assert.ok(navRight <= w + 0.5, `${w}px: nav fits`);
    assert.deepEqual(errors, [], `${w}px: no JS errors`);
    await ctx.close();
  }
});

test('Excel export has 5 sheets; CSVs download; PAN masked unless unticked', { skip }, async () => {
  const { page, ctx } = await open('tds.html');
  await page.waitForSelector('#out:not([hidden])', { timeout: 8000 });
  const grab = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return { name: d.suggestedFilename(), text: await readFile(await d.path(), 'utf8') }; };
  const x = await grab('#xls');
  assert.equal(x.name, 'tds_credit_check.xls');
  const sheets = [...x.text.matchAll(/<Worksheet ss:Name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sheets, ['Summary', 'Matches', 'Exceptions', 'Deductor follow-ups', 'Party-TAN map']);
  assert.match(x.text, /ABCDE\*\*\*\*F/); assert.doesNotMatch(x.text, /ABCDE1234F/);
  const c = await grab('#csv'); assert.match(c.text, /Status,/); assert.doesNotMatch(c.text, /ABCDE1234F/);
  const f = await grab('#fcsv'); assert.match(f.text, /Follow-up text/);
  for (const sel of ['#stmthead', '#sum', '#fu', '#tbl']) {
    const t = await page.$eval(sel, (e) => e.textContent + [...e.querySelectorAll('textarea')].map((x) => x.value).join(''));
    assert.doesNotMatch(t, /ABCDE1234F/, `${sel}: PAN masked on screen`);
  }
  assert.match(await page.$eval('#stmthead', (e) => e.textContent), /ABCDE\*\*\*\*F/);
  await page.uncheck('#mask');
  assert.match(await page.$eval('#stmthead', (e) => e.textContent), /ABCDE1234F/);
  await ctx.close();
});

test('follow-ups are copy-only (no mailto, no send), copy works; print shows only the client summary', { skip }, async () => {
  const { page, ctx } = await open('tds.html', 1360, { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.waitForSelector('#fu article');
  const html = await page.content();
  assert.doesNotMatch(html, /mailto:|tel:/i);
  assert.equal(await page.$$eval('#fu button', (b) => b.every((x) => /Copy/.test(x.textContent))), true);
  await page.click('#fu article button');
  await page.waitForFunction(() => /Copied/.test(document.getElementById('fuc0').textContent));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Subject: TDS credit/);
  await page.emulateMedia({ media: 'print' });
  const vis = await page.evaluate(() => ['#s-load', '#s-out', '#s-fu', '#cta', 'header.top', '#sum'].map((s) => getComputedStyle(document.querySelector(s)).display !== 'none'));
  assert.deepEqual(vis, [false, false, false, false, false, true]);
  assert.match(await page.$eval('#sum', (e) => e.textContent), /Credit at risk₹73,100\.00/);
  await ctx.close();
});

test('party map can be saved in this browser and "Clear all data" removes everything', { skip }, async () => {
  const { page, ctx } = await open('tds.html');
  await page.waitForSelector('#ptbl input');
  await page.click('#psave');
  assert.ok(await page.evaluate(() => localStorage.getItem('tds-check-demo-v1')));
  await page.click('#clear');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await page.$eval('#out', (e) => e.hidden), true);
  assert.equal(await page.$eval('#run', (e) => e.disabled), true);
  await ctx.close();
});
