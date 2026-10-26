// Static checks for the invoice / PO extractor page: CTA box, privacy line, vendored pdf.js, publishing rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (f, enc = 'utf8') => readFileSync(new URL(`../${f}`, import.meta.url), enc);
const html = read('extract.html');

test('extract.html: title, privacy line, site header, stylesheets, module script', () => {
  assert.match(html, /<title>Invoice &amp; PO PDF Extractor: review, PO match, accounting export<\/title>/);
  assert.match(html, /Files never leave this tab\./);
  assert.match(html, /<link rel="stylesheet" href="css\/style.css">\s*<link rel="stylesheet" href="css\/extract.css">/);
  assert.match(html, /<header class="top">[\s\S]*<a href="extract.html" class="active">/);
  assert.match(html, /<script type="module" src="js\/extract-ui.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/, 'no CDN scripts');
});

test('extract.html: one CTA box, shared heading and reply line, INR + USD price matching the intro, live push as upgrade', () => {
  const boxes = html.match(/<aside class="cta" id="cta"[\s\S]*?<\/aside>/g) || [];
  assert.equal(boxes.length, 1);
  const box = boxes[0];
  assert.match(box, /<h2 id="cta-h">Want this for your business\?<\/h2>/);
  assert.match(box, /Reply to the email that brought you here/);
  assert.doesNotMatch(box, /@|mailto:|tel:|github/i);
  // Final price (2026-10-26): ₹20,000 / $400, 10-14 days; with live QuickBooks/Xero/Tally push ₹35,000 / $700; nothing provisional left.
  assert.ok(box.includes('<small>from</small> ₹20,000 <small>/ $400</small>'), 'box shows ₹20,000 / $400');
  assert.ok(box.includes('<span class="time">10-14 days · fixed price</span>'), 'box shows 10-14 days');
  assert.ok(box.includes('With live QuickBooks/Xero/Tally push: ₹35,000 / $700'), 'box shows the live-push price');
  assert.match(box, /live push to QuickBooks Online, Xero or Tally<\/b>[\s\S]*₹35,000 \/ \$700/);
  assert.ok(html.includes('<b>Fixed price from ₹20,000</b> · 10-14 days · live QuickBooks/Xero/Tally push ₹35,000'), 'intro line matches the box');
  assert.doesNotMatch(html, /provisional|42,750|71,250|25,000|\$450|\$750/i, 'no provisional or superseded prices');
});

test('vendored pdf.js is the unmodified 4.10.38 modern build with its licence', () => {
  const sha = (f) => createHash('sha256').update(read(f, null)).digest('hex');
  assert.equal(sha('vendor/pdfjs/pdf.min.mjs'), '27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c');
  assert.equal(sha('vendor/pdfjs/pdf.worker.min.mjs'), '1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36');
  assert.match(read('vendor/pdfjs/LICENSE'), /Apache License/);
  assert.match(read('vendor/pdfjs/README.md'), /4\.10\.38/);
  // the third-party build carries only its licence / XML namespace URLs, no code-host links
  const urls = new Set([...read('vendor/pdfjs/pdf.min.mjs').matchAll(/https?:\/\/[^\s'"`<>)\\]+/g), ...read('vendor/pdfjs/pdf.worker.min.mjs').matchAll(/https?:\/\/[^\s'"`<>)\\]+/g)].filter((m) => !/[${}]/.test(m[0])).map((m) => new URL(m[0]).host));
  for (const h of urls) assert.match(h, /^(www\.apache\.org|www\.w3\.org|ns\.adobe\.com|www\.xfa\.org|www\.xfa\.com)$/, h);
  for (const f of ['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs']) assert.doesNotMatch(read(f), /github\.com|gitlab\.com|bitbucket\.org/i, f);
});

test('publishing rules on extractor files: no emails, phones, code-host links, secrets, remote URLs', () => {
  const files = ['extract.html', 'css/extract.css', 'js/extract.js', 'js/extract-export.js', 'js/extract-pdf.js', 'js/extract-ui.js', 'scripts/make-extract-samples.mjs', 'vendor/pdfjs/README.md',
    'tests/extract.test.mjs', 'tests/extract-browser.test.mjs', ...readdirSync(new URL('../samples/extract', import.meta.url)).map((f) => `samples/extract/${f}`)];
  for (const f of files) {
    const s = read(f, f.endsWith('.pdf') ? 'latin1' : 'utf8');
    assert.doesNotMatch(s, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, `${f}: email`);
    assert.doesNotMatch(s, /(\+91[ -]?)?\b[6-9]\d{9}\b/, `${f}: phone`);
    assert.doesNotMatch(s, /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/, `${f}: US-style phone`);
    assert.doesNotMatch(s, /github\.com|gitlab\.com|bitbucket\.org/i, `${f}: code-host link`);
    assert.doesNotMatch(s, /ghp_|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20}/, `${f}: secret`);
    const urls = (s.match(/https?:\/\/[^\s'"<>)]+/g) || []).filter((u) => !(f.startsWith('tests/') && /^http:\/\/(x$|127\.0\.0\.1)/.test(u)));
    assert.deepEqual(urls, [], `${f}: remote URL (tests may only use the local test server)`);
  }
});

test('extractor scripts only fetch same-origin sample files and never send anything', () => {
  const ui = read('js/extract-ui.js');
  for (const m of ui.matchAll(/fetch\(([^)]*)\)/g)) assert.match(m[1], /^`samples\/extract\//, m[0]);
  for (const f of ['js/extract-ui.js', 'js/extract.js', 'js/extract-export.js', 'js/extract-pdf.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /XMLHttpRequest|sendBeacon|WebSocket|mailto:|navigator\.share|https?:\/\//, f);
  }
});
