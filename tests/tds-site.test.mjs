// Static checks for the TDS credit check page: CTA box, privacy line, publishing rules on its CSS, samples and scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('tds.html');

test('tds.html: title, privacy line, site header and stylesheet', () => {
  assert.match(html, /<title>TDS Credit Check: 26AS\/Form 168 vs Books<\/title>/);
  assert.match(html, /Files never leave this tab\./);
  assert.match(html, /<link rel="stylesheet" href="css\/style.css">/);
  assert.match(html, /<header class="top">[\s\S]*<a href="tds.html" class="active">/);
  assert.match(html, /<script type="module" src="js\/tds-ui.js"><\/script>/);
});

test('tds.html: one CTA box with the shared heading and reply line, price consistent with the intro line', () => {
  const boxes = html.match(/<aside class="cta" id="cta"[\s\S]*?<\/aside>/g) || [];
  assert.equal(boxes.length, 1);
  const box = boxes[0];
  assert.match(box, /<h2 id="cta-h">Want this for your business\?<\/h2>/);
  assert.match(box, /Reply to the email that brought you here/);
  assert.doesNotMatch(box, /@|mailto:|tel:|github/i);
  // Final price (2026-10-26): ₹18,000 / $215, 7-10 days, + ₹7,500 / $90 per year; nothing provisional left.
  assert.ok(box.includes('<small>from</small> ₹18,000 <small>/ $215</small>'), 'box shows ₹18,000 / $215');
  assert.ok(box.includes('<span class="time">7-10 days · fixed price</span>'), 'box shows 7-10 days');
  assert.ok(box.includes('+ ₹7,500 / $90 per year'), 'box shows the yearly fee');
  assert.ok(html.includes('<b>Fixed price from ₹18,000</b> · 7-10 days · + ₹7,500/yr updates'), 'intro line matches the box');
  assert.doesNotMatch(html, /provisional/i, 'no provisional wording');
});

test('publishing rules on TDS files: no emails, phones, code-host links, secrets, remote URLs; DEMO TANs only', () => {
  const files = ['tds.html', 'css/tds.css', 'js/form26as.js', 'js/tds.js', 'js/tds-ui.js', 'js/tds-sections.json', 'scripts/make-tds-samples.mjs',
    ...readdirSync(new URL('../samples/tds', import.meta.url)).map((f) => `samples/tds/${f}`)];
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, `${f}: email`);
    assert.doesNotMatch(s, /(\+91[ -]?)?\b[6-9]\d{9}\b/, `${f}: phone`);
    assert.doesNotMatch(s, /github\.com|gitlab\.com|bitbucket\.org/i, `${f}: code-host link`);
    assert.doesNotMatch(s, /ghp_|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20}/, `${f}: secret`);
    assert.deepEqual(s.match(/https?:\/\/[^\s'"<>)]+/g) || [], [], `${f}: remote URL`);
    if (f.startsWith('samples/')) {
      const tans = s.match(/\b[A-Z]{4}\d{5}[A-Z]\b/g) || [];
      assert.ok(tans.every((t) => t.startsWith('DEMO')), `${f}: synthetic TANs only`);
      const pans = s.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || [];
      assert.ok(pans.every((p) => p === 'ABCDE1234F'), `${f}: example PAN only`);
    }
  }
});

test('TDS scripts only fetch same-origin relative paths and never send anything', () => {
  const ui = read('js/tds-ui.js');
  for (const m of ui.matchAll(/fetch\(([^)]*)\)/g)) assert.match(m[1], /^[`'"](samples\/tds\/|js\/tds-sections\.json)/, m[0]);
  for (const f of ['js/tds-ui.js', 'js/tds.js', 'js/form26as.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /XMLHttpRequest|sendBeacon|WebSocket|mailto:|navigator\.share/, f);
  }
});
