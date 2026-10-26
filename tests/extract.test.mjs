// Unit and golden tests for the invoice / PO extractor (js/extract.js, js/extract-export.js).
// The golden test reads the bundled sample PDFs with the vendored pdf.js, exactly as the page does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseAmount, parseAnyDate, extractInvoice, checkDoc, findDuplicates, parsePoCsv, matchPo, summary, normalizeItems, confBand, textSim, normVendor,
} from '../js/extract.js';
import { buildExport, allocate, exportLines, fmtDate, COLUMNS, TARGETS, docTaxRate } from '../js/extract-export.js';
import { docTotals } from '../js/extract.js';
import { csvRows } from '../js/form26as.js';

const root = new URL('..', import.meta.url);
const dir = new URL('samples/extract/', root);
const expected = JSON.parse(readFileSync(new URL('expected_results.json', dir), 'utf8'));
const poText = readFileSync(new URL('purchase_orders.csv', dir), 'utf8');

// pdf.js 4.x modern build needs Promise.withResolvers (Node 22+); polyfill for Node 20.
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const origWarn = console.log; console.log = (...a) => { if (!/legacy/.test(String(a[0]))) origWarn(...a); };
const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
console.log = origWarn;
pdfjs.GlobalWorkerOptions.workerSrc = fileURLToPath(new URL('vendor/pdfjs/pdf.worker.min.mjs', root));
async function load(file) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(new URL(file, dir))), verbosity: 0, isEvalSupported: false }).promise;
  const items = [];
  for (let i = 1; i <= pdf.numPages; i++) items.push(...normalizeItems((await (await pdf.getPage(i)).getTextContent()).items, i));
  await pdf.destroy();
  return items;
}
const po = parsePoCsv(poText);
const vendors = [...new Set(po.lines.map((l) => l.vendor))];
const docs = [];
for (const want of expected.invoices) docs.push(extractInvoice(await load(want.file), { file: want.file, knownVendors: vendors }));

// ---------- unit ----------
test('parseAmount handles Indian grouping, currency marks, brackets and trailing minus', () => {
  assert.equal(parseAmount('₹ 1,23,456.50'), 123456.5);
  assert.equal(parseAmount('$4,212.75'), 4212.75);
  assert.equal(parseAmount('£1,234.00'), 1234);
  assert.equal(parseAmount('(250.00)'), -250);
  assert.equal(parseAmount('-0.40'), -0.4);
  assert.ok(Number.isNaN(parseAmount('Nos')));
});

test('parseAnyDate: named months, ISO, and day/month order by country with an ambiguity flag', () => {
  assert.equal(parseAnyDate('03-Oct-2026').iso, '2026-10-03');
  assert.equal(parseAnyDate('9 October 2026').iso, '2026-10-09');
  assert.equal(parseAnyDate('October 9, 2026').iso, '2026-10-09');
  assert.equal(parseAnyDate('2026-10-14').iso, '2026-10-14');
  const us = parseAnyDate('10/07/2026', 'US'), au = parseAnyDate('10/07/2026', 'AU');
  assert.equal(us.iso, '2026-10-07'); assert.equal(au.iso, '2026-07-10'); assert.ok(!us.ambiguous && !au.ambiguous, 'country decides the order');
  assert.ok(parseAnyDate('10/07/2026').ambiguous, 'no country: flagged ambiguous');
  assert.equal(parseAnyDate('25/10/2026', 'US').iso, '2026-10-25', 'day > 12 is unambiguous');
  assert.equal(parseAnyDate('31/02/2026').iso, '', 'impossible date rejected');
});

test('normVendor / textSim', () => {
  assert.equal(normVendor('Southern Cross Office Co Pty Ltd'), normVendor('Southern Cross Office Co'));
  assert.ok(textSim('Corrugated box 5-ply 18 x 12 x 10 in', 'Corrugated box 5-ply 18x12x10 in') > 0.8);
  assert.ok(textSim('BOPP tape', 'Stretch film') < 0.2);
});

test('confBand thresholds', () => {
  assert.equal(confBand(0.99), 'hi'); assert.equal(confBand(0.7), 'med'); assert.equal(confBand(0.3), 'lo'); assert.equal(confBand(0), 'miss');
});

test('parsePoCsv reads the sample PO file with received quantities', () => {
  assert.deepEqual(po.errors, []); assert.ok(po.hasReceived);
  assert.equal(po.lines.length, new Set(csvRows(poText).slice(1).map((r) => r.join())).size);
  const lid = po.lines.find((l) => /lid/i.test(l.description));
  assert.equal(lid.unitPrice, 4.1); assert.equal(lid.poNo, 'PO-US-7781');
  assert.ok(parsePoCsv('a,b\n1,2').errors.length, 'no header row');
});

// ---------- golden ----------
for (const [i, want] of expected.invoices.entries()) {
  test(`golden: ${want.file} extracts every header field and line exactly`, () => {
    const got = summary(docs[i]);
    got.taxTotal = docTotals(docs[i]).taxTotal;
    for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], `${want.file}: ${k}`);
  });
}

test('golden: arithmetic checks pass on every sample; required fields have high confidence', () => {
  for (const d of docs) {
    const errs = checkDoc(d).filter((c) => c.level === 'error');
    assert.deepEqual(errs, [], d.file);
    for (const k of ['vendor', 'invoiceNo', 'invoiceDate', 'total']) assert.ok(d.fields[k].conf >= 0.85, `${d.file} ${k} conf ${d.fields[k].conf}`);
    for (const l of d.lines) assert.ok(l.box && l.box.x1 > l.box.x0, 'line has a position for the overlay');
  }
});

test('golden: the AU due date is derived from "14 days" terms and flagged as low confidence', () => {
  const au = docs.find((d) => d.country === 'AU');
  assert.equal(au.fields.dueDate.conf < 0.85, true);
  assert.ok(checkDoc(au).some((c) => c.id === 'low_conf' && c.field === 'dueDate'));
});

test('golden: PO match status and flags per invoice', () => {
  for (const [i, want] of expected.invoices.entries()) {
    const m = matchPo(docs[i], po.lines), exp = expected.poMatch[want.file];
    assert.equal(m.status, exp.status, want.file);
    assert.deepEqual([...m.flags].sort(), [...(exp.flags || [])].sort(), want.file);
    if (exp.suggestedPo) assert.equal(m.suggestedPo, exp.suggestedPo);
  }
});

test('PO tolerance: a 6.1% price difference passes at 7% tolerance', () => {
  const us = docs.find((d) => d.file === 'us_bayline_sales_tax.pdf');
  const m = matchPo(us, po.lines, { priceTolPct: 7 });
  assert.ok(!m.flags.includes('price_diff'));
  assert.ok(m.flags.includes('qty_over_received'));
});

test('golden: duplicate detection finds the re-sent copy and nothing else', () => {
  const pairs = findDuplicates(docs).map((p) => [docs[p.a].file, docs[p.b].file]);
  assert.deepEqual(pairs, expected.duplicates);
});

// ---------- re-validation after user edits ----------
test('checks re-run on edited data: wrong line amount, intra-state IGST, CGST != SGST, due before invoice date', () => {
  const d = JSON.parse(JSON.stringify(docs[0]));
  d.lines[0].amount = 19000;
  let c = checkDoc(d);
  assert.ok(c.some((x) => x.id === 'lines_sum' && x.level === 'error'));
  assert.ok(c.some((x) => x.id === 'line_math' && x.line === 0));
  d.lines[0].amount = 19250;
  assert.ok(checkDoc(d).some((x) => x.id === 'lines_sum' && x.level === 'ok'));
  d.fields.igst.value = 100;
  assert.ok(checkDoc(d).some((x) => x.id === 'tax_type' && x.level === 'error'));
  d.fields.igst.value = null; d.fields.sgst.value = 4000;
  assert.ok(checkDoc(d).some((x) => x.id === 'cgst_sgst'));
  d.fields.dueDate.value = '2026-09-01';
  assert.ok(checkDoc(d).some((x) => x.id === 'due_before'));
  d.fields.vendorTaxId.value = '27AAKCS7310R1ZA';
  assert.ok(checkDoc(d).some((x) => x.id === 'gstin' && x.level === 'error'), 'GSTIN checksum');
});

test('extractInvoice copes with an empty / scanned page', () => {
  const d = extractInvoice([], { file: 'scan.pdf' });
  assert.deepEqual(d.lines, []);
  const c = checkDoc(d);
  assert.ok(c.some((x) => x.id === 'required' && x.field === 'invoiceNo'));
  assert.ok(c.some((x) => x.id === 'no_lines'));
});

// ---------- exports ----------
test('allocate spreads tax proportionally and the parts add up exactly', () => {
  const parts = allocate(100, [{ amount: 1 }, { amount: 1 }, { amount: 1 }]);
  assert.deepEqual(parts, [33.33, 33.33, 33.34]);
  for (const d of docs) {
    const L = exportLines(d), t = L.reduce((s, l) => s + l.amount + l.tax, 0);
    assert.ok(Math.abs(t - d.fields.total.value) < 0.005, `${d.file}: export lines add up to the total`);
  }
});

test('fmtDate and docTaxRate', () => {
  assert.equal(fmtDate('2026-10-03', 'MDY'), '10/03/2026'); assert.equal(fmtDate('2026-10-03', 'DMY'), '03/10/2026'); assert.equal(fmtDate('2026-10-03', 'DMY-'), '03-10-2026');
  assert.equal(docTaxRate(docs[0]), 18); assert.equal(docTaxRate(docs[1]), 18); assert.equal(docTaxRate(docs[3]), 20); assert.equal(docTaxRate(docs[4]), 10);
});

test('QBO export: required columns first, one row per line, net amount + tax amount', () => {
  const r = buildExport('qbo', [docs[3]]);
  assert.deepEqual(r.columns.slice(0, 7), ['Bill No.', 'Supplier', 'Bill Date', 'Due Date', 'Account', 'Line Amount', 'Line Tax Code']);
  assert.equal(r.rows.length, docs[3].lines.length);
  const net = r.rows.reduce((s, x) => s + Number(x['Line Amount']), 0), tax = r.rows.reduce((s, x) => s + Number(x['Line Tax Amount']), 0);
  assert.equal(Math.round((net + tax) * 100), Math.round(docs[3].fields.total.value * 100));
  assert.ok(r.content.startsWith('\uFEFF'));
});

test('Xero export: the 26-column template order, TaxType per country, MM/DD option', () => {
  const r = buildExport('xero', [docs[3], docs[4]], { xeroDate: 'MDY' });
  assert.equal(r.columns.length, 26);
  assert.equal(r.columns[0], '*ContactName'); assert.equal(r.columns[25], 'Currency');
  assert.equal(r.rows[0]['*TaxType'], '20% (VAT on Expenses)');
  assert.equal(r.rows.at(-1)['*TaxType'], 'GST on Expenses');
  assert.match(r.rows[0]['*InvoiceDate'], /^10\/\d\d\/2026$/);
});

test('QuickBooks Desktop IIF: tab separated, balanced, freight split out', () => {
  const us = docs.find((d) => d.file === 'us_bayline_sales_tax.pdf');
  const r = buildExport('qbd', [us]);
  const lines = r.content.trim().split('\r\n');
  assert.equal(lines[0].split('\t')[0], '!TRNS'); assert.equal(lines[1].split('\t')[0], '!SPL'); assert.equal(lines[2], '!ENDTRNS'); assert.equal(lines.at(-1), 'ENDTRNS');
  const amts = lines.filter((l) => /^(TRNS|SPL)\t/.test(l)).map((l) => Number(l.split('\t')[5]));
  assert.equal(Math.round(amts.reduce((a, b) => a + b, 0) * 100), 0);
  assert.ok(lines.some((l) => l.startsWith('SPL') && l.includes('Freight and Delivery')));
  assert.deepEqual(r.warnings, []);
});

test('Tally CSV: CGST/SGST split per line, round-off line, DD-MM-YYYY dates', () => {
  const r = buildExport('tally', [docs[0]]);
  const items = r.rows.filter((x) => x['HSN/SAC']);
  const cg = items.reduce((s, x) => s + Number(x.CGST), 0);
  assert.equal(Math.round(cg * 100), Math.round(docs[0].fields.cgst.value * 100));
  assert.ok(r.rows.some((x) => x['Round Off'] === '-0.40'));
  assert.equal(r.rows[0]['Voucher Date'], '03-10-2026');
});

test('Zoho Books CSV: one row per item, round-off as an adjustment, PO as order number', () => {
  const r = buildExport('zoho', [docs[0]]);
  assert.equal(r.rows.length, docs[0].lines.length);
  assert.equal(r.rows[0].Adjustment, '-0.40'); assert.equal(r.rows[0]['Order Number'], 'PO-IN-2041');
});

test('every export target declares its columns with a verified flag', () => {
  for (const t of Object.keys(TARGETS)) {
    assert.ok(COLUMNS[t].length > 3);
    for (const [name, v] of COLUMNS[t]) assert.ok([true, false, 'third-party'].includes(v), `${t} ${name}`);
  }
  assert.ok(COLUMNS.tally.every(([, v]) => !v), 'Tally layout is ours: all unverified');
  assert.ok(COLUMNS.zoho.every(([, v]) => !v), 'Zoho headers not confirmed: all unverified');
  assert.ok(COLUMNS.xero.every(([, v]) => v === 'third-party'), 'Xero template headers come from a third-party copy');
});
