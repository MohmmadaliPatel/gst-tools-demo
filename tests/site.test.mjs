// Static checks on the published HTML: call-to-action boxes, 404 page, and the publishing rules
// (no email addresses, phone numbers, code-host links or third-party requests). No dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const profile = JSON.parse(read('profile.json'));
const DEMOS = ['quote.html', 'stock.html', 'renewals.html', 'recon.html', 'einvoice.html'];
const pkgA = profile.services.find((s) => s.id === 'A');
const qt = Object.fromEntries(profile.quick_tools.map((q) => [q.demo, q]));
const ct = Object.fromEntries(profile.compliance_tools.map((q) => [q.demo, q]));
// Expected CTA price per demo: quick tools from profile.json quick_tools, GST demos from package A.
const expected = {
  'quote.html': { amt: qt['quote.html'].from, usd: qt['quote.html'].usd, time: qt['quote.html'].timeline },
  'stock.html': { amt: qt['stock.html'].from, usd: qt['stock.html'].usd, time: qt['stock.html'].timeline },
  'renewals.html': { amt: qt['renewals.html'].from, usd: qt['renewals.html'].usd, time: qt['renewals.html'].timeline },
  'recon.html': { amt: pkgA.price, usd: pkgA.price_usd, time: pkgA.timeline },
  'einvoice.html': { amt: pkgA.price, usd: pkgA.price_usd, time: pkgA.timeline },
  'tds.html': { amt: ct['tds.html'].from, usd: ct['tds.html'].usd, time: ct['tds.html'].timeline },
};
const ctaOf = (html) => { const m = html.match(/<aside class="cta" id="cta"[\s\S]*?<\/aside>/g); return m || []; };

test('every demo page has exactly one CTA box with the shared heading, reply line and no contact details', () => {
  for (const f of DEMOS) {
    const html = read(f), boxes = ctaOf(html);
    assert.equal(boxes.length, 1, `${f}: one .cta box`);
    const box = boxes[0];
    assert.match(box, /<h2 id="cta-h">Want this for your business\?<\/h2>/, f);
    assert.match(box, /Reply to the email that brought you here/, f);
    assert.doesNotMatch(box, /@|mailto:|tel:|github/i, `${f}: no email, phone or code-host link`);
    assert.match(html, /<p class="cta-mini">[\s\S]*?href="#cta"/, `${f}: intro line links to the CTA`);
  }
});

test('CTA prices and timelines match profile.json (single source used on the landing page)', () => {
  for (const f of Object.keys(expected)) {
    const box = ctaOf(read(f))[0], e = expected[f];
    assert.ok(box.includes(`<small>from</small> ${e.amt} <small>/ ${e.usd}</small>`), `${f}: price ${e.amt} / ${e.usd}`);
    assert.ok(box.includes(`${e.time} · fixed price`), `${f}: timeline ${e.time}`);
    assert.ok(read(f).includes(`Fixed price from ${e.amt}</b> · ${e.time}`), `${f}: intro line matches`);
  }
  const t = ct['tds.html'], tds = ctaOf(read('tds.html'))[0];
  assert.ok(tds.includes(`+ ${t.annual.replace('/yr', '')} / ${t.annual_usd.replace('/yr', '')} per year`), 'tds: yearly fee matches profile.json');
  assert.ok(read('tds.html').includes(`+ ${t.annual} updates`), 'tds: intro line shows the yearly fee');
  const b = profile.services.find((s) => s.id === 'B');
  assert.ok(ctaOf(read('einvoice.html'))[0].includes(`${b.price} / ${b.price_usd}, ${b.timeline} (Package B)`), 'einvoice: live IRN option matches package B');
});

test('shared CTA styles exist and are hidden in print', () => {
  const css = read('css/style.css');
  assert.match(css, /\.cta\{display:grid/);
  assert.match(css, /@media print\{\.cta,\.cta-mini\{display:none!important\}\}/);
});

test('404 page exists, uses site styling and links to the home page and every demo', () => {
  assert.ok(existsSync(new URL('../404.html', import.meta.url)));
  const html = read('404.html');
  assert.match(html, /<link rel="stylesheet" href="css\/style.css">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<base href=/, 'resolves links from the site root at any depth');
  for (const p of ['index.html', ...DEMOS, 'tds.html']) assert.ok(html.includes(`href="${p}"`), `404 links to ${p}`);
  assert.doesNotMatch(html, /@[a-z0-9-]+\.[a-z]|github\.com|mailto:/i);
});

test('publishing rules: no emails, phone numbers, code-host links, secrets or remote URLs in site files', () => {
  const files = [...readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.html')), 'profile.json', 'css/style.css',
    ...readdirSync(new URL('../js', import.meta.url)).map((f) => `js/${f}`)];
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, `${f}: email address`);
    assert.doesNotMatch(s, /(\+91[ -]?)?\b[6-9]\d{9}\b/, `${f}: phone number`);
    assert.doesNotMatch(s, /github\.com|gitlab\.com|bitbucket\.org/i, `${f}: code-host link`);
    assert.doesNotMatch(s, /ghp_|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20}/, `${f}: secret`);
    // only the inline SVG namespace may contain an absolute URL
    const urls = (s.match(/https?:\/\/[^\s'"<>)]+/g) || []).filter((u) => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], `${f}: remote URL`);
  }
});
